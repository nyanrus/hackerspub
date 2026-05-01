import { getLogger } from "@logtape/logtape";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  sql,
} from "drizzle-orm";
import type Keyv from "keyv";

const logger = getLogger(["hackerspub", "models", "admin"]);
import type { Database, Transaction } from "./db.ts";
import {
  accountTable,
  actorTable,
  adminStateTable,
  postTable,
} from "./schema.ts";
import { type Uuid, validateUuid } from "./uuid.ts";

// Key under which the last-regen timestamp is stored, both in the
// `admin_state` DB table (current) and historically in KV (still
// honoured as a read-side fallback for deployments that haven't run
// the regen mutation since the migration).
export const INVITATIONS_LAST_REGEN_KEY = "invitations_last_regen";

// Postgres advisory-lock key for serialising invitation regeneration
// across processes; stays distinct from other lock keys in the codebase.
const INVITATIONS_REGEN_LOCK_KEY = 0x69_6e_76_72;

export const DEFAULT_REGEN_CUTOFF_DURATION: Temporal.Duration = Temporal
  .Duration.from({ days: 7 });

function isTransaction(db: Database): db is Transaction {
  return "rollback" in db;
}

export interface RegenerateInvitationsResult {
  regeneratedAt: Date;
  accountsAffected: number;
  cutoffDate: Date;
}

export interface InvitationRegenerationStatus {
  lastRegeneratedAt: Date | null;
  cutoffDate: Date;
  eligibleAccountsCount: number;
  topThirdCount: number;
}

export interface RegenerateOptions {
  now?: Date;
  defaultCutoffDuration?: Temporal.Duration;
}

export async function getInvitationsLastRegen(
  db: Database,
  kv?: Keyv,
): Promise<Date | null> {
  const row = await db.query.adminStateTable.findFirst({
    where: { key: INVITATIONS_LAST_REGEN_KEY },
  });
  if (row != null) {
    const parsed = new Date(row.value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  // Fallback: a deployment that previously stored the cutoff in KV
  // still gets the right value here on its first regen call after the
  // upgrade.  The next regen writes to DB, after which this branch is
  // never taken again.
  if (kv == null) return null;
  const raw = await kv.get(INVITATIONS_LAST_REGEN_KEY);
  if (raw == null) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw !== "string") return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function resolveCutoff(
  lastRegen: Date | null,
  options: RegenerateOptions,
): { now: Date; cutoffDate: Date } {
  const now = options.now ?? new Date();
  if (lastRegen != null) return { now, cutoffDate: lastRegen };
  const duration = options.defaultCutoffDuration ??
    DEFAULT_REGEN_CUTOFF_DURATION;
  // `Temporal.Instant.subtract` rejects calendar units like days, so
  // convert the duration to milliseconds first.
  const ms = duration.total({ unit: "millisecond" });
  const cutoffDate = new Date(now.getTime() - ms);
  return { now, cutoffDate };
}

async function selectActiveAccounts(
  db: Database,
  cutoffDate: Date,
  now: Date,
): Promise<{ accountId: Uuid; postCount: number }[]> {
  const rows = await db
    .select({
      accountId: actorTable.accountId,
      postCount: count(),
    })
    .from(postTable)
    .innerJoin(actorTable, eq(actorTable.id, postTable.actorId))
    .where(
      and(
        isNotNull(actorTable.accountId),
        gt(postTable.published, cutoffDate),
        // Clamp to `now` so future-dated posts (clock-skewed
        // federation input, scheduled posts) do not award
        // invitations before they are actually published.
        lte(postTable.published, now),
      ),
    )
    .groupBy(actorTable.accountId)
    .orderBy(desc(count()), asc(actorTable.accountId));
  return rows
    .filter((row): row is typeof row & { accountId: Uuid } =>
      row.accountId != null && validateUuid(row.accountId)
    )
    .map((row) => ({
      accountId: row.accountId,
      postCount: Number(row.postCount),
    }));
}

export async function getInvitationRegenerationStatus(
  db: Database,
  kv?: Keyv,
  options: RegenerateOptions = {},
): Promise<InvitationRegenerationStatus> {
  const lastRegeneratedAt = await getInvitationsLastRegen(db, kv);
  const { now, cutoffDate } = resolveCutoff(lastRegeneratedAt, options);
  const active = await selectActiveAccounts(db, cutoffDate, now);
  return {
    lastRegeneratedAt,
    cutoffDate,
    eligibleAccountsCount: active.length,
    topThirdCount: Math.ceil(active.length / 3),
  };
}

export async function regenerateInvitations(
  db: Database,
  kv?: Keyv,
  options: RegenerateOptions = {},
): Promise<RegenerateInvitationsResult> {
  // Serialise regeneration across concurrent calls and keep all
  // mutations atomic with the cutoff write.  The advisory lock holds
  // for the whole transaction; the cutoff is upserted into
  // admin_state inside the same transaction as the leftInvitations
  // updates, so commit either persists everything (rows + cutoff) or
  // nothing at all.  No race window exists between commit and a
  // separate cutoff write because there is no separate write.
  const runDbWork = async (
    tx: Transaction,
  ): Promise<RegenerateInvitationsResult> => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${INVITATIONS_REGEN_LOCK_KEY})`,
    );
    const lastRegen = await getInvitationsLastRegen(tx, kv);
    const { now, cutoffDate } = resolveCutoff(lastRegen, options);
    const active = await selectActiveAccounts(tx, cutoffDate, now);
    const topThirdCount = Math.ceil(active.length / 3);
    const topAccountIds = active.slice(0, topThirdCount).map((a) =>
      a.accountId
    );
    let accountsAffected = 0;
    if (topAccountIds.length > 0) {
      const updated = await tx
        .update(accountTable)
        .set({
          leftInvitations: sql`${accountTable.leftInvitations} + 1`,
        })
        .where(inArray(accountTable.id, topAccountIds))
        .returning({ id: accountTable.id });
      accountsAffected = updated.length;
    }
    await tx
      .insert(adminStateTable)
      .values({
        key: INVITATIONS_LAST_REGEN_KEY,
        value: now.toISOString(),
        updated: now,
      })
      .onConflictDoUpdate({
        target: adminStateTable.key,
        set: { value: now.toISOString(), updated: now },
      });
    return { regeneratedAt: now, accountsAffected, cutoffDate };
  };
  const result = isTransaction(db)
    ? await runDbWork(db)
    : await db.transaction(runDbWork);
  // Best-effort sync to the legacy KV key so the legacy
  // /admin/invitations route (which still reads
  // INVITATIONS_LAST_REGEN_KEY from KV) sees the new cutoff during
  // the dual-stack soak.  The DB row remains the authoritative
  // source for the new path; if this write fails the legacy route
  // may use a stale cutoff and over-grant on its next run, which is
  // recoverable.  When the legacy route is removed the sync (and
  // the kv parameter) can go away too.
  if (kv != null) {
    try {
      await kv.set(
        INVITATIONS_LAST_REGEN_KEY,
        result.regeneratedAt.toISOString(),
      );
    } catch (error) {
      logger.warn(
        "Failed to sync legacy KV invitation cutoff: {error}",
        { error },
      );
    }
  }
  return result;
}
