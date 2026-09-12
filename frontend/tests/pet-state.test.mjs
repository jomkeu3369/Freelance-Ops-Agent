import test from "node:test";
import assert from "node:assert/strict";
import { petWorkState, duplicateTaskTitles } from "../features/workspace/pets/pet-state.mjs";

test("pets never infer completed work from the overall run completing", () => {
  assert.equal(petWorkState(null, ["RESEARCH"]), "idle");
  assert.equal(petWorkState({ status: "COMPLETED", result: null }, ["RESEARCH"]), "notRun");
  const run = { status: "COMPLETED", result: { departmentResults: [{ department: "RESEARCH", status: "COMPLETED" }] } };
  assert.equal(petWorkState(run, ["RESEARCH"]), "ready");
  assert.equal(petWorkState(run, ["RESEARCH", "VERIFICATION"]), "partial");
});

test("failure cancellation and human review supersede the working animation", () => {
  for (const [status, expected] of [["FAILED", "failed"], ["CANCELLED", "cancelled"], ["WAITING_FOR_USER", "waiting"]]) {
    assert.equal(petWorkState({ status, activeDepartment: "RESEARCH", result: null }, ["RESEARCH"]), expected);
  }
  assert.equal(petWorkState({ status: "RUNNING", activeDepartment: "RESEARCH", result: null }, ["RESEARCH"]), "working");
  assert.equal(petWorkState({ status: "RUNNING", activeDepartment: "DEAL_DESIGN", result: null }, ["RESEARCH"]), "queued");
});

test("partial runs retain completed work but do not conceal department errors", () => {
  const run = { status: "PARTIAL", result: { departmentResults: [{ department: "RESEARCH", status: "COMPLETED", errorCode: "FAILED" }] } };
  assert.equal(petWorkState(run, ["RESEARCH"]), "partial");
  run.result.departmentResults[0].errorCode = null;
  assert.equal(petWorkState(run, ["RESEARCH"]), "ready");
  assert.equal(petWorkState(run, ["DEAL_DESIGN"]), "partial");
});

test("combining alternatives detects duplicate work regardless of spacing and Unicode width", () => {
  assert.deepEqual(duplicateTaskTitles([{ title: "예약  화면" }, { title: " 예약 화면 " }]), [" 예약 화면 "]);
  assert.deepEqual(duplicateTaskTitles([{ title: "API" }, { title: "ＡＰＩ" }]), ["ＡＰＩ"]);
  assert.deepEqual(duplicateTaskTitles([{ title: "예약 화면" }, { title: "관리자 화면" }]), []);
});
