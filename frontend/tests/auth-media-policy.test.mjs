import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authMediaPolicy, createAuthMediaController, isAuthMediaPath, normalizeAuthMediaSources } from "../features/workspace/auth/auth-media-policy.mjs";

const sources = [{ src: "/media/approved-auth.mp4", type: "video/mp4" }, { src: "/media/approved-auth.webm", type: "video/webm" }];
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function events() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatch(name) { for (const listener of listeners.get(name) || []) listener(); },
    listenerCount() { return [...listeners.values()].reduce((sum, value) => sum + value.size, 0); },
  };
}

function mount({ reducedMotion = false, saveData = false, hidden = false, suppliedSources = sources, observer = true, legacyMotion = false, play } = {}) {
  const host = {};
  const states = [];
  const nodes = [];
  let viewportObserver;
  const video = {
    ...events(), playCalls: 0, pauseCalls: 0, loadCalls: 0,
    appendChild(node) { nodes.push(node); },
    removeAttribute() {},
    load() { this.loadCalls++; },
    pause() { this.pauseCalls++; },
    play() { this.playCalls++; return play ? play(this) : Promise.resolve(); },
  };
  const document = { ...events(), hidden, createElement(tag) {
    assert.equal(tag, "source");
    const node = { ...events(), remove() { nodes.splice(nodes.indexOf(node), 1); } };
    return node;
  } };
  const motion = { ...events(), matches: reducedMotion };
  if (legacyMotion) {
    motion.addListener = callback => motion.listeners.set("change", new Set([callback]));
    motion.removeListener = callback => motion.listeners.get("change").delete(callback);
    delete motion.addEventListener;
    delete motion.removeEventListener;
  }
  const connection = { ...events(), saveData };
  const environment = {
    document, navigator: { connection }, matchMedia: () => motion,
    IntersectionObserver: observer ? class {
      constructor(callback) { viewportObserver = { callback, disconnected: false }; }
      observe(target) { assert.equal(target, host); }
      disconnect() { viewportObserver.disconnected = true; }
    } : undefined,
  };
  const controller = createAuthMediaController({ video, host, sources: suppliedSources, environment, onStateChange: state => states.push(state) });
  return {
    controller, host, video, document, motion, connection, states, nodes,
    get state() { return states.at(-1); },
    get observer() { return viewportObserver; },
    show(isIntersecting = true) { viewportObserver.callback([{ target: host, isIntersecting }]); },
    visibility(value) { document.hidden = value; document.dispatch("visibilitychange"); },
  };
}

test("only explicit root-relative MP4/WebM assets are accepted; no default URL is invented", () => {
  for (const path of ["https://cdn.example/video.mp4", "//cdn.example/video.mp4", "/\\cdn.example/video.mp4", "blob:abc", "data:video/mp4;base64,aaa", "video.mp4", " /video.mp4", "/\n/video.mp4", undefined]) assert.equal(isAuthMediaPath(path), false, String(path));
  assert.equal(isAuthMediaPath("/media/approved-auth.mp4?v=2"), true);
  assert.deepEqual(normalizeAuthMediaSources(), []);
  assert.deepEqual(normalizeAuthMediaSources([...sources, ...sources, { src: "/movie.gif", type: "image/gif" }]), sources);
  const page = mount({ suppliedSources: [] });
  page.show();
  assert.equal(page.state.status, "absent");
  assert.equal(page.state.canToggle, false);
  assert.equal(page.video.playCalls, 0);
  assert.equal(page.video.loadCalls, 0);
  assert.equal(page.nodes.length, 0);
  page.controller.dispose();
});

test("policy requires every playback condition and never lets a user override reduced motion or Save-Data", () => {
  assert.deepEqual(authMediaPolicy(), { canLoad: false, canPlay: false });
  const visible = { hasSources: true, inViewport: true };
  assert.deepEqual(authMediaPolicy(visible), { canLoad: true, canPlay: true });
  for (const flag of ["hidden", "userPaused", "blocked"]) assert.deepEqual(authMediaPolicy({ ...visible, [flag]: true }), { canLoad: true, canPlay: false });
  for (const flag of ["reducedMotion", "saveData", "failed"]) assert.deepEqual(authMediaPolicy({ ...visible, [flag]: true }), { canLoad: false, canPlay: false });
});

for (const option of ["reducedMotion", "saveData"]) {
  test(`${option} prevents all video source attachment and playback, including pause-control attempts`, () => {
    const page = mount({ [option]: true });
    page.show();
    page.controller.toggle();
    assert.equal(page.state.status, "disabled");
    assert.equal(page.state.canToggle, false);
    assert.equal(page.nodes.length, 0);
    assert.equal(page.video.loadCalls, 0);
    assert.equal(page.video.playCalls, 0);
    page.controller.dispose();
  });
}

