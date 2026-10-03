import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../features/home/components/story-metric-entry.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function element(dataset = {}, children = {}) {
  const properties = new Map();
  return {
    dataset,
    textContent: "",
    style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key), getPropertyValue: key => properties.get(key) ?? "" },
    querySelectorAll(selector) { return selector.split(", ").flatMap(part => children[part] ?? []); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    getAttribute(name) { return name === "stroke-dasharray" ? "76.9 100" : null; },
  };
}

function graph() {
  const count = element({ storyCount: "10", countDecimals: "0", countDigits: "1" });
  const prisms = Array.from({ length: 4 }, () => element());
  const meters = Array.from({ length: 4 }, () => element());
  const dayRows = [10, 7, 3, 6].map(length => element({}, { "[data-story-day-cell].is-active": Array.from({ length }, () => element()) }));
  const dayCells = dayRows.flatMap(row => row.querySelectorAll("[data-story-day-cell].is-active"));
  const scene = element({}, {
    "[data-story-count]": [count], "[data-story-prism]": prisms, "[data-story-meter]": meters,
    "[data-story-day-row]": dayRows, "[data-story-day-cell]": dayCells,
  });
  return { scene, count, prisms, meters, dayRows, dayCells };
}

function mount(scenes, { reduced = false, paused = false, ready = true, hidden = false } = {}) {
  const refs = [];
  let refIndex = 0;
  let effect;
  let cleanup;
  const timelines = [];
  const intersections = [];
  const mutations = [];
  const mediaListeners = new Set();
  const visibilityListeners = new Set();
  const motionRoot = element({ motionPaused: String(paused), motionReady: String(ready) });
  const root = element({}, { "[data-story-metric-scene]": scenes });
  root.closest = () => motionRoot;
  const preference = {
    matches: reduced,
    addEventListener: (_, listener) => mediaListeners.add(listener),
    removeEventListener: (_, listener) => mediaListeners.delete(listener),
  };
  const document = {
    hidden,
    addEventListener: (_, listener) => visibilityListeners.add(listener),
    removeEventListener: (_, listener) => visibilityListeners.delete(listener),
  };
  const gsap = {
    timeline(options) {
      const timeline = {
        options, calls: [], killed: false, played: false,
        to(target, vars, at) { this.calls.push({ kind: "to", target, vars, at }); return this; },
        fromTo(target, from, vars, at) {
          this.calls.push({ kind: "fromTo", target, from, vars, at });
          for (const item of Array.from(target)) {
            for (const [key, value] of Object.entries(from)) item.style.setProperty(key, String(value));
          }
          return this;
        },
        play() { this.played = true; },
        kill() { this.killed = true; },
      };
      timelines.push(timeline);
      return timeline;
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return { useRef(value) { const index = refIndex++; return refs[index] ??= { current: value }; }, useEffect(fn) { effect = fn; } };
      if (name === "gsap") return { default: gsap };
      if (name === "react/jsx-runtime") return {};
      throw new Error(`Unexpected module: ${name}`);
    },
    window: { matchMedia: () => preference }, document,
    IntersectionObserver: class {
      constructor(callback, options) { this.callback = callback; this.options = options; this.disconnected = false; intersections.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; mutations.push(this); }
      observe(target, options) { this.target = target; this.options = options; }
      disconnect() { this.disconnected = true; }
    },
  });
  function render(revision = "initial") {
    cleanup?.();
    refIndex = 0;
    const ref = exports.useStoryMetricEntry(revision);
    ref.current = root;
    cleanup = effect();
  }
  render();
  return {
    timelines, intersections, mutations, mediaListeners, visibilityListeners,
    render,
    intersect(scene, ratio = 1) { intersections.at(-1).callback([{ target: scene, isIntersecting: ratio > 0, intersectionRatio: ratio }]); },
    pause(value) { motionRoot.dataset.motionPaused = String(value); mutations.at(-1).callback(); },
    ready(value, paused) { motionRoot.dataset.motionReady = String(value); motionRoot.dataset.motionPaused = String(paused); mutations.at(-1).callback(); },
    reduce(value) { preference.matches = value; for (const listener of mediaListeners) listener(); },
    hide(value) { document.hidden = value; for (const listener of visibilityListeners) listener(); },
    cleanup() { cleanup(); },
  };
}

test("graphs wait for a visible plot, then fan only decorative bodies in one coordinated timeline", () => {
  const { scene, prisms, meters, dayRows } = graph();
  const harness = mount([scene]);
  assert.equal(harness.timelines.length, 0, "No tween runs before the plot enters view");
  harness.intersect(scene, .1);
  assert.equal(harness.timelines.length, 0, "A sliver at the viewport edge does not consume the entry");
  harness.intersect(scene, .5);
  assert.equal(harness.timelines.length, 1);
  const timeline = harness.timelines[0];
  const prism = timeline.calls.find(call => call.target[0] === prisms[0]);
  assert.equal(prism.from["--story-prism-grow"], .025);
  assert.equal(prism.vars["--story-prism-grow"], 1);
  assert.equal(prism.vars.stagger, .1);
  assert.equal(prism.vars.duration, .74);
  assert.equal(prism.from.opacity, undefined, "Opacity on the 3D group would flatten the connected faces");
  assert.equal(prism.from.y, undefined, "All prism bases stay on their shared baseline");
  const meter = timeline.calls.find(call => call.target[0] === meters[0]);
  assert.equal(meter.vars.stagger, .1);
  assert.equal(meter.from.transformOrigin, "left center");
  dayRows.forEach((row, index) => {
    const cells = timeline.calls.find(call => call.target[0] === row.querySelectorAll("[data-story-day-cell].is-active")[0]);
    assert.ok(cells, "Only active half-day cells participate in the wave");
    assert.equal(cells.at, .06 + index * .1);
  });
  assert.equal(timeline.played, true);
  harness.cleanup();
});

