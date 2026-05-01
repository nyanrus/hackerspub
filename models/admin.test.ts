import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import { eq } from "drizzle-orm";
import {
  createTestKv,
  insertAccountWithActor,
  insertNotePost,
  withRollback,
} from "../test/postgres.ts";
import {
  getInvitationRegenerationStatus,
  getInvitationsLastRegen,
  INVITATIONS_LAST_REGEN_KEY,
  regenerateInvitations,
} from "./admin.ts";
import { accountTable, adminStateTable } from "./schema.ts";

Deno.test({
  name: "getInvitationsLastRegen returns null when DB and KV are empty",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv } = createTestKv();
      assertEquals(await getInvitationsLastRegen(tx, kv), null);
    });
  },
});

Deno.test({
  name: "getInvitationsLastRegen falls back to KV when DB row is absent",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv, store } = createTestKv();
      const ts = new Date("2026-04-15T10:30:00.000Z");
      store.set(INVITATIONS_LAST_REGEN_KEY, ts.toISOString());
      const out = await getInvitationsLastRegen(tx, kv);
      assert(out != null);
      assertEquals(out.toISOString(), ts.toISOString());
    });
  },
});

Deno.test({
  name: "getInvitationsLastRegen prefers the DB row over the KV fallback",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv, store } = createTestKv();
      const dbTs = new Date("2026-04-15T10:30:00.000Z");
      const kvTs = new Date("2026-04-10T00:00:00.000Z");
      store.set(INVITATIONS_LAST_REGEN_KEY, kvTs.toISOString());
      await tx.insert(adminStateTable).values({
        key: INVITATIONS_LAST_REGEN_KEY,
        value: dbTs.toISOString(),
      });
      const out = await getInvitationsLastRegen(tx, kv);
      assert(out != null);
      assertEquals(out.toISOString(), dbTs.toISOString());
    });
  },
});

Deno.test({
  name: "getInvitationRegenerationStatus uses now-7d cutoff when KV key absent",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv } = createTestKv();
      const now = new Date("2026-04-15T00:00:00.000Z");
      const status = await getInvitationRegenerationStatus(tx, kv, { now });
      assertEquals(status.lastRegeneratedAt, null);
      assertEquals(
        status.cutoffDate.toISOString(),
        new Date("2026-04-08T00:00:00.000Z").toISOString(),
      );
      assertEquals(status.eligibleAccountsCount, 0);
      assertEquals(status.topThirdCount, 0);
    });
  },
});

Deno.test({
  name: "getInvitationRegenerationStatus uses stored timestamp as cutoff",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv, store } = createTestKv();
      const lastRegen = new Date("2026-04-10T00:00:00.000Z");
      store.set(INVITATIONS_LAST_REGEN_KEY, lastRegen.toISOString());
      const now = new Date("2026-04-15T00:00:00.000Z");
      const status = await getInvitationRegenerationStatus(tx, kv, { now });
      assert(status.lastRegeneratedAt != null);
      assertEquals(
        status.lastRegeneratedAt.toISOString(),
        lastRegen.toISOString(),
      );
      assertEquals(status.cutoffDate.toISOString(), lastRegen.toISOString());
    });
  },
});

Deno.test({
  name:
    "getInvitationRegenerationStatus counts accounts with at least one post past cutoff",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv } = createTestKv();
      const now = new Date("2026-04-15T00:00:00.000Z");
      const cutoff = new Date("2026-04-08T00:00:00.000Z");

      const a = await insertAccountWithActor(tx, {
        username: "statusalice",
        name: "Status Alice",
        email: "statusalice@example.com",
      });
      const b = await insertAccountWithActor(tx, {
        username: "statusbob",
        name: "Status Bob",
        email: "statusbob@example.com",
      });
      const c = await insertAccountWithActor(tx, {
        username: "statuscarol",
        name: "Status Carol",
        email: "statuscarol@example.com",
      });

      // Two posts after cutoff for alice, one for bob, none for carol.
      await insertNotePost(tx, {
        account: a.account,
        published: new Date("2026-04-10T00:00:00.000Z"),
      });
      await insertNotePost(tx, {
        account: a.account,
        published: new Date("2026-04-11T00:00:00.000Z"),
      });
      await insertNotePost(tx, {
        account: b.account,
        published: new Date("2026-04-12T00:00:00.000Z"),
      });
      // Pre-cutoff post for carol — should not count.
      await insertNotePost(tx, {
        account: c.account,
        published: new Date("2026-04-01T00:00:00.000Z"),
      });

      const status = await getInvitationRegenerationStatus(tx, kv, {
        now,
      });
      assertEquals(status.cutoffDate.toISOString(), cutoff.toISOString());
      assertEquals(status.eligibleAccountsCount, 2);
      assertEquals(status.topThirdCount, 1);
    });
  },
});

