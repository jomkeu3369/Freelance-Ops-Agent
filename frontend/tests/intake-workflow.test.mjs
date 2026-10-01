import assert from "node:assert/strict";
import test from "node:test";
import { createProjectIntakeDraft, hasProjectIntakeDraft, projectIntakeDraftScope, readProjectIntakeDraft } from "../app/lib/project-intake-draft.mjs";
import { nextWorkflowStep, workflowEventCounts, workflowPreviewEventCount } from "../features/home/workflow-preview.mjs";

test("intake drafts preserve every raw field, including whitespace and decimal budgets", () => {
  const expected = { title: "  첫 문의  ", requirementText: "첫 줄\n둘째 줄  ", clientId: "client-1", currency: "USD", deadline: "2026-11-30", budgetMin: "1.25", budgetMax: "2.75" };
  const data = new FormData();
  for (const [field, value] of Object.entries(expected)) data.set(field, value);
  assert.deepEqual(readProjectIntakeDraft(data), expected);
  assert.equal(hasProjectIntakeDraft(expected), true);
  assert.equal(hasProjectIntakeDraft(createProjectIntakeDraft()), false);
  assert.equal(hasProjectIntakeDraft({ ...createProjectIntakeDraft(), currency: "USD" }), true);
  assert.equal(hasProjectIntakeDraft({ ...createProjectIntakeDraft(), requirementText: " " }), true);
});

test("intake draft scopes cannot collide across accounts or workspace IDs with separators", () => {
  const owners = [{ userId: "a:b", workspaceId: "c" }, { userId: "a", workspaceId: "b:c" }, { userId: "a", workspaceId: "c" }];
  assert.equal(new Set(owners.map(projectIntakeDraftScope)).size, owners.length);
  const first = createProjectIntakeDraft();
  first.title = "first";
  assert.equal(createProjectIntakeDraft().title, "");
});

test("one workflow timeline includes the final event and stays synchronized for repeated cycles", () => {
  assert.equal(workflowPreviewEventCount(0), 1);
  assert.equal(workflowPreviewEventCount(4), 7);
  let step = 0;
  for (let tick = 0; tick < 150; tick += 1) {
    assert.equal(step, tick % 5);
    assert.equal(workflowPreviewEventCount(step), workflowEventCounts[step]);
    if (step > 0) assert.ok(workflowPreviewEventCount(step) > workflowPreviewEventCount(step - 1));
    step = nextWorkflowStep(step);
  }
  assert.equal(step, 0);
});