test("leaving a graph completes current final values and never replays on scroll return", () => {
  const { scene, count, prisms } = graph();
  const harness = mount([scene]);
  harness.intersect(scene);
  assert.equal(count.textContent, "0");
  harness.intersect(scene, 0);
  assert.equal(count.textContent, "10");
  assert.equal(scene.dataset.storyEntryState, "complete");
  assert.equal(harness.timelines[0].killed, true);
  assert.ok(prisms.every(prism => prism.style.getPropertyValue("--story-prism-grow") === ""));
  harness.intersect(scene);
  assert.equal(harness.timelines.length, 1);
  harness.cleanup();
});

test("scope changes restore newly rendered counts and graphs without replay or stale captured values", () => {
  const { scene, count, prisms } = graph();
  const harness = mount([scene]);
  harness.intersect(scene);
  count.dataset.storyCount = "13";
  harness.render("extended:13:3900000");
  assert.equal(count.textContent, "13");
  assert.ok(prisms.every(prism => prism.style.getPropertyValue("--story-prism-grow") === ""));
  harness.intersect(scene);
  assert.equal(harness.timelines.length, 1);
  harness.cleanup();
});

test("global pause completes active graphs while unvisited graphs remain eligible after resume", () => {
  const current = graph();
  const later = graph();
  const harness = mount([current.scene, later.scene]);
  harness.intersect(current.scene);
  harness.pause(true);
  for (const { scene, count } of [current, later]) {
    assert.equal(scene.dataset.storyEntryState, "complete");
    assert.equal(count.textContent, "10");
  }
  assert.equal(harness.timelines[0].killed, true);
  harness.pause(false);
  harness.intersect(current.scene);
  assert.equal(harness.timelines.length, 1, "The interrupted graph does not replay");
  assert.equal(later.scene.dataset.storyEntryState, "waiting");
  harness.intersect(later.scene);
  assert.equal(harness.timelines.length, 2, "The unvisited graph still gets its one entry");
  harness.cleanup();
});

test("the hydration pause fallback waits for readiness without consuming current or future entries", () => {
  const current = graph();
  const later = graph();
  const harness = mount([current.scene, later.scene], { paused: true, ready: false });
  harness.intersect(current.scene);
  assert.equal(harness.timelines.length, 0);
  assert.equal(current.scene.dataset.storyEntryState, "waiting");
  harness.ready(true, false);
  assert.equal(harness.timelines.length, 1, "An already visible graph enters as soon as preferences are ready");
  assert.equal(current.scene.dataset.storyEntryState, "running");
  assert.equal(later.scene.dataset.storyEntryState, "waiting");
  harness.intersect(later.scene);
  assert.equal(harness.timelines.length, 2, "Offscreen graphs were not consumed during hydration");
  harness.cleanup();
});

test("a real initial user pause remains final until resume and then permits a first entry", () => {
  const { scene, count } = graph();
  const harness = mount([scene], { paused: true, ready: true });
  harness.intersect(scene);
  assert.equal(harness.timelines.length, 0);
  assert.equal(scene.dataset.storyEntryState, "complete");
  assert.equal(count.textContent, "10");
  harness.pause(false);
  assert.equal(harness.timelines.length, 1);
  harness.cleanup();
});

test("initial reduced motion or global pause leaves every graph static at its final values", () => {
  for (const option of [{ reduced: true }, { paused: true }]) {
    const { scene, count } = graph();
    const harness = mount([scene], option);
    harness.intersect(scene);
    assert.equal(harness.timelines.length, 0);
    assert.equal(count.textContent, "10");
    assert.equal(scene.dataset.storyEntryState, "complete");
    harness.cleanup();
  }
});

test("visibility and motion preference changes finish active graphs and cleanup removes all observers", () => {
  for (const interrupt of [harness => harness.hide(true), harness => harness.reduce(true)]) {
    const { scene, count } = graph();
    const harness = mount([scene]);
    harness.intersect(scene);
    interrupt(harness);
    assert.equal(harness.timelines[0].killed, true);
    assert.equal(count.textContent, "10");
    harness.cleanup();
    assert.ok(harness.intersections.every(observer => observer.disconnected));
    assert.ok(harness.mutations.every(observer => observer.disconnected));
    assert.equal(harness.mediaListeners.size, 0);
    assert.equal(harness.visibilityListeners.size, 0);
  }
});