Deno.test({
  name: "regenerateInvitations grants +1 to the top third by post count",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv } = createTestKv();
      const now = new Date("2026-04-15T00:00:00.000Z");

      const a = await insertAccountWithActor(tx, {
        username: "regenalice",
        name: "Regen Alice",
        email: "regenalice@example.com",
      });
      const b = await insertAccountWithActor(tx, {
        username: "regenbob",
        name: "Regen Bob",
        email: "regenbob@example.com",
      });
      const c = await insertAccountWithActor(tx, {
        username: "regencarol",
        name: "Regen Carol",
        email: "regencarol@example.com",
      });

      // Alice: 5 posts, Bob: 3 posts, Carol: 1 post — top third (ceil(3/3)=1)
      // is just Alice.
      for (let i = 0; i < 5; i++) {
        await insertNotePost(tx, {
          account: a.account,
          published: new Date(`2026-04-${10 + i}T00:00:00.000Z`),
        });
      }
      for (let i = 0; i < 3; i++) {
        await insertNotePost(tx, {
          account: b.account,
          published: new Date(`2026-04-${10 + i}T00:00:00.000Z`),
        });
      }
      await insertNotePost(tx, {
        account: c.account,
        published: new Date("2026-04-10T00:00:00.000Z"),
      });

      const result = await regenerateInvitations(tx, kv, { now });
      assertEquals(result.accountsAffected, 1);
      assertEquals(result.regeneratedAt.toISOString(), now.toISOString());

      const aRow = await tx.query.accountTable.findFirst({
        where: { id: a.account.id },
      });
      const bRow = await tx.query.accountTable.findFirst({
        where: { id: b.account.id },
      });
      const cRow = await tx.query.accountTable.findFirst({
        where: { id: c.account.id },
      });
      assertEquals(aRow?.leftInvitations, 1);
      assertEquals(bRow?.leftInvitations, 0);
      assertEquals(cRow?.leftInvitations, 0);
    });
  },
});

Deno.test({
  name:
    "regenerateInvitations skips the KV sync when called inside an existing transaction",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv, store } = createTestKv();
      const now = new Date("2026-04-15T00:00:00.000Z");
      await regenerateInvitations(tx, kv, { now });
      // The caller controls the commit/rollback boundary when they
      // pass an existing transaction; running the KV sync here would
      // advance KV ahead of the outer commit and leave KV out of
      // sync if the outer caller rolled back.  Production calls go
      // through the non-tx branch, which does sync KV.
      assertEquals(store.get(INVITATIONS_LAST_REGEN_KEY), undefined);
    });
  },
});

Deno.test({
  name:
    "regenerateInvitations writes the cutoff into admin_state inside the same transaction",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv } = createTestKv();
      const now = new Date("2026-04-15T00:00:00.000Z");
      await regenerateInvitations(tx, kv, { now });
      const row = await tx.query.adminStateTable.findFirst({
        where: { key: INVITATIONS_LAST_REGEN_KEY },
      });
      assert(row != null);
      assertEquals(row.value, now.toISOString());
    });
  },
});

Deno.test({
  name:
    "regenerateInvitations falls back to one-week cutoff when KV key absent",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv } = createTestKv();
      const now = new Date("2026-04-15T00:00:00.000Z");

      const a = await insertAccountWithActor(tx, {
        username: "fallbackalice",
        name: "Fallback Alice",
        email: "fallbackalice@example.com",
      });

      // Within one week of `now` — counts.
      await insertNotePost(tx, {
        account: a.account,
        published: new Date("2026-04-10T00:00:00.000Z"),
      });
      // More than one week before `now` — should NOT count.
      await insertNotePost(tx, {
        account: a.account,
        published: new Date("2026-04-01T00:00:00.000Z"),
      });

      const result = await regenerateInvitations(tx, kv, { now });
      assertEquals(result.accountsAffected, 1);
      assertEquals(
        result.cutoffDate.toISOString(),
        new Date("2026-04-08T00:00:00.000Z").toISOString(),
      );
    });
  },
});

