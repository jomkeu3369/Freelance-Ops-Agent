import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const exactText = "  Preserved request · 원문\nKeep this second line  ";
const result = projectSummary => ({ projectSummary, openQuestions: [], departmentResults: [], quotationDraft: null, quotationDrafts: [] });

function seedHistory(state) {
  state.history = [
    { runId: "legacy", requirementText: "Legacy healthy request", status: "COMPLETED", createdAt: "2026-10-01T00:00:00Z" },
    { runId: "unavailable", requirementText: null, originalInputStatus: "UNAVAILABLE", originalInputIssue: "MALFORMED_PAYLOAD", status: "COMPLETED", createdAt: "2026-10-01T00:01:00Z", attachments: [] },
    { runId: "partial-attachments", requirementText: exactText, originalInputStatus: "PARTIAL", originalInputIssue: "INVALID_ATTACHMENTS", status: "COMPLETED", createdAt: "2026-10-01T00:02:00Z", attachments: [{ name: "brief.txt", status: "COMPLETE", notice: "Readable saved attachment" }] },
    { runId: "partial-text", requirementText: null, originalInputStatus: "UNAVAILABLE", originalInputIssue: "INVALID_REQUIREMENT_TEXT", status: "COMPLETED", createdAt: "2026-10-01T00:03:00Z", attachments: [{ name: "scope.csv", status: "PARTIAL", notice: "Saved extraction summary" }] },
    { runId: "missing-result", requirementText: null, originalInputStatus: "UNAVAILABLE", originalInputIssue: "MISSING_START", status: "COMPLETED", createdAt: "2026-10-01T00:04:00Z", attachments: [] },
    { runId: "healthy", requirementText: "Newest healthy request", originalInputStatus: "AVAILABLE", originalInputIssue: null, status: "COMPLETED", createdAt: "2026-10-01T00:05:00Z", attachments: [] },
  ];
  for (const item of state.history) state.pastRuns[item.runId] = {
    runId: item.runId, status: item.status, activeDepartment: null, interruption: null, errorCode: null, metadata: null, usage: null, updatedAt: item.createdAt,
    result: item.runId === "missing-result" ? null : result(`Saved result for ${item.runId}`),
  };
  state.run = state.pastRuns.healthy;
}

