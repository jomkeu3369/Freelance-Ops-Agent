import test from "node:test";
import assert from "node:assert/strict";
import { restoreInitialAnchor } from "../features/home/initial-anchor.mjs";

function fixture({ hash = "#review", type = "navigate", readyState = "complete", pathname = "/", navigationPath = pathname } = {}) {
  let resolveFonts;
  let rejectFonts;
  let nextFrame = 0;
  const frames = new Map();
  const listeners = new Map();
  const calls = [];
  const window = {
    location: { hash, pathname, href: `https://landing.invalid${pathname}${hash}` },
    performance: { getEntriesByType: () => [{ type, name: `https://landing.invalid${navigationPath}${hash}` }] },
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) {
      const handlers = listeners.get(name);
      handlers?.delete(handler);
      if (!handlers?.size) listeners.delete(name);
    },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const target = { scrollIntoView: options => calls.push({ action: "scroll", options }) };
  const document = {
    defaultView: window, readyState,
    fonts: { ready: new Promise((resolve, reject) => { resolveFonts = resolve; rejectFonts = reject; }) },
    getElementById: id => id === "review" ? target : null,
  };
  const root = { ownerDocument: document, isConnected: true, contains: element => element === target };
  const mount = () => restoreInitialAnchor(root, () => calls.push({ action: "refresh" }));
  return {
    root, target, document, window, calls, frames, listeners, mount,
    async fonts() { resolveFonts(); await Promise.resolve(); },
    async failFonts() { rejectFonts(new Error("font failure")); await Promise.resolve(); },
    emit(name, event = { isTrusted: true }) { for (const handler of [...(listeners.get(name) ?? [])]) handler(event); },
    paint() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
  };
}

test("fresh hash waits for fonts, then scrolls instantly before refreshing without changing history", async () => {
  const page = fixture();
  const originalLocation = { ...page.window.location };
  const cleanup = page.mount();
  assert.equal(page.frames.size, 0);
  await page.fonts();
  assert.equal(page.calls.length, 0);
  assert.equal(page.frames.size, 1);
  page.paint();
  assert.deepEqual(page.calls, [
    { action: "scroll", options: { behavior: "instant", block: "start" } },
    { action: "refresh" },
  ]);
  assert.deepEqual(page.window.location, originalLocation);
  assert.equal(page.listeners.size, 0);
  page.mount();
  page.emit("load");
  page.paint();
  assert.equal(page.calls.length, 2, "A later mount in this document must not snap again");
  cleanup();
});

for (const order of ["fonts first", "load first"]) {
  test(`pending page load and fonts both settle before the frame: ${order}`, async () => {
    const page = fixture({ readyState: "loading" });
    page.mount();
    if (order === "fonts first") await page.fonts();
    else page.emit("load");
    assert.equal(page.frames.size, 0);
    if (order === "fonts first") page.emit("load");
    else await page.fonts();
    assert.equal(page.frames.size, 1);
    page.emit("load");
    assert.equal(page.frames.size, 1);
    page.paint();
    assert.equal(page.calls.length, 2);
  });
}

for (const event of ["wheel", "touchstart", "pointerdown", "keydown", "hashchange", "popstate", "pagehide"]) {
  test(`${event} takes precedence over a pending correction`, async () => {
    const page = fixture();
    page.mount();
    await page.fonts();
    page.emit(event);
    assert.equal(page.frames.size, 0);
    page.paint();
    assert.equal(page.calls.length, 0);
    assert.equal(page.listeners.size, 0);
    page.mount();
    await page.fonts();
    page.paint();
    assert.equal(page.calls.length, 0, "Remounting cannot override prior user intent");
  });
}

test("native setup scroll events and synthetic input do not cancel fragment repair", async () => {
  const page = fixture();
  page.mount();
  page.emit("scroll");
  page.emit("wheel", { isTrusted: false });
  await page.fonts();
  page.paint();
  assert.equal(page.calls.length, 2);
});

