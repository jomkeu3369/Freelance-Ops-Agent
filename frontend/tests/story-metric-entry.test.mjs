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
  count.textContent = "10";
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

function evidenceColumns() {
  return [
    { value: "3", decimals: "0", digits: "2", selector: "[data-story-task-marker]", size: 3 },
    { value: "10", decimals: "0", digits: "1", selector: "[data-story-segment]", size: 13 },
    { value: "3", decimals: "1", digits: "1", selector: "[data-story-meter]", size: 1 },
  ].map(({ value, decimals, digits, selector, size }, index) => {
    const count = element({ storyCount: value, countDecimals: decimals, countDigits: digits });
    const accessibleCount = element();
    count.textContent = accessibleCount.textContent = Number(value).toFixed(Number(decimals)).padStart(Number(digits), "0");
    const fills = Array.from({ length: size }, () => element());
    const scene = element({ storyEntryOrder: String(index) }, { "[data-story-count]": [count], ".sr-only": [accessibleCount], [selector]: fills });
    return { scene, count, accessibleCount, fills };
  });
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
            for (const [key, value] of Object.entries(from)) {
              const property = key === "transformOrigin" ? "transform-origin" : ["scaleX", "scaleY", "y"].includes(key) ? "transform" : key;
              item.style.setProperty(property, String(value));
            }
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

test("evidence columns offset each counter and its fills left to right within one bounded entry", () => {
  const columns = evidenceColumns();
  assert.deepEqual(columns.map(column => column.count.textContent), ["03", "10", "3.0"], "The server-rendered values start truthful");
  const harness = mount(columns.map(column => column.scene));
  assert.equal(harness.timelines.length, 0);
  assert.deepEqual(columns.map(column => column.count.textContent), ["00", "0", "0.0"], "Waiting decorative counters are prepared before the scene is revealed");
  columns.forEach(({ scene }) => harness.intersect(scene, .34));
  assert.equal(harness.timelines.length, 0, "The existing 35% plot threshold still controls entry");
  assert.ok(columns.every(column => column.scene.dataset.storyEntryState === "waiting"));
  assert.deepEqual(columns.map(column => column.count.textContent), ["00", "0", "0.0"], "A partially visible column never flashes its final count");
  assert.deepEqual(columns.map(column => column.accessibleCount.textContent), ["03", "10", "3.0"], "Screen readers retain the final values while decorative counts wait");
  columns.forEach(({ scene }) => harness.intersect(scene));
  assert.equal(harness.timelines.length, 3);
  assert.ok(columns.every(column => column.scene.dataset.storyEntryState === "running"));

  const counters = harness.timelines.map(timeline => timeline.calls.find(call => call.kind === "to"));
  assert.deepEqual(counters.map(call => call.at), [0, .12, .24]);
  const localFillStarts = [.1, .08, .06];
  harness.timelines.forEach((timeline, index) => {
    const fill = timeline.calls.find(call => call.target[0] === columns[index].fills[0]);
    assert.equal(fill.at, counters[index].at + localFillStarts[index], "Each graphic shares its own counter's column offset");
    const finish = Math.max(...timeline.calls.map(call => call.at + call.vars.duration + (call.vars.stagger ?? 0) * ((call.target.length ?? 1) - 1)));
    assert.ok(finish <= 1.7, "All three columns finish within 1.7 seconds of entry");
  });

  // A running first column cannot advance the other columns' count state.
  counters[0].target.progress = .5;
  counters[0].vars.onUpdate();
  assert.deepEqual(columns.map(column => column.count.textContent), ["02", "0", "0.0"]);
  counters[1].target.progress = .4;
  counters[1].vars.onUpdate();
  assert.deepEqual(columns.map(column => column.count.textContent), ["02", "4", "0.0"]);
  assert.deepEqual(columns.map(column => column.accessibleCount.textContent), ["03", "10", "3.0"]);
  harness.timelines.forEach(timeline => timeline.options.onComplete());
  assert.deepEqual(columns.map(column => column.count.textContent), ["03", "10", "3.0"]);
  columns.forEach(({ scene }) => harness.intersect(scene));
  assert.equal(harness.timelines.length, 3, "Completed evidence does not replay");
  harness.cleanup();
});

test("interrupting an evidence entry restores all final counts and fills, including delayed columns", () => {
  for (const interrupt of [
    (harness, columns) => columns.forEach(({ scene }) => harness.intersect(scene, 0)),
    harness => harness.pause(true),
    harness => harness.hide(true),
    harness => harness.reduce(true),
    harness => harness.cleanup(),
  ]) {
    const columns = evidenceColumns();
    const harness = mount(columns.map(column => column.scene));
    columns.forEach(({ scene }) => harness.intersect(scene));
    const firstCount = harness.timelines[0].calls.find(call => call.kind === "to");
    firstCount.target.progress = .2;
    firstCount.vars.onUpdate();
    assert.deepEqual(columns.map(column => column.count.textContent), ["01", "0", "0.0"]);
    interrupt(harness, columns);
    assert.deepEqual(columns.map(column => column.count.textContent), ["03", "10", "3.0"]);
    assert.ok(harness.timelines.every(timeline => timeline.killed));
    for (const { scene, fills } of columns) {
      assert.equal(scene.dataset.storyEntryState, "complete");
      for (const fill of fills) {
        for (const property of ["transform", "transform-origin", "opacity"]) assert.equal(fill.style.getPropertyValue(property), "");
      }
    }
    harness.pause(false);
    harness.hide(false);
    harness.reduce(false);
    columns.forEach(({ scene }) => harness.intersect(scene));
    assert.equal(harness.timelines.length, 3, "An interrupted delayed entry remains one-shot");
    harness.cleanup();
  }
});

test("scope revision during an evidence stagger restores the newly rendered values in every column", () => {
  const columns = evidenceColumns();
  const harness = mount(columns.map(column => column.scene));
  columns.forEach(({ scene }) => harness.intersect(scene));
  ["4", "13", "3.9"].forEach((value, index) => { columns[index].count.dataset.storyCount = value; });
  harness.render("4:13:3900000");
  assert.deepEqual(columns.map(column => column.count.textContent), ["04", "13", "3.9"]);
  assert.ok(harness.timelines.every(timeline => timeline.killed));
  columns.forEach(({ scene, fills }) => {
    harness.intersect(scene);
    assert.equal(scene.dataset.storyEntryState, "complete");
    assert.ok(fills.every(fill => fill.style.getPropertyValue("transform") === ""));
  });
  assert.equal(harness.timelines.length, 3);
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
  assert.equal(later.count.textContent, "0", "Resume prepares unvisited counts before they enter view");
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
  assert.equal(current.count.textContent, "0");
  assert.equal(later.count.textContent, "0");
  harness.ready(true, false);
  assert.equal(harness.timelines.length, 1, "An already visible graph enters as soon as preferences are ready");
  assert.equal(current.scene.dataset.storyEntryState, "running");
  assert.equal(later.scene.dataset.storyEntryState, "waiting");
  assert.equal(later.count.textContent, "0", "Readiness keeps offscreen counters at their entry start");
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
  assert.equal(count.textContent, "0");
  harness.cleanup();
});

test("initial paused evidence resumes through waiting zero while initial reduced motion remains final", () => {
  for (const option of [{ paused: true }, { reduced: true }]) {
    const columns = evidenceColumns();
    const harness = mount(columns.map(column => column.scene), option);
    assert.deepEqual(columns.map(column => column.count.textContent), ["03", "10", "3.0"]);
    assert.ok(columns.every(column => column.scene.dataset.storyEntryState === "complete"));
    assert.equal(harness.timelines.length, 0);
    harness.pause(false);
    harness.reduce(false);
    if (option.paused) {
      assert.deepEqual(columns.map(column => column.count.textContent), ["00", "0", "0.0"]);
      assert.ok(columns.every(column => column.scene.dataset.storyEntryState === "waiting"));
      assert.equal(harness.timelines.length, 0, "Resume only prepares columns that are still offscreen");
      columns.forEach(({ scene }) => harness.intersect(scene));
      assert.equal(harness.timelines.length, 3);
    } else {
      columns.forEach(({ scene }) => harness.intersect(scene));
      assert.deepEqual(columns.map(column => column.count.textContent), ["03", "10", "3.0"]);
      assert.equal(harness.timelines.length, 0, "A scene completed under reduced motion never replays");
    }
    assert.deepEqual(columns.map(column => column.accessibleCount.textContent), ["03", "10", "3.0"]);
    harness.cleanup();
  }
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
