import assert from "node:assert/strict";
import { Question } from "@fedify/vocab";
import type { Uuid } from "@hackerspub/models/uuid";
import { toFeaturedCollectionItem } from "./collections.ts";

Deno.test("toFeaturedCollectionItem() returns importable Question posts", async () => {
  const accountId = "00000000-0000-0000-0000-000000000001" as Uuid;
  const item = toFeaturedCollectionItem({
    getActorUri: (identifier: string) =>
      new URL(`https://example.com/ap/actors/${identifier}`),
    getFollowersUri: (identifier: string) =>
      new URL(`https://example.com/ap/actors/${identifier}/followers`),
  }, {
    iri: "https://example.com/objects/question",
    type: "Question",
    actor: { accountId },
    contentHtml: "<p>Poll question</p>",
    language: "en",
    name: "Poll question",
    poll: {
      multiple: false,
      votersCount: 3,
      ends: new Date("2026-05-01T00:00:00Z"),
      options: [
        { index: 0, title: "Yes", votesCount: 2 },
        { index: 1, title: "No", votesCount: 1 },
      ],
    },
    published: new Date("2026-04-01T00:00:00Z"),
    sensitive: false,
    summary: null,
    updated: new Date("2026-04-01T00:00:00Z"),
    url: "https://example.com/@alice/polls/1",
    visibility: "public",
  });

  assert.ok(item instanceof Question);
  assert.equal(
    item.attributionId?.href,
    "https://example.com/ap/actors/00000000-0000-0000-0000-000000000001",
  );
  assert.equal(item.content?.toString(), "<p>Poll question</p>");
  assert.equal(item.name?.toString(), "Poll question");
  const options = await Array.fromAsync(item.getExclusiveOptions());
  assert.deepEqual(options.map((option) => option.name?.toString()), [
    "Yes",
    "No",
  ]);
});
