import assert from "node:assert/strict";
import { MAX_PINNED_POSTS, pinPost, unpinPost } from "./pin.ts";
import {
  insertAccountWithActor,
  insertNotePost,
  withRollback,
} from "../test/postgres.ts";

Deno.test({
  name: "pinPost() pins and unpins own public posts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "pinauthor",
        name: "Pin Author",
        email: "pinauthor@example.com",
      });
      const { post } = await insertNotePost(tx, {
        account: author.account,
        content: "Pinned post",
      });

      const pinned = await pinPost(tx, author.actor, post);
      assert.equal(pinned?.actorId, author.actor.id);
      assert.equal(pinned?.postId, post.id);

      const again = await pinPost(tx, author.actor, post);
      assert.equal(again?.created.getTime(), pinned?.created.getTime());

      const rows = await tx.query.pinTable.findMany({
        where: { actorId: author.actor.id },
      });
      assert.equal(rows.length, 1);

      const unpinned = await unpinPost(tx, author.actor, post);
      assert.equal(unpinned?.postId, post.id);

      const remaining = await tx.query.pinTable.findMany({
        where: { actorId: author.actor.id },
      });
      assert.deepEqual(remaining, []);
    });
  },
});

Deno.test({
  name: "pinPost() rejects ineligible posts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "pinrejectauthor",
        name: "Pin Reject Author",
        email: "pinrejectauthor@example.com",
      });
      const other = await insertAccountWithActor(tx, {
        username: "pinrejectother",
        name: "Pin Reject Other",
        email: "pinrejectother@example.com",
      });
      const { post: privatePost } = await insertNotePost(tx, {
        account: author.account,
        content: "Followers-only post",
        visibility: "followers",
      });
      const { post: otherPost } = await insertNotePost(tx, {
        account: other.account,
        content: "Other user's post",
      });
      const { post: original } = await insertNotePost(tx, {
        account: author.account,
        content: "Original post",
      });
      const { post: share } = await insertNotePost(tx, {
        account: author.account,
        content: "Share post",
        sharedPostId: original.id,
      });

      assert.equal(await pinPost(tx, author.actor, privatePost), null);
      assert.equal(await pinPost(tx, author.actor, otherPost), null);
      assert.equal(await pinPost(tx, author.actor, share), null);

      const rows = await tx.query.pinTable.findMany({
        where: { actorId: author.actor.id },
      });
      assert.deepEqual(rows, []);
    });
  },
});

Deno.test({
  name: "pinPost() enforces per-actor limit",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "pinlimitauthor",
        name: "Pin Limit Author",
        email: "pinlimitauthor@example.com",
      });
      for (let i = 0; i < MAX_PINNED_POSTS; i++) {
        const { post } = await insertNotePost(tx, {
          account: author.account,
          content: `Pinned post ${i}`,
        });
        assert.notEqual(await pinPost(tx, author.actor, post), null);
      }

      const { post: extra } = await insertNotePost(tx, {
        account: author.account,
        content: "Extra pinned post",
      });
      assert.equal(await pinPost(tx, author.actor, extra), null);

      const rows = await tx.query.pinTable.findMany({
        where: { actorId: author.actor.id },
      });
      assert.equal(rows.length, MAX_PINNED_POSTS);
    });
  },
});
