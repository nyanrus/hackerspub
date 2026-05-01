import assert from "node:assert/strict";
import test from "node:test";
import {
  applyArticleContentSummary,
  startArticleContentSummary,
} from "./article.ts";
import {
  articleContentTable,
  articleSourceTable,
  postTable,
} from "./schema.ts";
import { insertAccountWithActor, withRollback } from "../test/postgres.ts";
import { generateUuidV7 } from "./uuid.ts";

test(
  "applyArticleContentSummary() saves the summary when shorter than the original",
  async () => {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "summaryapply1",
        name: "Summary Apply 1",
        email: "summaryapply1@example.com",
      });
      const sourceId = generateUuidV7();
      const published = new Date("2026-04-15T00:00:00.000Z");
      const longContent =
        "This is a much longer article body that has plenty of words " +
        "so that the summary can fit comfortably below the length of " +
        "the original content without difficulty.";

      await tx.insert(articleSourceTable).values({
        id: sourceId,
        accountId: author.account.id,
        publishedYear: 2026,
        slug: "summary-apply-shorter",
        tags: [],
        allowLlmTranslation: false,
        published,
        updated: published,
      });
      await tx.insert(articleContentTable).values({
        sourceId,
        language: "en",
        title: "Apply shorter summary",
        content: longContent,
        summaryStarted: published,
        published,
        updated: published,
      });

      const content = await tx.query.articleContentTable.findFirst({
        where: { sourceId, language: "en" },
      });
      assert.ok(content != null);

      await applyArticleContentSummary(tx, content, "Short summary.");

      const after = await tx.query.articleContentTable.findFirst({
        where: { sourceId, language: "en" },
      });
      assert.equal(after?.summary, "Short summary.");
      assert.equal(after?.summaryUnnecessary, false);
    });
  },
);

test(
  "applyArticleContentSummary() discards summary and marks unnecessary " +
    "when summary is not shorter than the original",
  async () => {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "summaryapply2",
        name: "Summary Apply 2",
        email: "summaryapply2@example.com",
      });
      const sourceId = generateUuidV7();
      const published = new Date("2026-04-15T00:00:00.000Z");
      const shortContent = "Hello.";
      const longSummary =
        "This summary is far longer than the original article body itself.";

      await tx.insert(articleSourceTable).values({
        id: sourceId,
        accountId: author.account.id,
        publishedYear: 2026,
        slug: "summary-apply-longer",
        tags: [],
        allowLlmTranslation: false,
        published,
        updated: published,
      });
      await tx.insert(articleContentTable).values({
        sourceId,
        language: "en",
        title: "Apply longer summary",
        content: shortContent,
        summaryStarted: published,
        published,
        updated: published,
      });

      const content = await tx.query.articleContentTable.findFirst({
        where: { sourceId, language: "en" },
      });
      assert.ok(content != null);

      await applyArticleContentSummary(tx, content, longSummary);

      const after = await tx.query.articleContentTable.findFirst({
        where: { sourceId, language: "en" },
      });
      assert.equal(after?.summary, null);
      assert.equal(after?.summaryUnnecessary, true);
      assert.equal(after?.summaryStarted, null);
    });
  },
);

test(
  "applyArticleContentSummary() clears a stale article_content.summary " +
    "when discarding",
  async () => {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "summaryapplystale",
        name: "Summary Apply Stale",
        email: "summaryapplystale@example.com",
      });
      const sourceId = generateUuidV7();
      const published = new Date("2026-04-15T00:00:00.000Z");
      const shortContent = "Hi.";
      const longSummary =
        "This summary is much longer than the article body itself.";

      await tx.insert(articleSourceTable).values({
        id: sourceId,
        accountId: author.account.id,
        publishedYear: 2026,
        slug: "summary-apply-stale",
        tags: [],
        allowLlmTranslation: false,
        published,
        updated: published,
      });
      await tx.insert(articleContentTable).values({
        sourceId,
        language: "en",
        title: "Apply summary stale",
        content: shortContent,
        summary: "Stale summary that should be cleared.",
        summaryStarted: published,
        published,
        updated: published,
      });

      const content = await tx.query.articleContentTable.findFirst({
        where: { sourceId, language: "en" },
      });
      assert.ok(content != null);

      await applyArticleContentSummary(tx, content, longSummary);

      const after = await tx.query.articleContentTable.findFirst({
        where: { sourceId, language: "en" },
      });
      assert.equal(after?.summary, null);
      assert.equal(after?.summaryUnnecessary, true);
    });
  },
);

test(
  "startArticleContentSummary() skips rows already marked summaryUnnecessary",
  async () => {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "summaryskip",
        name: "Summary Skip",
        email: "summaryskip@example.com",
      });
      const sourceId = generateUuidV7();
      const published = new Date("2026-04-15T00:00:00.000Z");

      await tx.insert(articleSourceTable).values({
        id: sourceId,
        accountId: author.account.id,
        publishedYear: 2026,
        slug: "summary-skip",
        tags: [],
        allowLlmTranslation: false,
        published,
        updated: published,
      });
      await tx.insert(articleContentTable).values({
        sourceId,
        language: "en",
        title: "Skip summary",
        content: "Body",
        summaryUnnecessary: true,
        published,
        updated: published,
      });

      const content = await tx.query.articleContentTable.findFirst({
        where: { sourceId, language: "en" },
      });
      assert.ok(content != null);

      // Even though we pass a fake model, this should never be invoked
      // because the row is marked unnecessary.
      await startArticleContentSummary(tx, {} as never, content);

      const after = await tx.query.articleContentTable.findFirst({
        where: { sourceId, language: "en" },
      });
      assert.equal(after?.summaryUnnecessary, true);
      assert.equal(after?.summaryStarted, null);
      assert.equal(after?.summary, null);
    });
  },
);

test(
  "applyArticleContentSummary() clears the post-level summary when discarding",
  async () => {
    await withRollback(async (tx) => {
      const author = await insertAccountWithActor(tx, {
        username: "summaryapply3",
        name: "Summary Apply 3",
        email: "summaryapply3@example.com",
      });
      const sourceId = generateUuidV7();
      const postId = generateUuidV7();
      const published = new Date("2026-04-15T00:00:00.000Z");
      const shortContent = "Hi.";
      const longSummary =
        "This summary is much longer than the article body itself.";

      await tx.insert(articleSourceTable).values({
        id: sourceId,
        accountId: author.account.id,
        publishedYear: 2026,
        slug: "summary-apply-post",
        tags: [],
        allowLlmTranslation: false,
        published,
        updated: published,
      });
      await tx.insert(articleContentTable).values({
        sourceId,
        language: "en",
        title: "Apply summary post",
        content: shortContent,
        summaryStarted: published,
        published,
        updated: published,
      });
      await tx.insert(postTable).values({
        id: postId,
        iri: `https://example.com/posts/${postId}`,
        type: "Article",
        actorId: author.actor.id,
        articleSourceId: sourceId,
        name: "Apply summary post",
        contentHtml: "<p>Hi.</p>",
        language: "en",
        summary: "Pre-existing summary that should be cleared.",
        visibility: "public",
        url: `https://example.com/posts/${postId}`,
        published,
        updated: published,
      });

      const content = await tx.query.articleContentTable.findFirst({
        where: { sourceId, language: "en" },
      });
      assert.ok(content != null);

      await applyArticleContentSummary(tx, content, longSummary);

      const after = await tx.query.postTable.findFirst({
        where: { id: postId },
      });
      assert.equal(after?.summary, null);
    });
  },
);