Deno.test({
  name: "regenerateInvitations is a no-op when no accounts have posted",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv } = createTestKv();
      const now = new Date("2026-04-15T00:00:00.000Z");

      // Account exists but has no posts since cutoff.
      const a = await insertAccountWithActor(tx, {
        username: "silentalice",
        name: "Silent Alice",
        email: "silentalice@example.com",
      });

      const result = await regenerateInvitations(tx, kv, { now });
      assertEquals(result.accountsAffected, 0);
      // Timestamp is still updated.
      const stateRow = await tx.query.adminStateTable.findFirst({
        where: { key: INVITATIONS_LAST_REGEN_KEY },
      });
      assertEquals(stateRow?.value, now.toISOString());
      const aRow = await tx.query.accountTable.findFirst({
        where: { id: a.account.id },
      });
      assertEquals(aRow?.leftInvitations, 0);
    });
  },
});

Deno.test({
  name: "regenerateInvitations rounds up via ceil(active/3) — 3 active picks 1",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv } = createTestKv();
      const now = new Date("2026-04-15T00:00:00.000Z");

      // Three eligible accounts; top third is ceil(3/3) = 1.
      const accounts = [];
      for (let i = 0; i < 3; i++) {
        const acc = await insertAccountWithActor(tx, {
          username: `ceilalice${i}`,
          name: `Ceil Alice ${i}`,
          email: `ceilalice${i}@example.com`,
        });
        // Decreasing post counts: 3, 2, 1.
        for (let j = 0; j < 3 - i; j++) {
          await insertNotePost(tx, {
            account: acc.account,
            published: new Date(`2026-04-${10 + j}T00:00:00.000Z`),
          });
        }
        accounts.push(acc);
      }

      const result = await regenerateInvitations(tx, kv, { now });
      assertEquals(result.accountsAffected, 1);

      // Only the most prolific (index 0) should get the bump.
      const updated = await Promise.all(
        accounts.map((a) =>
          tx.query.accountTable.findFirst({ where: { id: a.account.id } })
        ),
      );
      assertEquals(updated[0]?.leftInvitations, 1);
      assertEquals(updated[1]?.leftInvitations, 0);
      assertEquals(updated[2]?.leftInvitations, 0);
    });
  },
});

Deno.test({
  name:
    "regenerateInvitations called twice in immediate succession returns 0 affected on second",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv } = createTestKv();

      const a = await insertAccountWithActor(tx, {
        username: "twicealice",
        name: "Twice Alice",
        email: "twicealice@example.com",
      });
      await insertNotePost(tx, {
        account: a.account,
        published: new Date("2026-04-14T00:00:00.000Z"),
      });

      const first = await regenerateInvitations(tx, kv, {
        now: new Date("2026-04-15T00:00:00.000Z"),
      });
      assertEquals(first.accountsAffected, 1);

      const second = await regenerateInvitations(tx, kv, {
        now: new Date("2026-04-15T00:00:01.000Z"),
      });
      assertEquals(second.accountsAffected, 0);

      // Alice should still only have +1 total.
      const aRow = await tx.query.accountTable.findFirst({
        where: { id: a.account.id },
      });
      assertEquals(aRow?.leftInvitations, 1);
    });
  },
});

Deno.test({
  name:
    "regenerateInvitations does not credit accounts whose only posts pre-date cutoff",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const { kv, store } = createTestKv();
      store.set(
        INVITATIONS_LAST_REGEN_KEY,
        new Date("2026-04-10T00:00:00.000Z").toISOString(),
      );

      const a = await insertAccountWithActor(tx, {
        username: "stalealice",
        name: "Stale Alice",
        email: "stalealice@example.com",
      });
      // Post pre-dates the cutoff.
      await insertNotePost(tx, {
        account: a.account,
        published: new Date("2026-04-09T00:00:00.000Z"),
      });
      // Existing leftInvitations to confirm we don't accidentally bump it.
      await tx.update(accountTable).set({ leftInvitations: 2 }).where(
        eq(accountTable.id, a.account.id),
      );

      const result = await regenerateInvitations(tx, kv, {
        now: new Date("2026-04-15T00:00:00.000Z"),
      });
      assertEquals(result.accountsAffected, 0);
      const aRow = await tx.query.accountTable.findFirst({
        where: { id: a.account.id },
      });
      assertEquals(aRow?.leftInvitations, 2);
    });
  },
});
