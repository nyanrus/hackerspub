import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import { removeDetailsFromSummaryInput, summarize } from "./summary.ts";

test("removeDetailsFromSummaryInput() removes details blocks", () => {
  const input = [
    "# Quiz",
    "",
    "Visible question.",
    "",
    "<details>",
    "<summary>Answer</summary>",
    "",
    "Hidden answer.",
    "",
    "</details>",
    "",
    "Visible outro.",
  ].join("\n");

  const output = removeDetailsFromSummaryInput(input);

  assert.equal(output.includes("Visible question."), true);
  assert.equal(output.includes("Visible outro."), true);
  assert.equal(output.includes("Answer"), false);
  assert.equal(output.includes("Hidden answer."), false);
});

test(
  "removeDetailsFromSummaryInput() handles attributes, case, and nesting",
  () => {
    const input = [
      "Visible before.",
      '<DETAILS open data-kind="spoiler">',
      "<summary>Outer</summary>",
      "Outer secret.",
      "<details>",
      "<summary>Inner</summary>",
      "Inner secret.",
      "</details>",
      "More outer secret.",
      "</DETAILS>",
      "Visible after.",
    ].join("\n");

    const output = removeDetailsFromSummaryInput(input);

    assert.equal(output.includes("Visible before."), true);
    assert.equal(output.includes("Visible after."), true);
    assert.equal(output.includes("Outer"), false);
    assert.equal(output.includes("Inner"), false);
    assert.equal(output.includes("secret"), false);
  },
);

test("removeDetailsFromSummaryInput() removes unclosed details to EOF", () => {
  const input = [
    "Visible.",
    "<details>",
    "<summary>Answer</summary>",
    "Hidden answer.",
    "Still hidden.",
  ].join("\n");

  const output = removeDetailsFromSummaryInput(input);

  assert.equal(output.includes("Visible."), true);
  assert.equal(output.includes("Answer"), false);
  assert.equal(output.includes("Hidden answer."), false);
  assert.equal(output.includes("Still hidden."), false);
});

test("removeDetailsFromSummaryInput() preserves fenced code blocks", () => {
  const input = [
    "Visible before.",
    "",
    "```html",
    "<details>",
    "<summary>Example</summary>",
    "Example body.",
    "</details>",
    "```",
    "",
    "<details>",
    "<summary>Answer</summary>",
    "Hidden answer.",
    "</details>",
    "",
    "Visible after.",
  ].join("\n");

  const output = removeDetailsFromSummaryInput(input);

  assert.equal(output.includes("<summary>Example</summary>"), true);
  assert.equal(output.includes("Example body."), true);
  assert.equal(output.includes("Visible after."), true);
  assert.equal(output.includes("Answer"), false);
  assert.equal(output.includes("Hidden answer."), false);
});

test("summarize() sends text without details blocks to the model", async () => {
  let promptText: string | undefined;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const userMessage = options.prompt.find((m) => m.role === "user");
      const textPart = userMessage?.content[0];
      promptText = textPart?.type === "text" ? textPart.text : undefined;
      return {
        content: [{ type: "text", text: "A safe summary." }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 10,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: 5,
            text: 5,
            reasoning: undefined,
          },
        },
        warnings: [],
      };
    },
  });

  const summary = await summarize({
    model,
    sourceLanguage: "en",
    targetLanguage: "en",
    text: [
      "Visible question.",
      "<details>",
      "<summary>Answer</summary>",
      "Hidden answer.",
      "</details>",
    ].join("\n"),
  });

  assert.equal(summary, "A safe summary.");
  assert.equal(promptText?.includes("Visible question."), true);
  assert.equal(promptText?.includes("Answer"), false);
  assert.equal(promptText?.includes("Hidden answer."), false);
});
