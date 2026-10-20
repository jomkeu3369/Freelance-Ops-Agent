import assert from "node:assert/strict";
import test from "node:test";
import { queueSceneStartup } from "../features/home/webgl/startup-queue.mjs";

function scheduler(withIdle = true) {
  let id = 0;
  const frames = new Map();
  const idle = new Map();
  const timers = new Map();
  const view = {
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
    setTimeout: callback => { timers.set(++id, callback); return id; },
    clearTimeout: key => timers.delete(key)
  };
  if (withIdle) {
    view.requestIdleCallback = callback => { idle.set(++id, callback); return id; };
    view.cancelIdleCallback = key => idle.delete(key);
  }
  const flush = collection => {
    const callbacks = [...collection.values()];
    collection.clear();
    callbacks.forEach(callback => callback());
  };
  return { view, frames, idle, timers, frame: () => flush(frames), available: () => flush(withIdle ? idle : timers) };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
async function paintAndStart(clock) {
  await settle();
  clock.frame();
  clock.frame();
  clock.available();
  await settle();
}

test("첫 프레임을 표시하고 유휴 시간이 생긴 뒤 장면을 준비한다", async () => {
  const clock = scheduler();
  const calls = [];
  queueSceneStartup(() => calls.push("장면"), assert.fail, clock.view);
  await settle();
  assert.deepEqual(calls, []);
  clock.frame();
  assert.equal(clock.idle.size, 0);
  clock.frame();
  assert.deepEqual(calls, []);
  clock.available();
  await settle();
  assert.deepEqual(calls, ["장면"]);
});

test("첫 장면의 비동기 준비가 끝나야 다음 장면을 시작한다", async () => {
  const clock = scheduler();
  const calls = [];
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  queueSceneStartup(async () => { calls.push("첫 장면"); await pending; }, assert.fail, clock.view);
  queueSceneStartup(() => calls.push("다음 장면"), assert.fail, clock.view);
  await paintAndStart(clock);
  assert.deepEqual(calls, ["첫 장면"]);
  assert.equal(clock.frames.size, 0);
  finish();
  await paintAndStart(clock);
  assert.deepEqual(calls, ["첫 장면", "다음 장면"]);
});

for (const point of ["대기열", "첫 프레임", "유휴 시간"]) {
  test(`${point}에서 취소한 작업은 실행하지 않고 다음 장면을 진행한다`, async () => {
    const clock = scheduler();
    const calls = [];
    const cancel = queueSceneStartup(() => calls.push("취소됨"), assert.fail, clock.view);
    queueSceneStartup(() => calls.push("다음 장면"), assert.fail, clock.view);
    if (point !== "대기열") { await settle(); clock.frame(); }
    if (point === "유휴 시간") clock.frame();
    cancel();
    await paintAndStart(clock);
    assert.deepEqual(calls, ["다음 장면"]);
    assert.equal(clock.frames.size + clock.idle.size + clock.timers.size, 0);
  });
}

test("유휴 시간 API가 없어도 첫 화면을 그린 뒤 실행하며 취소할 수 있다", async () => {
  const clock = scheduler(false);
  const calls = [];
  const cancel = queueSceneStartup(() => calls.push("취소됨"), assert.fail, clock.view);
  await settle();
  clock.frame();
  clock.frame();
  assert.equal(clock.timers.size, 1);
  cancel();
  queueSceneStartup(() => calls.push("다음 장면"), assert.fail, clock.view);
  await paintAndStart(clock);
  assert.deepEqual(calls, ["다음 장면"]);
});

test("준비 실패를 전달한 뒤에도 다른 장면은 계속 준비한다", async () => {
  const clock = scheduler();
  const errors = [];
  const calls = [];
  queueSceneStartup(() => { throw new Error("셰이더 준비 실패"); }, error => errors.push(error.message), clock.view);
  queueSceneStartup(() => calls.push("다음 장면"), assert.fail, clock.view);
  await paintAndStart(clock);
  await paintAndStart(clock);
  assert.deepEqual(errors, ["셰이더 준비 실패"]);
  assert.deepEqual(calls, ["다음 장면"]);
});
