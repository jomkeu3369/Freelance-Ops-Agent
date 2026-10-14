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

for (const locale of ["ko", "en"]) {
  test(`${locale}: saved intermediate output never hides clarification or resumes by itself`, async ({ page }) => {
    const state = await fixture(page);
    seedSavedRun(state, "WAITING_FOR_USER");
    state.run.interruption = { interruptionId: "saved-question", kind: "CLARIFICATION", questions: ["Confirm the deadline?"] };
    await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), locale);
    await page.goto(path);
    await expect(page.locator(".agent-chat-result")).toContainText(partialSummary);
    const form = page.locator(".agent-chat .interruption-form");
    await expect(form).toBeVisible();
    await form.locator("textarea").fill("Unsubmitted clarification stays saved");
    await page.locator(".agent-chat-result button").click();
    const panel = page.locator(".agent-chat-result-panel");
    await expect(panel.locator(".result-state.partial")).toBeVisible();
    await expect(panel).toContainText(locale === "ko" ? "최종 확정에는 사용할 수 없습니다" : "cannot be used for final approval");
    await expect(panel.getByRole("button", { name: locale === "ko" ? "견적 비교하기" : "Compare estimates" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(form).toBeVisible();
    await expect(form.locator("textarea")).toHaveValue("Unsubmitted clarification stays saved");
    expect(state.starts).toEqual([]);
    expect(state.resumes).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.blocked).toEqual([]);
  });

  for (const status of ["FAILED", "CANCELLED"]) {
    test(`${locale}: ${status} preserves useful output and explains the stop without false completion`, async ({ page }) => {
      const state = await fixture(page);
      seedSavedRun(state, status);
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), locale);
      await page.goto(path);
      const turn = page.locator('[data-run-id="run-one"]');
      await expect(turn).toContainText(partialSummary);
      if (status === "FAILED") await expect(turn).toContainText(locale === "ko" ? "자동으로 다시 실행하지 않습니다" : "will not restart automatically");
      else await expect(turn).toContainText(locale === "ko" ? "작업이 취소되었습니다" : "The work was cancelled");
      await page.locator("#agent-chat-input").fill("A new request that has not been sent");
      await turn.locator(".agent-chat-result button").click();
      const panel = page.locator(".agent-chat-result-panel");
      await expect(panel.locator(".result-state.partial")).toContainText(locale === "ko" ? "중단 전 저장된 결과" : "Results saved before the run stopped");
      await expect(panel.getByRole("button", { name: locale === "ko" ? "견적 비교하기" : "Compare estimates" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(turn).toContainText(partialSummary);
      await expect(page.locator("#agent-chat-input")).toHaveValue("A new request that has not been sent");
      expect(state.starts).toEqual([]);
      expect(state.resumes).toEqual([]);
      expect(state.writes).toEqual([]);
      expect(state.blocked).toEqual([]);
    });
  }
}
