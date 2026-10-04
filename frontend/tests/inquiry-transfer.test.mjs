import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../features/home/use-inquiry-transfer.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } }).outputText;

function element(children = {}) {
  const properties = new Map();
  return {
    dataset: {}, offsetWidth: 240, offsetHeight: 300, offsetLeft: 0, clientWidth: 600,
    values: {},
    style: {
      setProperty: (key, value) => properties.set(key, String(value)),
      removeProperty: key => properties.delete(key),
      getPropertyValue: key => properties.get(key) ?? "",
    },
    querySelector: selector => children[selector]?.[0] ?? null,
    querySelectorAll: selector => children[selector] ?? [],
  };
}

function scene() {
  const shell = element();
  const content = element();
  const card = element({ ".inquiry-liquid-shell": [shell], ".inquiry-card-content": [content] });
  const lanes = [element(), element()];
  lanes[1].offsetLeft = 308;
  const board = element({ ".spatial-lane": lanes });
  return { shell, content, card, board, lanes, root: element({ ".spatial-project-card": [card], ".spatial-board": [board] }) };
}

function mount() {
  const graph = scene();
  const refs = [];
  const timelines = [];
  const observers = [];
  let cursor = 0;
  let previousDependencies;
  let nextEffect;
  let cleanup;
  const media = { matches: false };
  function set(target, vars) {
    for (const [key, value] of Object.entries(vars)) {
      if (key === "clearProps") {
        for (const property of value.split(",")) {
          target.style.removeProperty(property);
          if (property === "transform") {
            delete target.values.scaleX; delete target.values.scaleY;
          } else delete target.values[property];
        }
      } else if (key === "attr") {
        for (const [attribute, entry] of Object.entries(value)) {
          const property = attribute.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          target.dataset[property] = entry;
        }
      } else if (!["duration", "ease"].includes(key)) {
        target.values[key] = value;
        target.style.setProperty(["x", "scaleX", "scaleY"].includes(key) ? "transform" : key, value);
      }
    }
  }
  const gsap = {
    set,
    getProperty: (target, key) => target.values[key] ?? 0,
    timeline(options) {
      const timeline = {
        options, calls: [], killed: false,
        to(target, vars, at) { this.calls.push({ kind: "to", target, vars, at }); return this; },
        set(target, vars, at) { this.calls.push({ kind: "set", target, vars, at }); return this; },
        kill() { this.killed = true; },
        // Apply completed milestones, retaining chronological order even when
        // the hook creates overlapping tweens. Intermediate travel is supplied
        // explicitly below so interruption tests control the observed position.
        finishThrough(time) {
          if (this.killed) return;
          this.calls.map(call => ({ ...call, end: call.at + (call.vars.duration ?? 0) }))
            .filter(call => call.end <= time + 1e-9).sort((a, b) => a.end - b.end)
            .forEach(call => set(call.target, call.vars));
          options.onUpdate();
        },
        updatePosition(x) { if (!this.killed) { set(graph.card, { x }); options.onUpdate(); } },
        complete() { if (!this.killed) { this.finishThrough(Infinity); options.onComplete(); } },
      };
      timelines.push(timeline);
      return timeline;
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return {
        useRef(value) { const index = cursor++; return refs[index] ??= { current: value }; },
        useLayoutEffect(effect, dependencies) {
          if (!previousDependencies || dependencies.some((value, index) => value !== previousDependencies[index])) {
            nextEffect = effect; previousDependencies = dependencies;
          }
        },
      };
      if (name === "gsap") return { default: gsap };
      throw new Error(`Unexpected module: ${name}`);
    },
    window: { matchMedia: () => media },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; this.targets = []; observers.push(this); }
      observe(target) { this.targets.push(target); }
      disconnect() { this.disconnected = true; }
    },
  });
  const ref = { current: graph.root };
  return {
    ...graph, ref, media, timelines, observers, set,
    render(column, enabled = true, ready = true) {
      cursor = 0; nextEffect = undefined;
      exports.useInquiryTransfer(ref, column, enabled, ready);
      if (nextEffect) { cleanup?.(); cleanup = nextEffect(); }
    },
    unmount() { cleanup?.(); },
  };
}

function assertSettled(graph) {
  assert.equal(graph.card.dataset.transferState, "settled");
  assert.equal(graph.card.style.getPropertyValue("transform"), "");
  assert.equal(graph.shell.style.getPropertyValue("transform"), "");
  assert.equal(graph.shell.style.getPropertyValue("borderRadius"), "");
  assert.equal(graph.content.style.getPropertyValue("opacity"), "");
}