test("user input before fonts finish prevents any late frame", async () => {
  const page = fixture({ readyState: "loading" });
  page.mount();
  page.emit("pointerdown");
  page.emit("load");
  await page.fonts();
  assert.equal(page.frames.size, 0);
  assert.equal(page.listeners.size, 0);
  assert.equal(page.calls.length, 0);
});

for (const phase of ["before fonts", "before frame"]) {
  test(`cleanup ${phase} makes deferred completion inert and supports Strict Mode remount`, async () => {
    const page = fixture();
    const cleanup = page.mount();
    if (phase === "before frame") await page.fonts();
    cleanup();
    await page.fonts();
    page.paint();
    assert.equal(page.calls.length, 0);
    assert.equal(page.frames.size, 0);
    assert.equal(page.listeners.size, 0);
    page.mount();
    await Promise.resolve();
    page.paint();
    assert.equal(page.calls.length, 2, "Strict Mode cleanup must not consume the correction");
  });
}

test("back/forward document restoration and client route entry retain their scroll positions", async () => {
  for (const options of [{ type: "back_forward" }, { navigationPath: "/workspace" }]) {
    const page = fixture(options);
    page.mount();
    await page.fonts();
    page.paint();
    assert.equal(page.calls.length, 0);
    assert.equal(page.listeners.size, 0);
  }
});

test("reload honors its current hash once, rather than enforcing a remembered offset", async () => {
  const page = fixture({ type: "reload" });
  page.mount();
  await page.fonts();
  page.paint();
  assert.equal(page.calls.length, 2);
});

test("a later client remount cannot invent an initial hash or revive a departed page's intent", async () => {
  for (const hash of ["", "#review"]) {
    const page = fixture({ hash });
    const cleanup = page.mount();
    page.window.location.href = "https://landing.invalid/workspace";
    cleanup();
    page.window.location.hash = "#review";
    page.window.location.href = "https://landing.invalid/#review";
    page.mount();
    await page.fonts();
    page.paint();
    assert.equal(page.calls.length, 0);
    assert.equal(page.listeners.size, 0);
  }
});

test("empty, top, malformed and missing hashes are harmless", async () => {
  for (const hash of ["", "#", "#top", "#TOP", "#%E0%A4%A", "#missing", "#:~:text=review"]) {
    const page = fixture({ hash });
    page.mount();
    await page.fonts();
    page.paint();
    assert.equal(page.calls.length, 0, hash);
    assert.equal(page.listeners.size, 0, hash);
  }
});

test("encoded IDs are resolved as IDs, and outside-root targets are never scrolled", async () => {
  const encoded = fixture({ hash: "#%72eview" });
  encoded.mount();
  await encoded.fonts();
  encoded.paint();
  assert.equal(encoded.calls.length, 2);
  const outside = fixture();
  outside.root.contains = () => false;
  outside.mount();
  await outside.fonts();
  outside.paint();
  assert.equal(outside.calls.length, 0);
  assert.equal(outside.listeners.size, 0);
});

test("changed URLs, removed targets and unmounted roots cannot receive a stale correction", async () => {
  for (const invalidate of [
    page => { page.window.location.href = "https://landing.invalid/#evidence"; },
    page => { page.document.getElementById = () => null; },
    page => { page.root.contains = () => false; },
    page => { page.root.isConnected = false; },
  ]) {
    const page = fixture();
    page.mount();
    await page.fonts();
    invalidate(page);
    page.paint();
    assert.equal(page.calls.length, 0);
    assert.equal(page.listeners.size, 0);
  }
});

test("font readiness failure cleans up without an unhandled rejection or scroll", async () => {
  const page = fixture();
  page.mount();
  await page.failFonts();
  page.paint();
  assert.equal(page.calls.length, 0);
  assert.equal(page.listeners.size, 0);
});
