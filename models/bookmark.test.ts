import { assertEquals } from "@std/assert/equals";
import { arePostsBookmarkedBy, createBookmark } from "./bookmark.ts";
import {
  insertAccountWithActor,
  insertNotePost,
  withRollback,
} from "../test/postgres.ts";

Deno.test({
  name:
    "arePostsBookmarkedBy() returns the subset of posts the account bookmarked",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "arebookmarkedauthor",
        name: "AreBookmarked Author",
        email: "arebookmarkedauthor@example.com",
      });
      const viewer = await insertAccountWithActor(tx, {
        username: "arebookmarkedviewer",
        name: "AreBookmarked Viewer",
        email: "arebookmarkedviewer@example.com",
      });

      const { post: postA } = await insertNotePost(tx, {
        account: author.account,
        content: "A",
      });
      const { post: postB } = await insertNotePost(tx, {
        account: author.account,
        content: "B",
      });
      const { post: postC } = await insertNotePost(tx, {
        account: author.account,
        content: "C",
      });

      await createBookmark(tx, viewer.account, postA);
      await createBookmark(tx, viewer.account, postC);

      const result = await arePostsBookmarkedBy(
        tx,
        [postA.id, postB.id, postC.id],
        viewer.account,
      );

      assertEquals(result, new Set([postA.id, postC.id]));
    });
  },
});

Deno.test({
  name: "arePostsBookmarkedBy() returns an empty set when no bookmarks match",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "arebookmarkednoneauthor",
        name: "AreBookmarked None Author",
        email: "arebookmarkednoneauthor@example.com",
      });
      const viewer = await insertAccountWithActor(tx, {
        username: "arebookmarkednoneviewer",
        name: "AreBookmarked None Viewer",
        email: "arebookmarkednoneviewer@example.com",
      });
      const { post } = await insertNotePost(tx, {
        account: author.account,
        content: "Untouched",
      });

      const result = await arePostsBookmarkedBy(
        tx,
        [post.id],
        viewer.account,
      );

      assertEquals(result, new Set());
    });
  },
});

Deno.test({
  name: "arePostsBookmarkedBy() returns an empty set for an empty input list",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withRollback(async (tx) => {
      const viewer = await insertAccountWithActor(tx, {
        username: "arebookmarkedemptyviewer",
        name: "AreBookmarked Empty Viewer",
        email: "arebookmarkedemptyviewer@example.com",
      });

      const result = await arePostsBookmarkedBy(tx, [], viewer.account);

      assertEquals(result, new Set());
    });
  },
});
