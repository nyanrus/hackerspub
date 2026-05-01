import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  findNearestLocale,
  isLocale,
  type Locale,
} from "@hackerspub/models/i18n";
import { generateText, type LanguageModel } from "ai";

const PROMPT_LANGUAGES: Locale[] = (
  await readdir(
    join(import.meta.dirname!, "prompts", "summary"),
    { withFileTypes: true },
  )
).map((f) => f.name.replace(/\.md$/, "")).filter(isLocale);

async function getSummaryPrompt(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string> {
  const promptLanguage = findNearestLocale(targetLanguage, PROMPT_LANGUAGES) ??
    findNearestLocale(sourceLanguage, PROMPT_LANGUAGES) ?? "en";
  const promptPath = join(
    import.meta.dirname!,
    "prompts",
    "summary",
    `${promptLanguage}.md`,
  );
  const promptTemplate = await readFile(promptPath, "utf8");
  const displayNames = new Intl.DisplayNames(promptLanguage, {
    type: "language",
  });
  return promptTemplate.replaceAll(
    "{{targetLanguage}}",
    displayNames.of(targetLanguage) ?? targetLanguage,
  );
}

export interface SummaryOptions {
  model: LanguageModel;
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
}

interface HtmlTag {
  closing: boolean;
  end: number;
  name: string;
  start: number;
}

function readHtmlTagAt(text: string, start: number): HtmlTag | undefined {
  if (text[start] !== "<") return undefined;
  let index = start + 1;
  let closing = false;
  if (text[index] === "/") {
    closing = true;
    index++;
  }
  while (/\s/.test(text[index] ?? "")) index++;
  const nameStart = index;
  while (/[A-Za-z0-9:-]/.test(text[index] ?? "")) index++;
  if (index === nameStart) return undefined;
  const name = text.slice(nameStart, index).toLowerCase();
  let quote: '"' | "'" | undefined;
  for (; index < text.length; index++) {
    const char = text[index];
    if (quote == null && (char === '"' || char === "'")) {
      quote = char;
    } else if (char === quote) {
      quote = undefined;
    } else if (quote == null && char === ">") {
      return { closing, end: index + 1, name, start };
    }
  }
  return { closing, end: text.length, name, start };
}

export function removeDetailsFromSummaryInput(text: string): string {
  let result = "";
  let keepStart = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "<") continue;
    const tag = readHtmlTagAt(text, index);
    if (tag?.name !== "details") continue;
    if (tag.closing) {
      if (depth > 0 && --depth === 0) keepStart = tag.end;
    } else {
      if (depth === 0) result += text.slice(keepStart, tag.start);
      depth++;
    }
    index = tag.end - 1;
  }
  if (depth === 0) result += text.slice(keepStart);
  return result;
}

export async function summarize(options: SummaryOptions): Promise<string> {
  const system = await getSummaryPrompt(
    options.sourceLanguage,
    options.targetLanguage,
  );
  const { text } = await generateText({
    model: options.model,
    system,
    prompt: removeDetailsFromSummaryInput(options.text),
  });
  return text;
}