test("initial offscreen and hidden states defer loading; visible media is muted, inline and looping", async () => {
  const page = mount({ hidden: true });
  assert.equal(page.video.loadCalls, 0);
  page.show();
  assert.equal(page.video.loadCalls, 0);
  page.visibility(false);
  assert.deepEqual(page.nodes.map(({ src, type }) => ({ src, type })), sources);
  assert.equal(page.video.playCalls, 1);
  for (const key of ["muted", "defaultMuted", "loop", "playsInline"]) assert.equal(page.video[key], true);
  await flush();
  assert.equal(page.state.status, "loading", "play promise alone does not reveal an empty video");
  page.video.dispatch("playing");
  assert.equal(page.state.status, "playing");
  page.controller.dispose();
});

test("hidden and offscreen pause playback and resume without reattaching or reloading sources", async () => {
  const page = mount();
  page.show();
  await flush();
  page.video.dispatch("playing");
  page.visibility(true);
  assert.equal(page.state.status, "paused");
  assert.equal(page.state.paused, false, "automatic suspension must not select the user's still mode");
  page.show(false);
  assert.equal(page.state.paused, false);
  page.visibility(false);
  assert.equal(page.video.playCalls, 1);
  page.video.dispatch("playing");
  assert.equal(page.state.status, "paused", "a late native autoplay event cannot bypass the policy");
  page.show();
  assert.equal(page.video.playCalls, 2);
  assert.equal(page.video.loadCalls, 1);
  assert.equal(page.nodes.length, 2);
  page.controller.dispose();
});

test("explicit user pause survives viewport and document changes until the user resumes", async () => {
  const page = mount();
  page.show();
  await flush();
  page.video.dispatch("playing");
  page.controller.toggle();
  assert.equal(page.state.status, "paused");
  assert.equal(page.state.paused, true);
  page.show(false);
  page.visibility(true);
  page.visibility(false);
  page.show();
  assert.equal(page.video.playCalls, 1);
  assert.equal(page.state.paused, true);
  page.video.dispatch("playing");
  assert.equal(page.state.status, "paused", "late native playback cannot override explicit still mode");
  assert.equal(page.state.paused, true);
  page.controller.toggle();
  assert.equal(page.state.paused, false);
  assert.equal(page.video.playCalls, 2);
  page.controller.dispose();
});

test("runtime preference changes immediately pause, detach sources and permit a later clean reload", async () => {
  for (const [target, property] of [["motion", "matches"], ["connection", "saveData"]]) {
    const page = mount();
    page.show();
    await flush();
    page.video.dispatch("playing");
    page[target][property] = true;
    page[target].dispatch("change");
    assert.equal(page.state.status, "disabled");
    assert.equal(page.nodes.length, 0);
    page[target][property] = false;
    page[target].dispatch("change");
    assert.equal(page.nodes.length, 2);
    assert.equal(page.video.playCalls, 2);
    page.controller.dispose();
  }
});

test("autoplay rejection exposes a deliberate retry; visibility changes cannot silently retry", async () => {
  let allowed = false;
  const page = mount({ play: () => allowed ? Promise.resolve() : Promise.reject(new Error("NotAllowedError")) });
  page.show();
  await flush();
  assert.equal(page.state.status, "blocked");
  assert.equal(page.state.paused, true);
  assert.equal(page.state.canToggle, true);
  page.show(false);
  page.show();
  page.visibility(true);
  page.visibility(false);
  assert.equal(page.video.playCalls, 1);
  allowed = true;
  page.controller.toggle();
  await flush();
  page.video.dispatch("playing");
  assert.equal(page.state.status, "playing");
  assert.equal(page.video.playCalls, 2);
  page.controller.dispose();
});

test("synchronous play refusal and media errors keep the static fallback path and never loop retries", () => {
  const refused = mount({ play: () => { throw new Error("Refused"); } });
  refused.show();
  assert.equal(refused.state.status, "blocked");
  refused.controller.dispose();
  const failed = mount();
  failed.show();
  failed.video.dispatch("error");
  assert.equal(failed.state.status, "error");
  assert.equal(failed.state.canToggle, false);
  assert.equal(failed.nodes.length, 0);
  failed.show();
  failed.controller.toggle();
  assert.equal(failed.video.playCalls, 1);
  failed.controller.dispose();
});

test("source failures permit the alternate encoding, then stop cleanly when all encodings fail", () => {
  const page = mount();
  page.show();
  const attached = [...page.nodes];
  attached[0].dispatch("error");
  assert.equal(page.nodes.length, 2);
  assert.notEqual(page.state.status, "error");
  attached[1].dispatch("error");
  assert.equal(page.state.status, "error");
  assert.equal(page.nodes.length, 0);
  for (const node of attached) assert.equal(node.listenerCount(), 0);
  page.controller.dispose();
});

test("a stale play rejection after suspension cannot block the next attempt", async () => {
  const attempts = [];
  const page = mount({ play: () => { const attempt = Promise.withResolvers(); attempts.push(attempt); return attempt.promise; } });
  page.show();
  page.visibility(true);
  page.visibility(false);
  attempts[0].reject(new Error("AbortError"));
  await flush();
  assert.equal(page.state.status, "loading");
  attempts[1].resolve();
  await flush();
  page.video.dispatch("playing");
  assert.equal(page.state.status, "playing");
  page.controller.dispose();
});

