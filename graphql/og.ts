import { Resvg } from "@resvg/resvg-js";
import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";
import type { Disk } from "flydrive";
import { canonicalize } from "json-canonicalize";
import satori from "satori";

const OG_VERSION = "v2-2";
const OG_NAMESPACE = "og/v2";
const OG_SIZE = { width: 1200, height: 630 } as const;

type Weight = 400 | 600;
type FontStyle = "normal";

interface FontOptions {
  data: ArrayBuffer;
  name: string;
  weight: Weight;
  style: FontStyle;
  lang?: string;
}

type OgElement = {
  type: string;
  props: Record<string, unknown>;
};

interface ProfileOgImageInput {
  avatarUrl: string;
  bio: string;
  displayName: string;
  handle: string;
}

interface ArticleOgImageInput {
  authorName: string;
  avatarUrl: string;
  excerpt: string;
  handle: string;
  language: string;
  sourceId: string;
  title: string;
}

let fontsPromise: Promise<FontOptions[]> | undefined;
let brandLogoDataUriPromise: Promise<string> | undefined;

async function loadFont(filename: string): Promise<ArrayBuffer> {
  const data = await Deno.readFile(join(
    import.meta.dirname!,
    "..",
    "web",
    "fonts",
    filename,
  ));
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  );
}

function loadFonts(): Promise<FontOptions[]> {
  fontsPromise ??= Promise.all([
    loadFont("NotoSans-Regular.ttf").then((data) => ({
      name: "Noto Sans",
      data,
      weight: 400 as const,
      style: "normal" as const,
    })),
    loadFont("NotoSans-SemiBold.ttf").then((data) => ({
      name: "Noto Sans",
      data,
      weight: 600 as const,
      style: "normal" as const,
    })),
    loadFont("NotoSansJP-Regular.ttf").then((data) => ({
      name: "Noto Sans JP",
      data,
      weight: 400 as const,
      style: "normal" as const,
      lang: "ja-JP",
    })),
    loadFont("NotoSansKR-Regular.ttf").then((data) => ({
      name: "Noto Sans KR",
      data,
      weight: 400 as const,
      style: "normal" as const,
      lang: "ko-KR",
    })),
    loadFont("NotoSansSC-Regular.ttf").then((data) => ({
      name: "Noto Sans SC",
      data,
      weight: 400 as const,
      style: "normal" as const,
      lang: "zh-CN",
    })),
    loadFont("NotoSansTC-Regular.ttf").then((data) => ({
      name: "Noto Sans TC",
      data,
      weight: 400 as const,
      style: "normal" as const,
      lang: "zh-TW",
    })),
    loadFont("NotoEmoji-Regular.ttf").then((data) => ({
      name: "Noto Emoji",
      data,
      weight: 400 as const,
      style: "normal" as const,
    })),
  ]);
  return fontsPromise;
}

async function loadBrandLogoDataUri(): Promise<string> {
  brandLogoDataUriPromise ??= Deno.readFile(
    join(import.meta.dirname!, "..", "web-next", "public", "logo-dark.svg"),
  ).then((svg) => {
    let binary = "";
    for (const byte of svg) binary += String.fromCharCode(byte);
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  });
  return brandLogoDataUriPromise;
}

function h(
  type: string,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): OgElement {
  return {
    type,
    props: {
      ...(props ?? {}),
      children: children.length === 1 ? children[0] : children,
    },
  };
}

function truncateText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function brandFooter(logo: string): OgElement {
  return h(
    "div",
    {
      style: {
        alignItems: "center",
        background: "#000000",
        bottom: 0,
        display: "flex",
        flexDirection: "row",
        height: "114px",
        justifyContent: "flex-start",
        left: 0,
        padding: "0 82px",
        position: "absolute",
        right: 0,
      },
    },
    h("img", {
      src: logo,
      width: 316,
      height: 81,
      style: { objectFit: "contain" },
    }),
  );
}

async function profileOgElement(
  input: ProfileOgImageInput,
): Promise<OgElement> {
  const logo = await loadBrandLogoDataUri();
  const bio = truncateText(input.bio, 230);
  return h(
    "div",
    {
      style: {
        width: "1200px",
        height: "630px",
        background: "#ffffff",
        color: "#111111",
        display: "flex",
        flexDirection: "column",
        fontFamily:
          "Noto Sans, Noto Sans JP, Noto Sans KR, Noto Sans SC, Noto Sans TC, Noto Emoji",
        position: "relative",
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          gap: "46px",
          padding: "76px 82px 62px",
          width: "1200px",
          height: "516px",
        },
      },
      h("img", {
        src: input.avatarUrl,
        width: 172,
        height: 172,
        style: {
          borderRadius: "86px",
          border: "1px solid #d4d4d4",
          objectFit: "cover",
          flexShrink: 0,
        },
      }),
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            paddingTop: "4px",
            width: "800px",
          },
        },
        h(
          "div",
          {
            style: {
              fontSize: "60px",
              fontWeight: 600,
              lineHeight: 1.06,
              letterSpacing: "0",
              maxHeight: "132px",
              overflow: "hidden",
            },
          },
          truncateText(input.displayName, 64),
        ),
        h(
          "div",
          {
            style: {
              color: "#737373",
              fontSize: "31px",
              lineHeight: 1.25,
              marginTop: "18px",
            },
          },
          input.handle,
        ),
        h(
          "div",
          {
            style: {
              color: "#262626",
              display: bio === "" ? "none" : "flex",
              fontSize: "34px",
              lineHeight: 1.34,
              marginTop: "38px",
              maxHeight: "184px",
              overflow: "hidden",
              whiteSpace: "pre-wrap",
            },
          },
          bio,
        ),
      ),
    ),
    brandFooter(logo),
  );
}

