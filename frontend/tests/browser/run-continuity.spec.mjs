import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const partialSummary = "A real saved requirements stage, with remaining analysis incomplete.";
const draft = {
  scenario: "RECOMMENDED", items: [{
    title: "Draft scope", description: "Not approved", quantity: 1, unit: "FIXED", rateCardHint: null,
    basis: { type: "ASSUMPTION", content: "Needs review", sourceReference: null, sourceTitle: null },
  }], petPerspective: null,
};

function seedSavedRun(state, status) {
  state.run = {
    runId: "run-one", status, activeDepartment: "REQUIREMENTS", interruption: null,
    result: { projectSummary: partialSummary, openQuestions: [], referencedDocumentIds: [],
      departmentResults: [{ department: "REQUIREMENTS", status: "COMPLETED", summary: partialSummary,
        evidenceIds: [], assumptionIds: [], sources: [], errorCode: null }],
      quotationDraft: draft, quotationDrafts: [draft] },
    errorCode: status === "FAILED" ? "RUN_EXECUTION_INTERRUPTED" : null,
    metadata: null, usage: null, updatedAt: "2026-10-01T00:01:00Z",
  };
  state.history = [{ runId: "run-one", requirementText: "Original exact customer request", status,
    createdAt: "2026-10-01T00:01:00Z" }];
}

test("accepted asynchronous clarification ignores the prior question until delivery completes", async ({ page }) => {
  const state = await fixture(page);
  seedSavedRun(state, "WAITING_FOR_USER");
  state.run.interruption = { interruptionId: "prior-question", kind: "CLARIFICATION", questions: ["Confirm source data?"] };
  let accepted = false, reads = 0;
  await page.route("**/agent-runs/run-one/responses", route => {
    state.resumes.push(route.request().postDataJSON()); accepted = true;
    return route.fulfill({ status: 202, json: { runId: "run-one", status: "QUEUED", acceptedAt: "2026-10-14T00:00:00Z" } });
  });
  await page.route("**/agent-runs/run-one", route => {
    if (accepted && ++reads >= 2) {
      state.run = { ...state.run, status: "COMPLETED", interruption: null, result: { ...state.run.result, projectSummary: "Resumed saved state completed" } };
      state.history[0].status = "COMPLETED";
    }
    return route.fulfill({ json: structuredClone(state.run) });
  });
  await page.goto(path);
  const form = page.locator(".agent-chat .interruption-form");
  await expect(form).toBeVisible(); await form.locator("textarea").fill("The customer supplies all data.");
  await form.getByRole("button", { name: "답변하고 계속", exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".agent-chat")).toContainText("Resumed saved state completed");
  await expect(form).toHaveCount(0);
  expect(state.resumes).toHaveLength(1); expect(state.starts).toEqual([]); expect(state.blocked).toEqual([]);
});