for (const locale of ["ko", "en"]) {
  test(`${locale}: mixed damaged and healthy history preserves results, notices and reload`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = await fixture(page);
    seedHistory(state);
    await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const log = page.getByRole("log");
    await expect(log.locator(".agent-chat-turn")).toHaveCount(6);
    expect(await log.locator(".agent-chat-turn").evaluateAll(turns => turns.map(turn => turn.dataset.runId))).toEqual(state.history.map(item => item.runId));
    for (const runId of ["legacy", "healthy"]) {
      const turn = log.locator(`[data-run-id="${runId}"]`);
      await expect(turn.locator(".agent-chat-message.user")).toContainText(runId === "legacy" ? "Legacy healthy request" : "Newest healthy request");
      await expect(turn.locator(".agent-chat-input-notice")).toHaveCount(0);
    }
    const unavailableText = locale === "ko" ? "이 요청의 원문을 불러올 수 없습니다." : "The original text of this request is unavailable.";
    for (const runId of ["unavailable", "partial-text", "missing-result"]) {
      const turn = log.locator(`[data-run-id="${runId}"]`);
      await expect(turn.locator(".agent-chat-message.user")).toHaveCount(0);
      await expect(turn.locator(".agent-chat-input-notice")).toHaveText(unavailableText);
    }
    const partial = log.locator('[data-run-id="partial-attachments"]');
    await expect(partial.locator(".agent-chat-message.user .chat-markdown")).toHaveText(exactText.trim());
    await expect(partial.locator(".agent-chat-input-notice")).toHaveText(locale === "ko" ? "일부 첨부 자료 정보를 불러올 수 없습니다." : "Some attachment information is unavailable.");
    await expect(partial).toContainText("brief.txt · COMPLETE Readable saved attachment");
    await expect(log.locator('[data-run-id="partial-text"]')).toContainText("scope.csv · PARTIAL Saved extraction summary");
    const missing = log.locator('[data-run-id="missing-result"]');
    await expect(missing).toContainText(locale === "ko" ? "이 실행에 저장된 결과가 없습니다." : "No result was saved for this run.");
    await expect(missing.getByRole("button", { name: locale === "ko" ? "결과 열기" : "Open result" })).toHaveCount(0);
    await expect(log).not.toContainText(state.projects[0].requirementText);

    const open = log.locator('[data-run-id="unavailable"]').getByRole("button", { name: locale === "ko" ? "결과 열기" : "Open result" });
    await open.click();
    await expect(page.locator(".agent-chat-result-panel")).toContainText("Saved result for unavailable");
    await page.keyboard.press("Escape");
    await expect(page.locator(".agent-chat-result-panel")).toHaveCount(0);
    await expect(open).toBeFocused();
    await page.locator("#agent-chat-input").fill("Unsent draft stays unchanged");
    await page.reload();
    await expect(log.locator(".agent-chat-turn")).toHaveCount(6);
    await expect(log.locator('[data-run-id="unavailable"] .agent-chat-input-notice')).toHaveText(unavailableText);
    await expect(page.locator("#agent-chat-input")).toHaveValue("Unsent draft stays unchanged");
    await log.locator('[data-run-id="partial-attachments"]').getByRole("button", { name: locale === "ko" ? "결과 열기" : "Open result" }).click();
    await expect(page.locator(".agent-chat-result-panel")).toContainText("Saved result for partial-attachments");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(state.starts).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.blocked).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("result-read retry is independent of unavailable input and never resends a request", async ({ page }) => {
  const state = await fixture(page);
  seedHistory(state);
  let resultAvailable = false;
  await page.route("**/api/v2/workspaces/local-space/agent-runs/unavailable", route => route.fulfill({
    status: resultAvailable ? 200 : 503,
    json: resultAvailable ? state.pastRuns.unavailable : { message: "Fixture result unavailable" },
  }));
  await page.goto(path);
  const turn = page.locator('[data-run-id="unavailable"]');
  await expect(turn.locator(".agent-chat-input-notice")).toHaveText("이 요청의 원문을 불러올 수 없습니다.");
  await expect(turn).toContainText("저장된 결과를 확인할 수 없습니다.");
  await expect(turn.getByRole("button", { name: "결과 열기" })).toHaveCount(0);
  resultAvailable = true;
  await turn.getByRole("button", { name: "기록 다시 불러오기" }).click();
  await expect(turn.getByRole("button", { name: "결과 열기" })).toBeVisible();
  await expect(turn.locator(".agent-chat-input-notice")).toHaveText("이 요청의 원문을 불러올 수 없습니다.");
  await expect(turn.locator(".agent-chat-message.user")).toHaveCount(0);
  await expect(turn.getByRole("button", { name: "기록 다시 불러오기" })).toHaveCount(0);
  await turn.getByRole("button", { name: "결과 열기" }).click();
  await expect(page.locator(".agent-chat-result-panel")).toContainText("Saved result for unavailable");
  expect(state.starts).toEqual([]);
  expect(state.writes).toEqual([]);
});

test("whole-history failure retries into healthy and partial turns without replacing the draft", async ({ page }) => {
  const state = await fixture(page);
  seedHistory(state);
  let historyAvailable = false;
  await page.route(url => url.pathname.endsWith("/agent-runs/history"), route => route.fulfill({
    status: historyAvailable ? 200 : 503,
    json: historyAvailable ? state.history : { message: "Fixture history unavailable" },
  }));
  await page.goto(path);
  await expect(page.getByRole("log").getByRole("alert")).toContainText("Fixture history unavailable");
  await page.locator("#agent-chat-input").fill("Keep this unsubmitted request");
  historyAvailable = true;
  await page.getByRole("button", { name: "기록 다시 불러오기" }).click();
  await expect(page.locator(".agent-chat-turn")).toHaveCount(6);
  await expect(page.getByRole("log").getByRole("alert")).toHaveCount(0);
  await expect(page.locator('[data-run-id="partial-attachments"] .agent-chat-input-notice')).toBeVisible();
  await expect(page.locator("#agent-chat-input")).toHaveValue("Keep this unsubmitted request");
  expect(state.starts).toEqual([]);
  expect(state.writes).toEqual([]);
});