async function articleOgElement(
  input: ArticleOgImageInput,
): Promise<OgElement> {
  const logo = await loadBrandLogoDataUri();
  const excerpt = truncateText(input.excerpt, 260);
  return h(
    "div",
    {
      style: {
        width: "1200px",
        height: "630px",
        background: "#ffffff",
        color: "#111111",
        display: "flex",
        flexDirection: "column",
        fontFamily:
          "Noto Sans, Noto Sans JP, Noto Sans KR, Noto Sans SC, Noto Sans TC, Noto Emoji",
        position: "relative",
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          padding: "68px 82px 56px",
          width: "1200px",
          height: "516px",
        },
      },
      h(
        "div",
        {
          style: {
            alignItems: "center",
            display: "flex",
            flexDirection: "row",
            gap: "22px",
            height: "92px",
          },
        },
        h("img", {
          src: input.avatarUrl,
          width: 82,
          height: 82,
          style: {
            borderRadius: "41px",
            border: "1px solid #d4d4d4",
            objectFit: "cover",
            flexShrink: 0,
          },
        }),
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            },
          },
          h(
            "div",
            {
              style: {
                fontSize: "32px",
                fontWeight: 600,
                lineHeight: 1.15,
              },
            },
            truncateText(input.authorName, 52),
          ),
          h(
            "div",
            {
              style: {
                color: "#737373",
                fontSize: "23px",
                lineHeight: 1.2,
                marginTop: "7px",
              },
            },
            input.handle,
          ),
        ),
      ),
      h(
        "div",
        {
          lang: input.language,
          style: {
            fontSize: "58px",
            fontWeight: 600,
            lineHeight: 1.13,
            letterSpacing: "0",
            marginTop: "42px",
            maxHeight: "198px",
            overflow: "hidden",
            width: "1018px",
          },
        },
        truncateText(input.title, 94),
      ),
      h(
        "div",
        {
          lang: input.language,
          style: {
            color: "#404040",
            display: excerpt === "" ? "none" : "flex",
            fontSize: "30px",
            lineHeight: 1.36,
            marginTop: "28px",
            maxHeight: "124px",
            overflow: "hidden",
            whiteSpace: "pre-wrap",
            width: "1018px",
          },
        },
        excerpt,
      ),
    ),
    brandFooter(logo),
  );
}

async function renderPng(element: OgElement): Promise<Uint8Array> {
  const svg = await satori(element as Parameters<typeof satori>[0], {
    ...OG_SIZE,
    fonts: await loadFonts(),
  });
  return new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: OG_SIZE.width,
    },
  }).render().asPng();
}

async function putOgImage(
  disk: Disk,
  existingKey: string | null | undefined,
  input: unknown,
  element: OgElement,
): Promise<string> {
  const canonicalInput = canonicalize({
    version: OG_VERSION,
    size: OG_SIZE,
    input,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalInput),
  );
  const key = `${OG_NAMESPACE}/${encodeHex(digest)}.png`;
  if (existingKey === key) return key;
  const png = await renderPng(element);
  await disk.put(key, png);
  return key;
}

export async function putProfileOgImage(
  disk: Disk,
  existingKey: string | null | undefined,
  input: ProfileOgImageInput,
): Promise<string> {
  return await putOgImage(
    disk,
    existingKey,
    { type: "profile", ...input },
    await profileOgElement(input),
  );
}

export async function putArticleOgImage(
  disk: Disk,
  existingKey: string | null | undefined,
  input: ArticleOgImageInput,
): Promise<string> {
  return await putOgImage(
    disk,
    existingKey,
    { type: "article", ...input },
    await articleOgElement(input),
  );
}

export async function renderProfileOgImageForPreview(
  input: ProfileOgImageInput,
): Promise<Uint8Array> {
  return await renderPng(await profileOgElement(input));
}

export async function renderArticleOgImageForPreview(
  input: ArticleOgImageInput,
): Promise<Uint8Array> {
  return await renderPng(await articleOgElement(input));
}
