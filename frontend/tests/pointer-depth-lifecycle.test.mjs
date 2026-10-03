import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import gsapPackage from "gsap/dist/gsap.js";
import { pointerDepth } from "../features/home/pointer-depth.mjs";

const source = await readFile(new URL("../features/home/use-pointer-depth.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS } }).outputText;

function events() {
  const listeners = new Map();
  return {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name),
    dispatch: (name, event = {}) => listeners.get(name)?.(event),
    listeners,
  };
}

function mount({ realTween = false } = {}) {
  const frames = new Map();
  const observers = { intersection: [], mutation: [], resize: [] };
  const channels = [];
  const values = new Map();
  let nextFrame = 0;
  let cleanup;
  let measurements = 0;
  const host = {
    ...events(), dataset: {}, focused: false,
    rect: { left: 100, top: 200, width: 400, height: 200 },
    matches() { return this.focused; },
    closest() { return anchor; },
    getBoundingClientRect() { throw new Error("Rotating surface must never feed its own pointer coordinates"); },
    style: { setProperty: (key, value) => {
      assert.ok(Number.isFinite(Number.parseFloat(value)), `Finite serialized ${key}`);
      values.set(key, Number.parseFloat(value));
    }, removeProperty: key => values.delete(key) },
  };
  const anchor = { ...events(), getBoundingClientRect() { measurements++; return { ...host.rect }; } };
  const motion = { dataset: { motionPaused: "false" } };
  const root = { querySelectorAll: () => [host], querySelector: () => motion };
  const media = { ...events(), matches: true };
  const document = { ...events(), hidden: false };
  const window = { ...events(), matchMedia: () => media };
  const makeObserver = kind => class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers[kind].push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  const exports = {};
  runInNewContext(compiled, {
    exports, document, window,
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    IntersectionObserver: makeObserver("intersection"),
    MutationObserver: makeObserver("mutation"),
    ResizeObserver: makeObserver("resize"),
    require(name) {
      if (name === "react") return { useEffect: effect => { cleanup = effect(); } };
      if (name === "./pointer-depth.mjs") return { pointerDepth };
      if (name === "gsap") return { default: {
        quickTo(target, property, options) {
          if (realTween) {
            const channel = gsapPackage.gsap.quickTo(target, property, options);
            channels.push(channel);
            return channel;
          }
          assert.equal(typeof target[property], "number", "Tween state must never be a CSS unit string");
          const channel = value => { channel.calls++; target[property] = value; options.onUpdate?.(); };
          channel.calls = 0;
          channel.target = target;
          channel.options = options;
          channel.tween = {
            killed: false, paused: false,
            duration(value) { this.seconds = value; return this; },
            progress(value) { this.position = value; return this; },
            pause() { this.paused = true; return this; },
            kill() { this.killed = true; },
          };
          channels.push(channel);
          return channel;
        },
      } };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  exports.usePointerDepth({ current: root });
  const show = (isIntersecting = true) => observers.intersection[0].callback([{ target: host, isIntersecting }]);
  return {
    host, anchor, media, motion, document, window, values, channels, observers, frames, show,
    get measurements() { return measurements; },
    move(x = 300, y = 300) { anchor.dispatch("pointermove", { pointerType: "mouse", clientX: x, clientY: y }); },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    unmount() { cleanup(); },
  };
}

test("pointer bursts reuse tweens and one cached box; scroll and resize invalidate lazily", () => {
  const scene = mount();
  scene.show();
  assert.equal(scene.channels.length, 0, "Unvisited hosts have no tweens");
  scene.anchor.dispatch("pointerenter");
  scene.move(100, 200); scene.move(500, 400); scene.move(300, 300);
  assert.equal(scene.frames.size, 1, "A burst has a single pending frame");
  scene.flush();
  assert.equal(scene.measurements, 1);
  assert.equal(scene.channels.length, 5);
  assert.equal(scene.values.get("--pointer-x"), 50, "The newest event wins");
  for (let index = 0; index < 50; index++) { scene.move(500, 400); scene.flush(); }
  assert.equal(scene.measurements, 1, "No per-frame layout reads");
  assert.equal(scene.channels.length, 5, "No per-frame tween allocation");
  assert.equal(scene.values.get("--pointer-rx"), -1.8);
  assert.equal(scene.values.get("--pointer-ry"), 2.2);
  scene.host.rect.top = 100;
  scene.window.dispatch("scroll");
  assert.equal(scene.measurements, 1, "Scroll itself does not force layout");
  assert.equal(scene.host.dataset.pointerActive, "false", "Scroll clears a stale hover pose");
  assert.equal(scene.values.get("--pointer-rx"), 0);
  scene.move(300, 200); scene.flush();
  assert.equal(scene.measurements, 2);
  assert.equal(Math.abs(scene.values.get("--pointer-rx")), 0, "Scrolled geometry is current");
  scene.observers.resize[0].callback();
  scene.move(); scene.flush();
  assert.equal(scene.measurements, 3);
  scene.unmount();
});

test("queued motion cannot survive focus, pause, backgrounding or leaving the viewport", () => {
  const scene = mount();
  scene.show();
  scene.move(500, 400);
  scene.host.focused = true;
  scene.flush();
  assert.equal(scene.channels.length, 0, "Frame rechecks focus before creating any tween");
  scene.host.focused = false;
  scene.move(500, 400); scene.flush();
  assert.equal(scene.values.get("--pointer-strength"), 1);
  scene.move();
  scene.motion.dataset.motionPaused = "true";
  scene.observers.mutation[0].callback();
  assert.equal(scene.frames.size, 0);
  assert.equal(scene.values.get("--pointer-strength"), 0);
  assert.ok(scene.channels.every(channel => channel.tween.paused));
  scene.motion.dataset.motionPaused = "false";
  scene.move(500, 400); scene.flush();
  scene.document.hidden = true;
  scene.document.dispatch("visibilitychange");
  assert.equal(scene.values.get("--pointer-strength"), 0);
  scene.document.hidden = false;
  scene.move(500, 400); scene.flush();
  scene.show(false);
  assert.equal(scene.host.dataset.pointerActive, "false");
  assert.equal(scene.values.get("--pointer-ry"), 0);
  scene.move();
  assert.equal(scene.frames.size, 0);
  scene.unmount();
  assert.ok(scene.channels.every(channel => channel.tween.killed));
  assert.ok(Object.values(scene.observers).flat().every(observer => observer.disconnected));
  assert.equal(scene.host.listeners.size, 0);
  assert.equal(scene.anchor.listeners.size, 0);
  assert.equal(scene.window.listeners.size, 0);
  assert.equal(scene.document.listeners.size, 0);
  assert.equal(scene.media.listeners.size, 0);
  assert.equal(scene.values.size, 0);
});


test("real GSAP numeric channels stay finite through rapid reversals and interrupted resets", () => {
  const scene = mount({ realTween: true });
  try {
    scene.show();
    for (let index = 0; index < 40; index++) {
      scene.move(index % 2 ? 100 : 500, index % 2 ? 200 : 400); scene.flush();
      scene.channels.forEach(channel => channel.tween.progress(.27).pause());
      scene.anchor.dispatch("pointerleave");
      scene.channels.forEach(channel => channel.tween.progress(.13).pause());
      if (index % 3 === 0) {
        scene.motion.dataset.motionPaused = "true"; scene.observers.mutation[0].callback();
        scene.motion.dataset.motionPaused = "false";
      }
      scene.anchor.dispatch("pointerenter");
      assert.ok([...scene.values.values()].every(Number.isFinite));
      assert.ok(Math.abs(scene.values.get("--pointer-rx")) <= 1.8);
      assert.ok(Math.abs(scene.values.get("--pointer-ry")) <= 2.2);
    }
    assert.equal(scene.channels.length, 5, "Reversals keep the same numeric tween channels");
    scene.document.hidden = true; scene.document.dispatch("visibilitychange");
    assert.equal(scene.values.get("--pointer-rx"), 0);
    assert.equal(scene.values.get("--pointer-strength"), 0);
  } finally {
    scene.unmount();
    gsapPackage.gsap.ticker.sleep();
  }
});
