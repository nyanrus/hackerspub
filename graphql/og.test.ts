import assert from "node:assert/strict";
import test from "node:test";
import { truncateText } from "./og.ts";

test("truncateText preserves grapheme clusters", () => {
  assert.equal(truncateText("Flags 👩‍💻👩‍💻", 7), "Flags…");
  assert.equal(truncateText("Cafe\u0301 au lait", 6), "Cafe\u0301…");
});
