import assert from "node:assert/strict";
import test from "node:test";
import type { Disk } from "flydrive";
import {
  loadImageDataUri,
  putArticleOgImage,
  putProfileOgImage,
  truncateText,
} from "./og.ts";

const smallPngDataUrl = "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const smallPngBytes = Uint8Array.from(
  atob(smallPngDataUrl.slice("data:image/png;base64,".length)),
  (char) => char.charCodeAt(0),
);

function createOgTestDisk() {
  const putKeys: string[] = [];
  return {
    putKeys,
    disk: {
      put(key: string) {
        putKeys.push(key);
        return Promise.resolve(undefined);
      },
    } as unknown as Disk,
  };
}

test("truncateText preserves grapheme clusters", () => {
  assert.equal(truncateText("Flags 👩‍💻👩‍💻", 7), "Flags…");
  assert.equal(truncateText("Cafe\u0301 au lait", 6), "Cafe\u0301…");
});

test("loadImageDataUri returns data URIs unchanged", async () => {
  assert.equal(await loadImageDataUri(smallPngDataUrl), smallPngDataUrl);
});

test("loadImageDataUri embeds remote images", async () => {
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen() {},
  }, () =>
    new Response(smallPngBytes, {
      headers: { "content-type": "image/png" },
    }));
  try {
    const url = `http://${server.addr.hostname}:${server.addr.port}/avatar.png`;
    assert.equal(await loadImageDataUri(url), smallPngDataUrl);
  } finally {
    await server.shutdown();
  }
});

test("putProfileOgImage keys avatars by stable identity", async () => {
  const { disk, putKeys } = createOgTestDisk();
  const input = {
    avatarKey: "avatar/profile.png",
    avatarUrl: smallPngDataUrl,
    bio: "Stable avatar cache identity",
    displayName: "Stable Profile",
    handle: "@stable@localhost",
  };

  const firstKey = await putProfileOgImage(disk, null, input);
  const secondKey = await putProfileOgImage(disk, firstKey, {
    ...input,
    avatarUrl: "https://example.com/avatar.png?signature=changed",
  });

  assert.equal(secondKey, firstKey);
  assert.equal(putKeys.length, 1);
});

test("putArticleOgImage keys avatars by stable identity", async () => {
  const { disk, putKeys } = createOgTestDisk();
  const input = {
    authorName: "Stable Author",
    avatarKey: "avatar/article.png",
    avatarUrl: smallPngDataUrl,
    excerpt: "Stable article avatar cache identity",
    handle: "@stable@localhost",
    language: "en",
    sourceId: "019de14c-1ef2-7728-99a8-60efa271a111",
    title: "Stable article",
  };

  const firstKey = await putArticleOgImage(disk, null, input);
  const secondKey = await putArticleOgImage(disk, firstKey, {
    ...input,
    avatarUrl: "https://example.com/avatar.png?signature=changed",
  });

  assert.equal(secondKey, firstKey);
  assert.equal(putKeys.length, 1);
});
