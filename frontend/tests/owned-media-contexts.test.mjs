import test from "node:test";
import assert from "node:assert/strict";
import gsapPackage from "gsap/dist/gsap.js";
import { createOwnedMediaContexts } from "../features/home/owned-media-contexts.mjs";

const { gsap } = gsapPackage;

function mediaOwner(initial = {}) {
  const lists = [];
  return {
    lists,
    matchMedia(query) {
      const listeners = new Set();
      const media = {
        matches: Boolean(initial[query]), listeners,
        addEventListener(name, listener) { assert.equal(name, "change"); listeners.add(listener); },
        removeEventListener(name, listener) { assert.equal(name, "change"); listeners.delete(listener); },
        change(matches) {
          this.matches = matches;
          for (const listener of [...listeners]) listener({ matches });
        },
      };
      lists.push(media);
      return media;
    },
  };
}

test("only matching contexts run, inherit the supplied scope, and restore the original pose", () => {
  const native = mediaOwner({ desktop: true });
  const desktop = { x: 7, scale: 1 };
  const reduced = { x: 11 };
  const scope = { current: { querySelectorAll: selector => selector === ".desktop" ? [desktop] : [reduced] } };
  const active = new Set();
  const setups = { desktop: 0, reduced: 0 };
  const cleanups = { desktop: 0, reduced: 0 };
  const owner = createOwnedMediaContexts(gsap, native, scope);
  try {
    for (const query of ["desktop", "reduced"]) {
      owner.add(query, () => {
        setups[query]++;
        active.add(query);
        gsap.set(`.${query}`, query === "desktop" ? { x: 90, scale: .5 } : { x: 30 });
        return () => { cleanups[query]++; active.delete(query); };
      });
    }
    assert.deepEqual([...active], ["desktop"]);
    assert.equal(desktop.x, 90);
    assert.equal(desktop.scale, .5);
    assert.equal(reduced.x, 11);
    native.lists[0].change(true);
    assert.equal(setups.desktop, 1, "An unchanged match does not create another context");
    native.lists[0].change(false);
    assert.equal(desktop.x, 7);
    assert.equal(desktop.scale, 1);
    assert.equal(cleanups.desktop, 1);
    assert.equal(active.size, 0);
    native.lists[1].change(true);
    assert.deepEqual([...active], ["reduced"]);
    assert.equal(reduced.x, 30);
    native.lists[0].change(true);
    assert.deepEqual([...active].sort(), ["desktop", "reduced"]);
    assert.equal(setups.desktop, 2);
    owner.revert();
    owner.revert();
    assert.equal(active.size, 0);
    assert.deepEqual(cleanups, { desktop: 2, reduced: 1 });
    assert.equal(desktop.x, 7);
    assert.equal(desktop.scale, 1);
    assert.equal(reduced.x, 11);
    assert.ok(native.lists.every(media => media.listeners.size === 0));
  } finally {
    owner.revert();
    gsap.ticker.sleep();
  }
});

test("ten mount and revert cycles leave zero native listeners and zero active animation contexts", () => {
  const native = mediaOwner({ motion: true, desktop: true });
  const active = new Set();
  let cleanupCount = 0;
  let setupCount = 0;
  try {
    for (let cycle = 0; cycle < 10; cycle++) {
      const targets = [{ x: 7 }, { x: 11 }];
      let owner;
      const parent = gsap.context(() => {
        owner = createOwnedMediaContexts(gsap, native);
        ["motion", "desktop"].forEach((query, index) => owner.add(query, () => {
          const marker = {};
          setupCount++;
          active.add(marker);
          gsap.set(targets[index], { x: 100 + index });
          return () => { cleanupCount++; active.delete(marker); };
        }));
        return () => owner.revert();
      });
      const [motion, desktop] = native.lists.slice(-2);
      const staleListeners = [...motion.listeners, ...desktop.listeners];
      assert.equal(active.size, 2);
      desktop.change(false);
      assert.equal(active.size, 1);
      assert.equal(targets[1].x, 11);
      desktop.change(true);
      motion.change(false);
      assert.equal(active.size, 1);
      assert.equal(targets[0].x, 7);
      motion.change(true);
      assert.equal(active.size, 2);
      parent.revert();
      owner.revert();
      parent.revert();
      staleListeners.forEach(listener => listener({ matches: true }));
      motion.change(true);
      desktop.change(false);
      assert.equal(active.size, 0);
      assert.equal(targets[0].x, 7);
      assert.equal(targets[1].x, 11);
      assert.ok(native.lists.every(media => media.listeners.size === 0));
      assert.equal(parent.data.length, 0);
    }
    assert.equal(native.lists.length, 20);
    assert.equal(setupCount, 40);
    assert.equal(cleanupCount, setupCount, "Every activated setup receives its returned cleanup exactly once");
  } finally {
    gsap.ticker.sleep();
  }
});
