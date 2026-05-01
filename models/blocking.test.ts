import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import { and, eq } from "drizzle-orm";
import {
  block,
  getBlockedActorIds,
  getBlockerActorIds,
  unblock,
} from "./blocking.ts";
import { follow } from "./following.ts";
import { blockingTable, followingTable } from "./schema.ts";
import { generateUuidV7, type Uuid } from "./uuid.ts";
import {
  createFedCtx,
  insertAccountWithActor,
  insertRemoteActor,
  seedLocalInstance,
  withRollback,
} from "../test/postgres.ts";

Deno.test({
  name: "block() removes local follow relationships in both directions",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const fedCtx = createFedCtx(tx);
      const blocker = await insertAccountWithActor(tx, {
        username: "blocker",
        name: "Blocker",
        email: "blocker@example.com",
      });
      const blockee = await insertAccountWithActor(tx, {
        username: "blockee",
        name: "Blockee",
        email: "blockee@example.com",
      });

      await follow(fedCtx, blocker.account, blockee.actor);
      await follow(fedCtx, blockee.account, blocker.actor);

      const created = await block(fedCtx, blocker.account, blockee.actor);

      assert(created != null);

      const blocking = await tx.query.blockingTable.findFirst({
        where: {
          blockerId: blocker.actor.id,
          blockeeId: blockee.actor.id,
        },
      });
      assert(blocking != null);

      const followRows = await tx.select().from(followingTable).where(
        and(
          eq(followingTable.followerId, blocker.actor.id),
          eq(followingTable.followeeId, blockee.actor.id),
        ),
      );
      assertEquals(followRows, []);

      const reverseFollowRows = await tx.select().from(followingTable).where(
        and(
          eq(followingTable.followerId, blockee.actor.id),
          eq(followingTable.followeeId, blocker.actor.id),
        ),
      );
      assertEquals(reverseFollowRows, []);
    });
  },
});

Deno.test({
  name: "unblock() deletes the blocking row",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const fedCtx = createFedCtx(tx);
      const blocker = await insertAccountWithActor(tx, {
        username: "unblocker",
        name: "Unblocker",
        email: "unblocker@example.com",
      });
      const blockee = await insertAccountWithActor(tx, {
        username: "unblockee",
        name: "Unblockee",
        email: "unblockee@example.com",
      });

      await block(fedCtx, blocker.account, blockee.actor);

      const removed = await unblock(fedCtx, blocker.account, blockee.actor);

      assert(removed != null);

      const remaining = await tx.select().from(blockingTable).where(
        and(
          eq(blockingTable.blockerId, blocker.actor.id),
          eq(blockingTable.blockeeId, blockee.actor.id),
        ),
      );
      assertEquals(remaining, []);
    });
  },
});

Deno.test({
  name:
    "block() removes follow relationships with remote blockees in both directions",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const fedCtx = createFedCtx(tx);
      const blocker = await insertAccountWithActor(tx, {
        username: "remoteblocker",
        name: "Remote Blocker",
        email: "remoteblocker@example.com",
      });
      const remoteBlockee = await insertRemoteActor(tx, {
        username: `remote-blockee-${
          crypto.randomUUID().replaceAll("-", "").slice(0, 8)
        }`,
        name: "Remote Blockee",
        host: "remote.example",
      });

      await follow(fedCtx, blocker.account, remoteBlockee);
      await tx.insert(followingTable).values({
        iri: `https://remote.example/follows/${crypto.randomUUID()}`,
        followerId: remoteBlockee.id,
        followeeId: blocker.actor.id,
        accepted: new Date("2026-04-15T00:00:00.000Z"),
      });

      const created = await block(fedCtx, blocker.account, remoteBlockee);

      assert(created != null);

      const forwardFollow = await tx.select().from(followingTable).where(
        and(
          eq(followingTable.followerId, blocker.actor.id),
          eq(followingTable.followeeId, remoteBlockee.id),
        ),
      );
      assertEquals(forwardFollow, []);

      const reverseFollow = await tx.select().from(followingTable).where(
        and(
          eq(followingTable.followerId, remoteBlockee.id),
          eq(followingTable.followeeId, blocker.actor.id),
        ),
      );
      assertEquals(reverseFollow, []);
    });
  },
});

Deno.test({
  name: "getBlockedActorIds returns the subset that the blocker has blocked",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      await seedLocalInstance(tx);
      const fedCtx = createFedCtx(tx);
      const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
      const blocker = await insertAccountWithActor(tx, {
        username: `gbaiblocker${suffix}`,
        name: "GBAI Blocker",
        email: `gbaiblocker-${suffix}@example.com`,
      });
      const blocked = await insertAccountWithActor(tx, {
        username: `gbaiblocked${suffix}`,
        name: "GBAI Blocked",
        email: `gbaiblocked-${suffix}@example.com`,
      });
      const notBlocked = await insertAccountWithActor(tx, {
        username: `gbainotblocked${suffix}`,
        name: "GBAI Not Blocked",
        email: `gbainotblocked-${suffix}@example.com`,
      });

      await block(fedCtx, blocker.account, blocked.actor);

      const result = await getBlockedActorIds(tx, blocker.actor.id, [
        blocked.actor.id,
        notBlocked.actor.id,
        generateUuidV7() as Uuid,
      ]);

      assertEquals(result.has(blocked.actor.id), true);
      assertEquals(result.has(notBlocked.actor.id), false);
      assertEquals(result.size, 1);
    });
  },
});

Deno.test({
  name: "getBlockedActorIds returns empty for empty input",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const result = await getBlockedActorIds(
        tx,
        generateUuidV7() as Uuid,
        [],
      );
      assertEquals(result.size, 0);
    });
  },
});

Deno.test({
  name: "getBlockerActorIds returns the subset that has blocked the blockee",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      await seedLocalInstance(tx);
      const fedCtx = createFedCtx(tx);
      const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
      const target = await insertAccountWithActor(tx, {
        username: `gbraitarget${suffix}`,
        name: "GBRAI Target",
        email: `gbraitarget-${suffix}@example.com`,
      });
      const blocker = await insertAccountWithActor(tx, {
        username: `gbraiblocker${suffix}`,
        name: "GBRAI Blocker",
        email: `gbraiblocker-${suffix}@example.com`,
      });
      const stranger = await insertAccountWithActor(tx, {
        username: `gbraistranger${suffix}`,
        name: "GBRAI Stranger",
        email: `gbraistranger-${suffix}@example.com`,
      });

      await block(fedCtx, blocker.account, target.actor);

      const result = await getBlockerActorIds(tx, target.actor.id, [
        blocker.actor.id,
        stranger.actor.id,
        generateUuidV7() as Uuid,
      ]);

      assertEquals(result.has(blocker.actor.id), true);
      assertEquals(result.has(stranger.actor.id), false);
      assertEquals(result.size, 1);
    });
  },
});

Deno.test({
  name: "getBlockerActorIds returns empty for empty input",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const result = await getBlockerActorIds(
        tx,
        generateUuidV7() as Uuid,
        [],
      );
      assertEquals(result.size, 0);
    });
  },
});
