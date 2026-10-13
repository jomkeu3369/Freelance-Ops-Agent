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

test("only product default names translate; a custom pet named like a default stays verbatim", async () => {
  const { petDisplayName } = await import("../features/workspace/pets/pet-state.mjs");
  const translate = name => name === "차근" ? "Calm" : name;
  assert.equal(petDisplayName({ slot: "LEAN", name: "차근" }, translate), "Calm");
  assert.equal(petDisplayName({ slot: "LEAN", name: "차근", petId: "custom-pet" }, translate), "차근");
  assert.equal(petDisplayName({ slot: "LEAN", name: "나만의 펫" }, translate), "나만의 펫");
});


test("perspectives use their exact recorded slot rather than duplicating a selected personal pet", async () => {
  const { perspectiveProfile } = await import("../features/workspace/pets/pet-state.mjs");
  const defaults = ["LEAN", "RECOMMENDED", "EXPANDED"].map(slot => ({ slot, name: `Default ${slot}` }));
  const personal = { slot: "RECOMMENDED", petId: "custom-one", name: "My pet" };
  assert.equal(perspectiveProfile([personal], "RECOMMENDED", defaults), personal);
  assert.equal(perspectiveProfile([personal], "LEAN", defaults), defaults[0]);
  assert.equal(perspectiveProfile([personal], "EXPANDED", defaults), defaults[2]);
  const other = { slot: "LEAN", petId: "custom-two", name: "Other pet" };
  assert.equal(perspectiveProfile([personal, other], "LEAN", defaults), other);
  assert.equal(perspectiveProfile([], "LEAN", defaults), defaults[0]);
});

test("task selections cannot migrate into newer draft content or another project", async () => {
  const { petTaskSelectionId } = await import("../features/workspace/pets/pet-state.mjs");
  const draft = { scenario: "LEAN", items: [{ title: "Source task", quantity: 1 }], petPerspective: null };
  const original = petTaskSelectionId("project-one", draft, 0);
  assert.equal(petTaskSelectionId("project-one", structuredClone(draft), 0), original);
  assert.notEqual(petTaskSelectionId("project-two", draft, 0), original);
  assert.notEqual(petTaskSelectionId("project-one", { ...draft, items: [{ title: "Replacement task", quantity: 1 }] }, 0), original);
  assert.notEqual(petTaskSelectionId("project-one", { ...draft, petPerspective: { proposal: "New source opinion" } }, 0), original);
});


test("a personal pet follows the actual run rather than pretending every department was assigned", async () => {
  const { personalPetWorkState } = await import("../features/workspace/pets/pet-state.mjs");
  const result = { departmentResults: [{ department: "REQUIREMENTS", status: "COMPLETED", errorCode: null }] };
  assert.equal(personalPetWorkState({ status: "COMPLETED", result }), "ready");
  assert.equal(personalPetWorkState({ status: "PARTIAL", result }), "partial");
  assert.equal(personalPetWorkState({ status: "FAILED", result }), "failed");
  assert.equal(personalPetWorkState({ status: "CANCELLED", result }), "cancelled");
  assert.equal(personalPetWorkState({ status: "WAITING_FOR_USER", result }), "waiting");
  assert.equal(personalPetWorkState({ status: "COMPLETED", result: null }), "notRun");
  assert.equal(personalPetWorkState({ status: "RUNNING", activeDepartment: "REQUIREMENTS", result: null }), "working");
  assert.equal(personalPetWorkState({ status: "RUNNING", activeDepartment: null, result: null }), "queued");
});

test("recorded source departments retain their own actual outcome and unknown status stays inconclusive", async () => {
  const { petDepartmentResultState } = await import("../features/workspace/pets/pet-state.mjs");
  assert.equal(petDepartmentResultState({ status: "COMPLETED", errorCode: null }), "ready");
  assert.equal(petDepartmentResultState({ status: "COMPLETED", errorCode: "SOURCE_ERROR" }), "partial");
  assert.equal(petDepartmentResultState({ status: "FAILED", errorCode: null }), "failed");
  assert.equal(petDepartmentResultState({ status: "SKIPPED", errorCode: null }), "notRun");
  assert.equal(petDepartmentResultState({ status: "UNRECOGNIZED", errorCode: null }), "partial");
});
