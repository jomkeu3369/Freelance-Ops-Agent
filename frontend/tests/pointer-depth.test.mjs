import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pointerDepth } from "../features/home/pointer-depth.mjs";

test("pointer depth is neutral at center and clamps outside all edges", () => {
  const rect = { left: 100, top: 200, width: 400, height: 200 };
  const center = pointerDepth(300, 300, rect);
  assert.equal(Math.abs(center.rx), 0); assert.equal(center.ry, 0);
  assert.equal(center.x, 50); assert.equal(center.y, 50);
  assert.deepEqual(pointerDepth(-1000, -1000, rect), { rx: 1.8, ry: -2.2, x: 0, y: 0 });
  assert.deepEqual(pointerDepth(10000, 10000, rect), { rx: -1.8, ry: 2.2, x: 100, y: 100 });
  assert.ok(Object.values(pointerDepth(0, 0, { left: 0, top: 0, width: 0, height: 0 })).every(Number.isFinite));
});

test("pointer motion is restricted and resets for focus, pause, visibility and cleanup", async () => {
  const source = await readFile(new URL("../features/home/use-pointer-depth.ts", import.meta.url), "utf8");
  for (const guard of ["(hover: hover)", "(pointer: fine)", "(prefers-reduced-motion: no-preference)", "document.hidden", "data-motion-paused", ':focus-within', 'pointerleave', 'pointercancel', 'focusin', 'observer.disconnect()', 'pauseObserver.disconnect()']) assert.ok(source.includes(guard), guard);
  assert.match(source, /duration: \.24/);
  assert.match(source, /duration: immediate \? 0 : \.5/);
  assert.match(source, /cancelAnimationFrame/);
  assert.doesNotMatch(source, /setInterval/);
});