test("cleanup is idempotent, cancels media, removes every observer/listener and ignores late promises", async () => {
  const pending = Promise.withResolvers();
  const page = mount({ play: () => pending.promise, legacyMotion: true });
  page.show();
  const notifications = page.states.length;
  page.controller.dispose();
  const loads = page.video.loadCalls;
  page.controller.dispose();
  page.controller.toggle();
  pending.reject(new Error("AbortError"));
  await flush();
  assert.equal(page.states.length, notifications);
  assert.equal(page.nodes.length, 0);
  assert.equal(page.observer.disconnected, true);
  for (const target of [page.video, page.document, page.motion, page.connection]) assert.equal(target.listenerCount(), 0);
  assert.equal(page.video.loadCalls, loads);
});

test("a browser without IntersectionObserver still obeys preferences and document visibility", () => {
  const page = mount({ observer: false });
  assert.equal(page.video.playCalls, 1);
  page.visibility(true);
  assert.equal(page.state.status, "paused");
  page.controller.dispose();
});

test("component SSR has no video src, preserves poster/fallback, and exposes a keyboard-accessible button", async () => {
  const source = await readFile(new URL("../features/workspace/auth/auth-backdrop.tsx", import.meta.url), "utf8");
  const video = source.match(/<video[\s\S]*?\/>/)?.[0];
  assert.ok(video);
  assert.doesNotMatch(video, /\ssrc=/);
  for (const attribute of ["autoPlay", "muted", "loop", "playsInline", 'preload="none"', 'tabIndex={-1}', 'hidden={state.status !== "playing"}']) assert.ok(video.includes(attribute), attribute);
  assert.match(source, /className="auth-backdrop__fallback">\{children\}/);
  assert.match(source, /className="auth-backdrop__poster"/);
  assert.match(source, /className="auth-backdrop__visual" ref=\{host\}/, "observe the nonzero visual, not the layout wrapper");
  assert.match(source, /<button\s+type="button"/);
  assert.match(source, /aria-label=\{state.paused \? resumeLabel : pauseLabel\}/);
  assert.match(source, /title=\{state.paused \? resumeLabel : pauseLabel\}/);
  const toggle = source.match(/<button\b[\s\S]*?<\/button>/)?.[0];
  assert.ok(toggle);
  assert.match(toggle, /<span aria-hidden="true">\{state.paused \? "▶️" : "⏸️"\}<\/span>/);
  assert.equal((toggle.match(/<span\b/g) || []).length, 1, "no visible text label beside the emoji");
  assert.match(source, /staticPoster\?:\s*string/);
  assert.match(source, /isAuthMediaPath\(staticPoster\)/, "the original still obeys same-origin media policy too");
  assert.match(video, /poster=\{safePoster\}/, "native video retains its matching loading poster");
  assert.match(source, /\}, \[sourceKey\]\)/, "equivalent source arrays do not reset explicit user pause");
});

for (const [target, property] of [["motion", "matches"], ["connection", "saveData"]]) {
  test(`explicit pause survives a temporary ${target} preference change without a silent restart`, async () => {
    const page = mount();
    page.show();
    await flush();
    page.video.dispatch("playing");
    page.controller.toggle();
    page[target][property] = true;
    page[target].dispatch("change");
    assert.equal(page.state.status, "disabled");
    assert.equal(page.state.paused, true);
    assert.equal(page.nodes.length, 0);
    page.controller.toggle();
    page[target][property] = false;
    page[target].dispatch("change");
    assert.equal(page.state.status, "paused");
    assert.equal(page.state.paused, true);
    assert.equal(page.video.playCalls, 1);
    page.controller.toggle();
    assert.equal(page.state.paused, false);
    assert.equal(page.video.playCalls, 2);
    assert.equal(page.nodes.length, sources.length);
    page.controller.dispose();
  });
}

test("a pending play refusal cannot replace the user's explicit pause or block a newer resume", async () => {
  const attempts = [];
  const page = mount({ play: () => { const attempt = Promise.withResolvers(); attempts.push(attempt); return attempt.promise; } });
  page.show();
  page.controller.toggle();
  assert.equal(page.state.status, "paused");
  assert.equal(page.state.paused, true);
  attempts[0].reject(new Error("NotAllowedError"));
  await flush();
  assert.equal(page.state.status, "paused");
  assert.equal(page.state.paused, true);
  page.controller.toggle();
  assert.equal(page.state.status, "loading");
  assert.equal(page.state.paused, false);
  attempts[1].resolve();
  await flush();
  page.video.dispatch("playing");
  assert.equal(page.state.status, "playing");
  assert.equal(page.video.playCalls, 2);
  page.controller.dispose();
});
