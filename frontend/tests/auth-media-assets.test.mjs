import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../public/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("login/pet-path-motion-v1.json", root), "utf8"));
const bytesFor = item => readFile(new URL(item.path.slice(1), root));

test("motion bytes match inspected provenance and remain under the web byte budget", async () => {
  for (const [item, limit] of [[manifest.video, 2_000_000], [manifest.poster, 60_000]]) {
    const bytes = await bytesFor(item);
    assert.equal(bytes.length, item.bytes);
    assert.ok(bytes.length < limit);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
  }
  assert.equal(manifest.video.fps, 24);
  assert.equal(manifest.video.frames, 189);
  assert.equal(manifest.video.duration_seconds, manifest.video.frames / manifest.video.fps);
  assert.equal(manifest.video.audio, false);
  assert.equal(manifest.loop.geometrically_seamless, false);
  assert.equal(manifest.loop.crossfade_frames, 4);
});

test("MP4 faststart metadata precedes video payload and poster is a WebP", async () => {
  const video = await bytesFor(manifest.video);
  const boxes = [];
  for (let offset = 0; offset + 8 <= video.length;) {
    const size = video.readUInt32BE(offset);
    assert.ok(size >= 8 && offset + size <= video.length, "complete bounded MP4 box");
    boxes.push(video.toString("ascii", offset + 4, offset + 8));
    offset += size;
  }
  assert.equal(boxes[0], "ftyp");
  assert.ok(boxes.indexOf("moov") > 0);
  assert.ok(boxes.indexOf("moov") < boxes.indexOf("mdat"));
  const poster = await bytesFor(manifest.poster);
  assert.equal(poster.toString("ascii", 0, 4), "RIFF");
  assert.equal(poster.toString("ascii", 8, 12), "WEBP");
});
