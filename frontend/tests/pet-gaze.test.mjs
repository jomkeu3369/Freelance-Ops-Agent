import test from "node:test";
import assert from "node:assert/strict";
import { createPetGazeTracker, petGazeOffset } from "../features/workspace/pets/pet-gaze.mjs";

const bounds = { left: 100, top: 200, width: 140, height: 128 };

test("gaze follows all directions in viewport space within the SVG eye bounds", () => {
  assert.deepEqual(petGazeOffset({ x: 170, y: 253 }, bounds), { x: 0, y: 0 });
  for (const [pointer, sx, sy] of [[{ x: 1000, y: 253 }, 1, 0], [{ x: -1000, y: 253 }, -1, 0], [{ x: 170, y: 1000 }, 0, 1], [{ x: 170, y: -1000 }, 0, -1], [{ x: 1000, y: 1000 }, 1, 1]]) {
    const gaze = petGazeOffset(pointer, bounds);
    assert.equal(Math.sign(gaze.x), sx); assert.equal(Math.sign(gaze.y), sy);
    assert.ok(Math.abs(gaze.x) <= 4); assert.ok(Math.abs(gaze.y) <= 2.5);
  }
  assert.deepEqual(petGazeOffset({ x: 170, y: 253 }, bounds), petGazeOffset({ x: 270, y: 353 }, { ...bounds, left: 200, top: 300 }));
});

test("invalid and zero-sized artwork stays neutral", () => {
  for (const invalid of [{ ...bounds, width: 0 }, { ...bounds, height: -1 }, { ...bounds, left: NaN }]) {
    assert.deepEqual(petGazeOffset({ x: 300, y: 500 }, invalid), { x: 0, y: 0 });
  }
  assert.deepEqual(petGazeOffset({ x: Infinity, y: 500 }, bounds), { x: 0, y: 0 });
});

function harness() {
  const listeners = new Map(); const frames = new Map(); let nextFrame = 0;
  function events(target) {
    return {
      addEventListener(name, handler) { const key = `${target}:${name}`; if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(handler); },
      removeEventListener(name, handler) { listeners.get(`${target}:${name}`)?.delete(handler); },
      dispatch(name, event = {}) { for (const handler of listeners.get(`${target}:${name}`) ?? []) handler(event); }
    };
  }
  const motion = { matches: false, ...events("motion") }, hover = { matches: true, ...events("hover") };
  const browser = { ...events("window"), document: { visibilityState: "visible", ...events("document") },
    matchMedia(query) { return query.includes("reduced-motion") ? motion : hover; },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); }
  };
  const pet = () => {
    const eyes = { transform: null, setAttribute(name, value) { assert.equal(name, "transform"); this.transform = value; } };
    return { isConnected: true, eyes, querySelector(selector) { assert.equal(selector, ".pet-eyes"); return eyes; }, getBoundingClientRect: () => bounds };
  };
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
  return { browser, motion, hover, pet, flush, frames, listeners, tracker: createPetGazeTracker(browser) };
}

test("multiple pets share listeners and coalesce pointer movement into one frame", () => {
  const h = harness(), first = h.pet(), second = h.pet();
  const removeFirst = h.tracker.subscribe(first), removeSecond = h.tracker.subscribe(second);
  assert.equal(h.listeners.get("window:pointermove").size, 1); assert.equal(first.eyes.transform, "translate(0 0)");
  h.browser.dispatch("pointermove", { pointerType: "mouse", clientX: 10, clientY: 10, buttons: 0 });
  h.browser.dispatch("pointermove", { pointerType: "mouse", clientX: 1000, clientY: 253, buttons: 0 });
  assert.equal(h.frames.size, 1); h.flush();
  assert.equal(first.eyes.transform, "translate(4 0)"); assert.equal(second.eyes.transform, "translate(4 0)");
  removeFirst(); assert.equal(first.eyes.transform, "translate(0 0)"); assert.equal(h.listeners.get("window:pointermove").size, 1);
  removeSecond(); assert.equal(h.frames.size, 0); for (const listener of h.listeners.values()) assert.equal(listener.size, 0);
});

test("reduced motion, touch, pointer exit and lifecycle changes always reset eyes", () => {
  const h = harness(), pet = h.pet(); h.tracker.subscribe(pet);
  const move = () => { h.browser.dispatch("pointermove", { pointerType: "mouse", clientX: 1000, clientY: 253, buttons: 0 }); h.flush(); };
  move(); h.motion.matches = true; h.motion.dispatch("change"); assert.equal(pet.eyes.transform, "translate(0 0)");
  move(); assert.equal(pet.eyes.transform, "translate(0 0)"); h.motion.matches = false; h.motion.dispatch("change"); move();
  h.browser.dispatch("pointermove", { pointerType: "touch", clientX: 1000, clientY: 253, buttons: 0 }); assert.equal(pet.eyes.transform, "translate(0 0)");
  move(); h.hover.matches = false; h.hover.dispatch("change"); move(); assert.equal(pet.eyes.transform, "translate(0 0)");
  h.hover.matches = true; h.hover.dispatch("change");
  for (const name of ["blur", "pagehide", "pointerout"]) { move(); h.browser.dispatch(name); assert.equal(pet.eyes.transform, "translate(0 0)"); }
  move(); h.browser.document.visibilityState = "hidden"; h.browser.document.dispatch("visibilitychange");
  assert.equal(pet.eyes.transform, "translate(0 0)"); move(); assert.equal(pet.eyes.transform, "translate(0 0)");
});

test("scroll and resize recompute the last pointer; cleanup cancels unfinished work", () => {
  const h = harness(), pet = h.pet(), remove = h.tracker.subscribe(pet);
  h.browser.dispatch("pointermove", { pointerType: "mouse", clientX: 1000, clientY: 253, buttons: 0 }); h.flush();
  pet.getBoundingClientRect = () => ({ ...bounds, left: 930 });
  h.browser.dispatch("scroll"); h.browser.dispatch("resize"); assert.equal(h.frames.size, 1); h.flush(); assert.equal(pet.eyes.transform, "translate(0 0)");
  h.browser.dispatch("pointermove", { pointerType: "mouse", clientX: 1000, clientY: 1000, buttons: 0 });
  assert.equal(h.frames.size, 1); remove(); assert.equal(h.frames.size, 0);
  const replacement = h.pet(), removeReplacement = h.tracker.subscribe(replacement);
  assert.equal(replacement.eyes.transform, "translate(0 0)"); assert.equal(h.frames.size, 0); removeReplacement();
});
