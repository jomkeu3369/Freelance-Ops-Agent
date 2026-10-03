import test from "node:test";
import assert from "node:assert/strict";
import gsapPackage from "gsap/dist/gsap.js";
import { createBrandFlight } from "../features/home/brand-flight.mjs";
import { createBrandFlightRenderer } from "../features/home/brand-flight-renderer.mjs";

const { gsap } = gsapPackage;

test("repeated flight scrubbing retains a bounded GSAP context and reverts its original pose", () => {
  const original = { x: 17, y: -9, scale: .9 };
  const target = { ...original };
  const driver = { progress: 0 };
  let path = createBrandFlight({
    start: { x: 0, y: 91, scale: 1 }, corridorX: 0, clearY: 600,
    destination: { x: -264, y: 740, scale: .88 }, compactScale: .587,
  });
  let tween;
  const context = gsap.context(() => {
    // Mirrors the initial pose captured by the home animation's context.
    gsap.set(target, { x: 0, y: 0, scale: 1 });
    const render = createBrandFlightRenderer(gsap, target);
    tween = gsap.fromTo(driver, { progress: 0 }, {
      progress: 1, duration: 1, ease: "none", paused: true, immediateRender: false,
      onUpdate: () => render(path.sample(driver.progress)),
    });
  });
  try {
    tween.progress(.5); // Include GSAP's one-time fromTo startAt setup.
    const retained = context.data.length;
    const tracked = context.getTweens().length;
    for (let cycle = 0; cycle < 2000; cycle++) {
      const progress = cycle % 2 ? .25 : .75;
      tween.progress(progress);
      const expected = path.sample(progress);
      for (const key of ["x", "y", "scale"]) {
        assert.ok(Math.abs(Number.parseFloat(target[key]) - expected[key]) < .0001, `${key} follows the same pose in both directions`);
      }
    }
    assert.equal(context.data.length, retained, "Scroll frames must not retain new set tweens");
    assert.equal(context.getTweens().length, tracked);
    // Layout refresh replaces geometry, not setter channels or the driver.
    path = createBrandFlight({ destination: { x: -320, y: 860, scale: .76 }, clearY: 700 });
    tween.progress(1);
    for (const key of ["x", "y", "scale"]) assert.equal(Number.parseFloat(target[key]), path.sample(1)[key]);
    assert.equal(context.data.length, retained);
  } finally {
    context.revert();
    gsap.ticker.sleep();
  }
  for (const key of ["x", "y", "scale"]) assert.equal(target[key], original[key], `Unmount restores ${key}`);
  assert.equal(context.data.length, 0);
});
