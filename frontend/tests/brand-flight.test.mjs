import test from "node:test";
import assert from "node:assert/strict";
import { createBrandFlight } from "../features/home/brand-flight.mjs";

const geometry = { start: { x: 0, y: 0, scale: 1 }, destination: { x: -264, y: 700, scale: .78 } };
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test("the flight meets exact measured endpoints and clamps overscroll", () => {
  const flight = createBrandFlight(geometry);
  assert.deepEqual(flight.sample(0), geometry.start);
  assert.deepEqual(flight.sample(1), geometry.destination);
  for (const progress of [-4, -Infinity, NaN, undefined]) assert.deepEqual(flight.sample(progress), geometry.start);
  for (const progress of [4, Infinity]) assert.deepEqual(flight.sample(progress), geometry.destination);
});

test("every position lies on the source-to-destination segment, with no preliminary descent", () => {
  for (const layout of [geometry, { start: { x: 15, y: 70 }, destination: { x: -310, y: 520 } }, { destination: { x: 0, y: -200 } }]) {
    const flight = createBrandFlight(layout);
    const start = flight.sample(0), end = flight.sample(1);
    const dx = end.x - start.x, dy = end.y - start.y;
    for (let i = 1; i <= 100; i++) {
      const point = flight.sample(i / 100);
      near((point.x - start.x) * dy - (point.y - start.y) * dx, 0);
      near(Math.hypot(point.x - start.x, point.y - start.y), Math.hypot(dx, dy) * i / 100);
    }
    if (dx) assert.notEqual(flight.sample(.001).x, start.x, "Horizontal travel starts at the same time as vertical travel");
  }
});

test("reverse scrolling retraces the same segment without state or overshoot", () => {
  const flight = createBrandFlight(geometry);
  const positions = Array.from({ length: 401 }, (_, index) => flight.sample(index / 400));
  for (let index = positions.length - 1; index >= 0; index--) {
    const point = flight.sample(index / 400);
    assert.deepEqual(point, positions[index]);
    assert.ok(point.x >= geometry.destination.x && point.x <= geometry.start.x);
    assert.ok(point.y >= geometry.start.y && point.y <= geometry.destination.y);
    if (index) assert.ok(Math.hypot(point.x - positions[index - 1].x, point.y - positions[index - 1].y) < 2);
  }
});

test("scale approaches the destination monotonically without shrinking and regrowing", () => {
  for (const targetScale of [.78, 1.4, 0]) {
    const flight = createBrandFlight({ ...geometry, destination: { ...geometry.destination, scale: targetScale } });
    let previous = flight.sample(0).scale;
    for (let i = 1; i <= 100; i++) {
      const scale = flight.sample(i / 100).scale;
      assert.ok(targetScale > 1 ? scale >= previous : scale <= previous);
      assert.ok(scale >= Math.min(1, targetScale) && scale <= Math.max(1, targetScale));
      previous = scale;
    }
  }
});

test("collapsed, resized and incomplete measurements always produce finite samples", () => {
  const layouts = [
    {}, { start: { x: 0, y: 0 }, destination: { x: 0, y: 0, scale: 0 } },
    { start: { x: NaN, y: Infinity, scale: NaN }, destination: { x: -Infinity, y: NaN, scale: Infinity } },
    ...[.1, .75, 1.5, 3].map(ratio => ({ destination: { x: -264 * ratio, y: 700 * ratio, scale: .78 } }))
  ];
  for (const layout of layouts) for (const progress of [undefined, NaN, -Infinity, Infinity, ...Array.from({ length: 101 }, (_, i) => i / 100)]) {
    assert.ok(Object.values(createBrandFlight(layout).sample(progress)).every(Number.isFinite));
  }
});

test("a cached segment is isolated from later measurements and returned sample mutations", () => {
  const measured = structuredClone(geometry);
  const flight = createBrandFlight(measured);
  const before = flight.sample(.7);
  measured.destination.x = 1000;
  measured.start.y = 400;
  flight.sample(.7).x = 1000;
  assert.deepEqual(flight.sample(.7), before);
  assert.notDeepEqual(createBrandFlight(measured).sample(.7), before, "Resize must create a segment with new endpoints");
});
