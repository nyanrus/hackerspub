import assert from "node:assert/strict";
import test from "node:test";
import { loadImageDataUri, truncateText } from "./og.ts";

const smallPngDataUrl = "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const smallPngBytes = Uint8Array.from(
  atob(smallPngDataUrl.slice("data:image/png;base64,".length)),
  (char) => char.charCodeAt(0),
);

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
