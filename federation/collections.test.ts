import assert from "node:assert/strict";
import { Question } from "@fedify/vocab";
import { toFeaturedCollectionItem } from "./collections.ts";

Deno.test("toFeaturedCollectionItem() preserves Question posts", () => {
  const item = toFeaturedCollectionItem({
    iri: "https://example.com/objects/question",
    type: "Question",
  });

  assert.ok(item instanceof Question);
});
