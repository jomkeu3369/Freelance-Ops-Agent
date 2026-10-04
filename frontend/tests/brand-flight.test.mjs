import test from "node:test";
import assert from "node:assert/strict";
import { createBrandFlight } from "../features/home/brand-flight.mjs";

const geometry = {
  start: { x: 0, y: 90 }, corridorX: 0, clearY: 560,
  destination: { x: -264, y: 700, scale: .78 }, compactScale: .36,
};
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test("the flight meets exact measured endpoints and clamps overscroll", () => {
  const flight = createBrandFlight(geometry);
  assert.deepEqual(flight.sample(0), { ...geometry.start, scale: 1 });
  assert.deepEqual(flight.sample(1), geometry.destination);
  assert.deepEqual(flight.sample(-4), flight.sample(0));
  assert.deepEqual(flight.sample(4), flight.sample(1));
  assert.deepEqual(flight.sample(-Infinity), flight.sample(0));
  assert.deepEqual(flight.sample(Infinity), flight.sample(1));
});

test("reverse scroll retraces the same continuous samples without state", () => {
  const flight = createBrandFlight(geometry);
  const positions = Array.from({ length: 401 }, (_, index) => flight.sample(index / 400));
  for (let index = positions.length - 1; index >= 0; index--) {
    assert.deepEqual(flight.sample(index / 400), positions[index]);
    if (index) assert.ok(Math.hypot(positions[index].x - positions[index - 1].x, positions[index].y - positions[index - 1].y) < 5, "No positional jump between nearby samples");
  }
});

test("the mark descends in the corridor and turns left only below both copy blocks", () => {
  for (const layout of [geometry, { ...geometry, clearY: 690 }, { ...geometry, destination: { x: -450, y: 560, scale: .6 } }]) {
    const flight = createBrandFlight(layout);
    const junction = flight.sample(flight.corridorProgress);
    near(junction.x, layout.corridorX);
    near(junction.y, layout.clearY);
    for (let index = 0; index <= 1000; index++) {
      const point = flight.sample(index / 1000);
      if (point.y < layout.clearY - 1e-9) near(point.x, layout.corridorX);
      if (point.x < layout.corridorX) assert.ok(point.y >= layout.clearY - 1e-9, "The bend cannot cut through card copy");
    }
  }
});

test("an offset source approaches the measured corridor without crossing it early", () => {
  const layout = { ...geometry, start: { x: 15, y: 70 }, corridorX: -10 };
  const flight = createBrandFlight(layout);
  for (let index = 0; index <= 200; index++) {
    const point = flight.sample(flight.corridorProgress * index / 200);
    assert.ok(point.x >= layout.corridorX && point.x <= layout.start.x);
  }
});

test("the two unequal-duration curves join with a continuous nonzero tangent", () => {
  const flight = createBrandFlight(geometry);
  const p = flight.corridorProgress;
  assert.notEqual(p, .5, "Check timing-adjusted handles, not equal-duration curves");
  const epsilon = 1e-6;
  const before = flight.sample(p - epsilon);
  const join = flight.sample(p);
  const after = flight.sample(p + epsilon);
  const left = { x: (join.x - before.x) / epsilon, y: (join.y - before.y) / epsilon };
  const right = { x: (after.x - join.x) / epsilon, y: (after.y - join.y) / epsilon };
  near(left.x, right.x, .02);
  near(left.y, right.y, .02);
  assert.ok(left.y > 0 && right.y > 0, "The mark keeps moving downward through the turn");
  near(left.x, 0, .02);
});

test("the measured Korean layout descends monotonically without overshooting the hub", () => {
  const layouts = [
    { start: { x: 0, y: 90.84 }, corridorX: 0, clearY: 583.53, destination: { x: -263.72, y: 678.66, scale: .8592 }, compactScale: .587 },
    { ...geometry, clearY: geometry.destination.y - 1 },
    { ...geometry, clearY: geometry.destination.y },
  ];
  for (const layout of layouts) {
    const flight = createBrandFlight(layout);
    let previous = flight.sample(0);
    for (let index = 1; index <= 1000; index++) {
      const point = flight.sample(index / 1000);
      assert.ok(point.y >= previous.y - 1e-9, "The F cannot dip below its target and then reverse upward");
      assert.ok(point.y <= layout.destination.y + 1e-9, "All intermediate positions stay above the hub's final center");
      previous = point;
    }
  }
});

test("the mark stays compact through the copy corridor and grows smoothly near arrival", () => {
  const flight = createBrandFlight(geometry);
  const compactFrom = flight.corridorProgress * .3;
  const growFrom = flight.corridorProgress + (1 - flight.corridorProgress) * .6;
  for (let index = 0; index <= 100; index++) {
    near(flight.sample(compactFrom + (growFrom - compactFrom) * index / 100).scale, geometry.compactScale);
  }
  let previous = geometry.compactScale;
  for (let index = 1; index <= 100; index++) {
    const scale = flight.sample(growFrom + (1 - growFrom) * index / 100).scale;
    assert.ok(scale >= previous && scale <= geometry.destination.scale);
    previous = scale;
  }
  const epsilon = 1e-6;
  for (const boundary of [compactFrom, growFrom]) {
    near((flight.sample(boundary).scale - flight.sample(boundary - epsilon).scale) / epsilon, 0, .001);
    near((flight.sample(boundary + epsilon).scale - flight.sample(boundary).scale) / epsilon, 0, .001);
  }
});

test("collapsed, resized and incomplete measurements always produce finite samples", () => {
  const layouts = [
    {}, { start: { x: 0, y: 0 }, destination: { x: 0, y: 0, scale: 0 }, clearY: 0 },
    { ...geometry, clearY: 90, destination: { x: 0, y: 90, scale: .5 } },
    { ...geometry, clearY: -100, destination: { x: -100, y: -200, scale: .4 } },
    { start: { x: NaN, y: Infinity, scale: NaN }, corridorX: Infinity, clearY: NaN, destination: { x: -Infinity, y: NaN, scale: Infinity }, compactScale: NaN },
    ...[.1, .75, 1.5, 3].map(ratio => ({
      ...geometry, start: { x: 0, y: geometry.start.y * ratio }, clearY: geometry.clearY * ratio,
      destination: { ...geometry.destination, x: geometry.destination.x * ratio, y: geometry.destination.y * ratio },
    })),
  ];
  for (const layout of layouts) {
    const flight = createBrandFlight(layout);
    for (const progress of [undefined, NaN, -Infinity, Infinity, ...Array.from({ length: 101 }, (_, index) => index / 100)]) {
      assert.ok(Object.values(flight.sample(progress)).every(Number.isFinite), JSON.stringify(layout));
    }
  }
});

test("the cached path is isolated from later layout mutations and sample changes", () => {
  const measured = structuredClone(geometry);
  const flight = createBrandFlight(measured);
  const before = flight.sample(.7);
  measured.destination.x = 1000;
  measured.start.y = 400;
  flight.sample(.7).x = 1000;
  assert.deepEqual(flight.sample(.7), before);
  assert.notDeepEqual(createBrandFlight(measured).sample(.7), before, "A refresh builds a new path from new geometry");
});
