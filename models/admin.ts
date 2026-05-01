import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";
import type Keyv from "keyv";
import type { Database, Transaction } from "./db.ts";
import { accountTable, actorTable, postTable } from "./schema.ts";
import { type Uuid, validateUuid } from "./uuid.ts";

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
  kv: Keyv,
): Promise<Date | null> {
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
  kv: Keyv,
  options: RegenerateOptions = {},
): Promise<InvitationRegenerationStatus> {
  const lastRegeneratedAt = await getInvitationsLastRegen(kv);
  const { cutoffDate } = resolveCutoff(lastRegeneratedAt, options);
  const active = await selectActiveAccounts(db, cutoffDate);
  return {
    lastRegeneratedAt,
    cutoffDate,
    eligibleAccountsCount: active.length,
    topThirdCount: Math.ceil(active.length / 3),
  };
}

export async function regenerateInvitations(
  db: Database,
  kv: Keyv,
  options: RegenerateOptions = {},
): Promise<RegenerateInvitationsResult> {
  // Serialise regeneration across concurrent calls.  The DB work runs
  // inside a transaction with an xact-level advisory lock; the KV
  // cutoff write happens AFTER the transaction commits, so a commit
  // failure (deadlock, connection drop) leaves KV at the old value
  // and the next run picks up the same activity window.  Doing the
  // KV write inside the transaction callback would make the kv.set
  // durable even when Drizzle's commit later failed, leaving KV
  // advanced while leftInvitations rolled back and silently
  // under-granting invitations forever after.
  const runDbWork = async (
    tx: Transaction,
  ): Promise<RegenerateInvitationsResult> => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${INVITATIONS_REGEN_LOCK_KEY})`,
    );
    const lastRegen = await getInvitationsLastRegen(kv);
    const { now, cutoffDate } = resolveCutoff(lastRegen, options);
    const active = await selectActiveAccounts(tx, cutoffDate);
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
    return { regeneratedAt: now, accountsAffected, cutoffDate };
  };
  const result = isTransaction(db)
    ? await runDbWork(db)
    : await db.transaction(runDbWork);
  // KV write is sequenced after commit so a commit failure cannot
  // advance the cutoff without the matching DB rows being durable.
  // The trade-off is the opposite failure mode: if the process
  // crashes between commit and this kv.set, the next regen run uses
  // the stale cutoff and re-grants the same window.  Re-granting is
  // recoverable; permanently skipping a window is not.
  await kv.set(
    INVITATIONS_LAST_REGEN_KEY,
    result.regeneratedAt.toISOString(),
  );
  return result;
}
