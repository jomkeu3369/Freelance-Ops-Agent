import test from "node:test";
import assert from "node:assert/strict";
import { isPendingResumeSnapshot } from "../app/lib/run-resume-state.mjs";

const pending = { runId: "run-one", interruptionId: "old-question" };
const old = { runId: "run-one", status: "WAITING_FOR_USER", interruption: { interruptionId: "old-question" } };

test("an acknowledged answer keeps polling past the prior asynchronous question", () => {
  assert.equal(isPendingResumeSnapshot(pending, old), true);
  assert.deepEqual(pending, { runId: "run-one", interruptionId: "old-question" });
});

test("a new question, different run or no accepted response is a real pause", () => {
  assert.equal(isPendingResumeSnapshot(pending, { ...old, interruption: { interruptionId: "new-question" } }), false);
  assert.equal(isPendingResumeSnapshot(pending, { ...old, runId: "another-run" }), false);
  assert.equal(isPendingResumeSnapshot(null, old), false);
});

test("active and terminal states are applied normally after resume acceptance", () => {
  for (const status of ["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]) {
    assert.equal(isPendingResumeSnapshot(pending, { ...old, status }), false);
  }
});
