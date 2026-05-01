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

interface TextRange {
  end: number;
  start: number;
}

function findFencedCodeRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let opened:
    | { char: "`" | "~"; length: number; start: number }
    | undefined;
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const lineEnd = newline < 0 ? text.length : newline + 1;
    const line = text.slice(offset, lineEnd).replace(/\r?\n$/, "");
    if (opened == null) {
      const opening = line.match(/^(?: {0,3})(`{3,}|~{3,})/);
      if (opening != null) {
        const fence = opening[1];
        opened = {
          char: fence[0] as "`" | "~",
          length: fence.length,
          start: offset,
        };
      }
    } else {
      const closing = line.match(/^(?: {0,3})(`{3,}|~{3,})[ \t]*$/);
      if (
        closing != null &&
        closing[1][0] === opened.char &&
        closing[1].length >= opened.length
      ) {
        ranges.push({ start: opened.start, end: lineEnd });
        opened = undefined;
      }
    }
    offset = lineEnd;
  }
  if (opened != null) ranges.push({ start: opened.start, end: text.length });
  return ranges;
}

function advanceRangeIndex(
  ranges: readonly TextRange[],
  rangeIndex: number,
  offset: number,
): number {
  while (rangeIndex < ranges.length && offset >= ranges[rangeIndex].end) {
    rangeIndex++;
  }
  return rangeIndex;
}

function findInlineCodeRanges(
  text: string,
  fencedCodeRanges: readonly TextRange[],
): TextRange[] {
  const ranges: TextRange[] = [];
  let fencedCodeRangeIndex = 0;
  for (let index = 0; index < text.length; index++) {
    fencedCodeRangeIndex = advanceRangeIndex(
      fencedCodeRanges,
      fencedCodeRangeIndex,
      index,
    );
    const fencedCodeRange = fencedCodeRanges[fencedCodeRangeIndex];
    if (fencedCodeRange != null && index >= fencedCodeRange.start) {
      index = fencedCodeRange.end - 1;
      continue;
    }
    if (text[index] !== "`") continue;
    const start = index;
    let length = 1;
    while (text[start + length] === "`") length++;

    let searchIndex = start + length;
    let searchFencedCodeRangeIndex = fencedCodeRangeIndex;
    while (searchIndex < text.length) {
      searchFencedCodeRangeIndex = advanceRangeIndex(
        fencedCodeRanges,
        searchFencedCodeRangeIndex,
        searchIndex,
      );
      const searchFencedCodeRange =
        fencedCodeRanges[searchFencedCodeRangeIndex];
      if (
        searchFencedCodeRange != null &&
        searchIndex >= searchFencedCodeRange.start
      ) {
        searchIndex = searchFencedCodeRange.end;
        continue;
      }

      const closeStart = text.indexOf("`", searchIndex);
      if (closeStart < 0) break;
      searchIndex = closeStart;
      let closeLength = 1;
      while (text[closeStart + closeLength] === "`") closeLength++;
      if (closeLength === length) {
        ranges.push({ start, end: closeStart + closeLength });
        index = closeStart + closeLength - 1;
        break;
      }
      searchIndex = closeStart + closeLength;
    }
  }
  return ranges;
}

function findMarkdownCodeRanges(text: string): TextRange[] {
  const fencedCodeRanges = findFencedCodeRanges(text);
  return [
    ...fencedCodeRanges,
    ...findInlineCodeRanges(text, fencedCodeRanges),
  ].sort((a, b) => a.start - b.start);
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
  const markdownCodeRanges = findMarkdownCodeRanges(text);
  let markdownCodeRangeIndex = 0;
  let result = "";
  let keepStart = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    markdownCodeRangeIndex = advanceRangeIndex(
      markdownCodeRanges,
      markdownCodeRangeIndex,
      index,
    );
    const markdownCodeRange = markdownCodeRanges[markdownCodeRangeIndex];
    if (markdownCodeRange != null && index >= markdownCodeRange.start) {
      index = markdownCodeRange.end - 1;
      continue;
    }
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
