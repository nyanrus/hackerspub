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

interface HtmlTagScan {
  end: number;
  tag?: HtmlTag;
}

interface TextRange {
  end: number;
  start: number;
}

function stripMarkdownContainerPrefix(line: string): string {
  let rest = line.replace(/^ {0,3}/, "");
  while (true) {
    const quoted = rest.match(/^> ?(.*)$/);
    if (quoted != null) {
      rest = quoted[1].replace(/^ {0,3}/, "");
      continue;
    }
    const listed = rest.match(/^(?:[-+*]|\d{1,9}[.)]) {1,4}(.*)$/);
    if (listed != null) {
      rest = listed[1].replace(/^ {0,3}/, "");
      continue;
    }
    return rest;
  }
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
    const contentLine = stripMarkdownContainerPrefix(line);
    if (opened == null) {
      const opening = contentLine.match(/^(`{3,}|~{3,})/);
      if (opening != null) {
        const fence = opening[1];
        opened = {
          char: fence[0] as "`" | "~",
          length: fence.length,
          start: offset,
        };
      }
    } else {
      const closing = contentLine.match(/^(`{3,}|~{3,})[ \t]*$/);
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

function findIndentedCodeRanges(
  text: string,
  fencedCodeRanges: readonly TextRange[],
): TextRange[] {
  const ranges: TextRange[] = [];
  let fencedCodeRangeIndex = 0;
  let openedStart: number | undefined;
  let offset = 0;
  while (offset < text.length) {
    fencedCodeRangeIndex = advanceRangeIndex(
      fencedCodeRanges,
      fencedCodeRangeIndex,
      offset,
    );
    const fencedCodeRange = fencedCodeRanges[fencedCodeRangeIndex];
    if (fencedCodeRange != null && offset >= fencedCodeRange.start) {
      if (openedStart != null) {
        ranges.push({ start: openedStart, end: offset });
        openedStart = undefined;
      }
      offset = fencedCodeRange.end;
      continue;
    }

    const newline = text.indexOf("\n", offset);
    const lineEnd = newline < 0 ? text.length : newline + 1;
    const line = text.slice(offset, lineEnd).replace(/\r?\n$/, "");
    if (/^(?: {4}|\t)/.test(line)) {
      openedStart ??= offset;
    } else if (openedStart != null) {
      ranges.push({ start: openedStart, end: offset });
      openedStart = undefined;
    }
    offset = lineEnd;
  }
  if (openedStart != null) {
    ranges.push({ start: openedStart, end: text.length });
  }
  return ranges;
}

function findInlineCodeRanges(
  text: string,
  blockCodeRanges: readonly TextRange[],
): TextRange[] {
  const ranges: TextRange[] = [];
  let blockCodeRangeIndex = 0;
  let opened: { length: number; start: number } | undefined;
  for (let index = 0; index < text.length; index++) {
    blockCodeRangeIndex = advanceRangeIndex(
      blockCodeRanges,
      blockCodeRangeIndex,
      index,
    );
    const blockCodeRange = blockCodeRanges[blockCodeRangeIndex];
    if (blockCodeRange != null && index >= blockCodeRange.start) {
      index = blockCodeRange.end - 1;
      continue;
    }
    if (text[index] !== "`") continue;
    const start = index;
    let length = 1;
    while (text[start + length] === "`") length++;
    if (opened == null) {
      opened = { length, start };
    } else if (length === opened.length) {
      ranges.push({ start: opened.start, end: start + length });
      opened = undefined;
    }
    index = start + length - 1;
  }
  return ranges;
}

function findMarkdownCodeRanges(text: string): TextRange[] {
  const fencedCodeRanges = findFencedCodeRanges(text);
  const blockCodeRanges = [
    ...fencedCodeRanges,
    ...findIndentedCodeRanges(text, fencedCodeRanges),
  ].sort((a, b) => a.start - b.start);
  return [
    ...blockCodeRanges,
    ...findInlineCodeRanges(text, blockCodeRanges),
  ].sort((a, b) => a.start - b.start);
}

function readHtmlTagAt(text: string, start: number): HtmlTagScan {
  if (text[start] !== "<") return { end: start + 1 };
  let index = start + 1;
  let closing = false;
  if (text[index] === "/") {
    closing = true;
    index++;
  }
  const nameStart = index;
  while (/[A-Za-z0-9:-]/.test(text[index] ?? "")) index++;
  if (index === nameStart) return { end: start + 1 };
  const name = text.slice(nameStart, index).toLowerCase();
  let quote: '"' | "'" | undefined;
  for (; index < text.length; index++) {
    const char = text[index];
    if (quote == null && (char === '"' || char === "'")) {
      quote = char;
    } else if (char === quote) {
      quote = undefined;
    } else if (quote == null && char === ">") {
      return {
        end: index + 1,
        tag: { closing, end: index + 1, name, start },
      };
    } else if (quote == null && (char === "\n" || char === "\r")) {
      return { end: index + 1 };
    }
  }
  return { end: text.length };
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
    const scan = readHtmlTagAt(text, index);
    const tag = scan.tag;
    if (tag?.name !== "details") {
      index = scan.end - 1;
      continue;
    }
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