test("hydration settles the accessible preview before enabling real transfers", () => {
  const graph = mount();
  graph.render(1, false, false);
  graph.render(0, true, true);
  assert.equal(graph.timelines.length, 0);
  assertSettled(graph);
  graph.render(1);
  assert.equal(graph.timelines.length, 1);
  assert.equal(graph.card.values.x, 0);
});

test("transfer reaches a round droplet before lateral stretch and unfolds with undistorted text", () => {
  const graph = mount();
  graph.render(0); graph.render(1);
  const timeline = graph.timelines[0];
  timeline.finishThrough(.24);
  assert.equal(graph.card.dataset.transferState, "droplet");
  assert.equal(graph.card.values.x, 0);
  assert.equal(graph.shell.values.scaleX * graph.card.offsetWidth, graph.shell.values.scaleY * graph.card.offsetHeight);
  assert.equal(graph.content.values.opacity, 0);
  timeline.finishThrough(.43);
  assert.equal(graph.card.dataset.transferState, "travelling");
  assert.ok(graph.shell.values.scaleX * graph.card.offsetWidth > 3 * graph.shell.values.scaleY * graph.card.offsetHeight);
  timeline.finishThrough(.7);
  assert.equal(graph.card.dataset.transferState, "unfolding");
  assert.equal(graph.card.values.x, 308);
  for (const call of timeline.calls.filter(call => call.target !== graph.shell)) {
    assert.equal("scaleX" in call.vars || "scaleY" in call.vars || "borderRadius" in call.vars, false);
  }
  timeline.complete();
  assertSettled(graph);
});

test("rapid reverse starts at the live position and cancels the previous owner", () => {
  const graph = mount();
  graph.render(0); graph.render(1);
  const forward = graph.timelines[0];
  forward.updatePosition(151);
  graph.render(0);
  const reverse = graph.timelines[1];
  assert.equal(forward.killed, true);
  assert.equal(graph.observers[1].disconnected, true);
  assert.equal(graph.card.values.x, 151);
  assert.equal(reverse.calls.find(call => call.target === graph.card && call.kind === "to").vars.x, 0);
  forward.complete();
  assert.equal(graph.card.dataset.transferState, "condensing");
  reverse.complete();
  assertSettled(graph);
});

test("pause or reduced motion settles immediately and resuming does not replay; manual selection still transfers", () => {
  const graph = mount();
  graph.render(0); graph.render(1);
  const forward = graph.timelines[0];
  forward.finishThrough(.24); forward.updatePosition(120);
  graph.render(1, false);
  assert.equal(forward.killed, true);
  assertSettled(graph);
  graph.render(1, true);
  assert.equal(graph.timelines.length, 1);
  graph.render(1, false);
  graph.render(0, true);
  assert.equal(graph.timelines.length, 2);
  assert.equal(graph.card.values.x, 308);
});

test("resize ignores the initial observation and settles at the new responsive destination", () => {
  const graph = mount();
  graph.render(0); graph.render(1);
  const forward = graph.timelines[0];
  const observer = graph.observers.at(-1);
  observer.callback();
  assert.equal(forward.killed, false);
  graph.media.matches = true;
  graph.board.clientWidth = 360;
  graph.card.offsetWidth = 314;
  observer.callback();
  assert.equal(forward.killed, true);
  assertSettled(graph);
  graph.render(0);
  assert.equal(graph.card.values.x, 30);
  graph.unmount();
  assert.equal(graph.timelines.at(-1).killed, true);
  assert.ok(graph.observers.every(observer => observer.disconnected));
});

test("scope-only renders do not restart transfer and hidden zero-size cards cannot create invalid scales", () => {
  const graph = mount();
  graph.render(0); graph.render(1);
  const forward = graph.timelines[0];
  graph.render(1);
  assert.equal(forward.killed, false);
  assert.equal(graph.timelines.length, 1);
  graph.card.offsetWidth = 0;
  graph.card.offsetHeight = 0;
  graph.render(0);
  assert.equal(graph.timelines.length, 1);
  assertSettled(graph);
});

test("a replacement scene and incomplete markup cannot inherit an old card's transfer", () => {
  const graph = mount();
  graph.render(0); graph.render(1);
  const replacement = scene();
  graph.ref.current = replacement.root;
  graph.render(0);
  assert.equal(graph.timelines[0].killed, true);
  assert.equal(graph.timelines.length, 1);
  assertSettled(replacement);
  const incomplete = scene();
  incomplete.lanes.length = 0;
  graph.ref.current = incomplete.root;
  assert.doesNotThrow(() => graph.render(1));
  assert.equal(graph.timelines.length, 1);
});
