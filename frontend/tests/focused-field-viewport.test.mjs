import test from "node:test";
import assert from "node:assert/strict";
import { bindFocusedFieldViewport } from "../app/lib/focused-field-viewport.mjs";

function fixture() {
  const listeners = new Map();
  const visualListeners = new Map();
  const frames = new Map();
  const scrolls = [];
  let nextFrame = 0;
  const field = { isConnected: true, scrollIntoView: options => scrolls.push(options) };
  const viewport = {
    document: { activeElement: field },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
    visualViewport: {
      addEventListener: (name, listener) => visualListeners.set(name, listener),
      removeEventListener: name => visualListeners.delete(name),
    },
    requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const flush = () => { for (const [id, callback] of frames) { frames.delete(id); callback(); } };
  return { field, viewport, listeners, visualListeners, frames, scrolls, flush };
}

test("window and visual viewport resize keep only the focused field reachable, once per frame", () => {
  const state = fixture();
  const release = bindFocusedFieldViewport(state.field, state.viewport);
  state.listeners.get("resize")();
  state.visualListeners.get("resize")();
  assert.equal(state.frames.size, 1);
  state.flush();
  assert.deepEqual(state.scrolls, [{ block: "nearest", inline: "nearest", behavior: "instant" }]);

  state.viewport.document.activeElement = {};
  state.listeners.get("resize")();
  state.flush();
  assert.equal(state.scrolls.length, 1);
  state.viewport.document.activeElement = state.field;
  state.field.isConnected = false;
  state.listeners.get("resize")();
  state.flush();
  assert.equal(state.scrolls.length, 1);
  release();
});

test("unmount removes both resize subscriptions and cancels a pending visibility check", () => {
  const state = fixture();
  const release = bindFocusedFieldViewport(state.field, state.viewport);
  state.listeners.get("resize")();
  release();
  assert.equal(state.listeners.size, 0);
  assert.equal(state.visualListeners.size, 0);
  assert.equal(state.frames.size, 0);
  state.flush();
  assert.equal(state.scrolls.length, 0);
});

test("the focused field can keep its composer and Send controls together in view", () => {
  const state = fixture();
  const composerScrolls = [];
  const composer = { scrollIntoView: options => composerScrolls.push(options) };
  const release = bindFocusedFieldViewport(state.field, state.viewport, composer);
  state.listeners.get("resize")();
  state.flush();
  assert.equal(state.scrolls.length, 0);
  assert.deepEqual(composerScrolls, [{ block: "nearest", inline: "nearest", behavior: "instant" }]);
  release();
});
