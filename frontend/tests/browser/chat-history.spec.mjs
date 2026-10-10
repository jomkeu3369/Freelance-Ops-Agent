import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

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
  const preserved = page.locator('[data-run-id="legacy"]');
  await expect(preserved).toContainText("Saved result for legacy");
  await page.route("**/api/v2/workspaces/local-space/agent-runs/legacy", route => route.fulfill({ status: 503, json: { message: "Synthetic refresh outage" } }));
  resultAvailable = true;
  await turn.getByRole("button", { name: "기록 다시 불러오기" }).click();
  await expect(turn.getByRole("button", { name: "결과 열기" })).toBeVisible();
  await expect(turn.locator(".agent-chat-input-notice")).toHaveText("이 요청의 원문을 불러올 수 없습니다.");
  await expect(turn.locator(".agent-chat-message.user")).toHaveCount(0);
  await expect(turn.getByRole("button", { name: "기록 다시 불러오기" })).toHaveCount(0);
  await expect(preserved).toContainText("저장된 결과를 확인할 수 없습니다.");
  await expect(preserved).toContainText("Saved result for legacy");
  await expect(preserved.getByRole("button", { name: "결과 열기" })).toBeVisible();
  await expect(preserved.getByRole("button", { name: "기록 다시 불러오기" })).toBeEnabled();
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

test("a slow result cannot hide original history, healthy results, or another result's retry", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = await fixture(page);
  seedHistory(state);
  const barrier = requestBarrier();
  await page.route("**/api/v2/workspaces/local-space/agent-runs/unavailable", async route => {
    await barrier.wait();
    await route.fulfill({ json: state.pastRuns.unavailable });
  });
  await page.route("**/api/v2/workspaces/local-space/agent-runs/partial-text", route => route.fulfill({ status: 503, json: { message: "Synthetic result outage" } }));
  try {
    await page.goto(path);
    await barrier.entered;
    const log = page.getByRole("log");
    await expect(log.locator(".agent-chat-turn")).toHaveCount(6);
    await expect(log.locator('[data-run-id="legacy"]')).toContainText("Legacy healthy request");
    await expect(log.locator('[data-run-id="legacy"]')).toContainText("Saved result for legacy");
    const slow = log.locator('[data-run-id="unavailable"]');
    await expect(slow.locator(".agent-chat-input-notice")).toHaveText("이 요청의 원문을 불러올 수 없습니다.");
    await expect(slow).toContainText("작업 기록을 불러오는 중입니다.");
    await expect(slow).not.toContainText("저장된 결과를 확인할 수 없습니다.");
    await expect(slow.getByRole("button", { name: "기록 다시 불러오기" })).toHaveCount(0);
    await expect(log.locator('[data-run-id="partial-text"]').getByRole("button", { name: "기록 다시 불러오기" })).toBeEnabled();
    await page.locator("#agent-chat-input").fill("Draft while old result is loading");
    barrier.release();
    await expect(slow.getByRole("button", { name: "결과 열기" })).toBeVisible();
    await expect(slow).not.toContainText("작업 기록을 불러오는 중입니다.");
    await expect(page.locator("#agent-chat-input")).toHaveValue("Draft while old result is loading");
    await page.route(url => url.pathname.endsWith("/agent-runs/history"), route => route.fulfill({ status: 503, json: { message: "Synthetic history refresh outage" } }));
    await log.locator('[data-run-id="partial-text"]').getByRole("button", { name: "기록 다시 불러오기" }).click();
    await expect(log.getByRole("alert")).toContainText("Synthetic history refresh outage");
    await expect(log.locator(".agent-chat-turn")).toHaveCount(6);
    await expect(log.locator('[data-run-id="legacy"]')).toContainText("Saved result for legacy");
    await expect(slow.getByRole("button", { name: "결과 열기" })).toBeVisible();
    await expect(page.locator("#agent-chat-input")).toHaveValue("Draft while old result is loading");
    expect(state.starts).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(errors).toEqual([]);
  } finally { barrier.release(); }
});

function seedSingleTurn(state, runId, message = `Original ${runId}`) {
  const item = { runId, requirementText: message, status: "COMPLETED", createdAt: "2026-10-01T00:00:00Z", attachments: [] };
  state.pastRuns[runId] = { runId, status: "COMPLETED", activeDepartment: null, interruption: null, errorCode: null, metadata: null, usage: null, updatedAt: item.createdAt, result: result(`Saved result for ${runId}`) };
  return item;
}

for (const boundary of ["history", "result"]) {
  test(`late ${boundary} cannot restore a previous project visit after A to B to A`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = await fixture(page);
    state.projects.push({ ...state.projects[0], id: "project-two", title: "Second project" });
    state.history = [seedSingleTurn(state, "old-visit")];
    state.projectHistory["project-two"] = [seedSingleTurn(state, "project-b")];
    const oldResponse = boundary === "history" ? structuredClone(state.history) : structuredClone(state.pastRuns["old-visit"]);
    const barrier = requestBarrier();
    let held = false;
    const endpoint = boundary === "history" ? "**/api/v2/workspaces/local-space/projects/project-one/agent-runs/history?limit=20" : "**/api/v2/workspaces/local-space/agent-runs/old-visit";
    await page.route(endpoint, async route => {
      if (held) return route.fallback();
      held = true;
      await barrier.wait();
      await route.fulfill({ json: oldResponse });
    });
    try {
      await page.goto(path);
      await barrier.entered;
      const recent = page.getByRole("navigation", { name: "최근 프로젝트 대화" });
      await recent.getByRole("button", { name: /Second project/ }).click();
      await expect(page).toHaveURL(/project-two\/agent$/);
      await expect(page.getByRole("log")).toContainText("Saved result for project-b");
      state.history = [seedSingleTurn(state, "new-visit")];
      await recent.getByRole("button", { name: /Original project title/ }).click();
      await expect(page).toHaveURL(/project-one\/agent$/);
      await expect(page.getByRole("log")).toContainText("Saved result for new-visit");
      await page.locator("#agent-chat-input").fill("New visit draft");
      const released = page.waitForResponse(response => boundary === "history" ? response.url().includes("/project-one/agent-runs/history") : response.url().endsWith("/agent-runs/old-visit"));
      barrier.release();
      await (await released).finished();
      await expect(page.getByRole("log")).not.toContainText("Original old-visit");
      await expect(page.getByRole("log")).not.toContainText("Saved result for project-b");
      await expect(page.getByRole("log")).toContainText("Saved result for new-visit");
      await expect(page.locator("#agent-chat-input")).toHaveValue("New visit draft");
      if (boundary === "history") expect(state.runReads).not.toContain("old-visit");
      expect(state.starts).toEqual([]);
      expect(state.writes).toEqual([]);
      expect(errors).toEqual([]);
    } finally { barrier.release(); }
  });
}

for (const boundary of ["history", "result"]) {
  test(`late ${boundary} from a logged-out account cannot populate the next account`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const state = await fixture(page);
    state.history = [seedSingleTurn(state, "old-account")];
    const oldResponse = boundary === "history" ? structuredClone(state.history) : structuredClone(state.pastRuns["old-account"]);
    const barrier = requestBarrier();
    let held = false;
    let currentUser = "local-user";
    const endpoint = boundary === "history" ? "**/api/v2/workspaces/local-space/projects/project-one/agent-runs/history?limit=20" : "**/api/v2/workspaces/local-space/agent-runs/old-account";
    await page.route(endpoint, async route => {
      if (held) return route.fallback();
      held = true;
      await barrier.wait();
      await route.fulfill({ json: oldResponse });
    });
    await page.route("**/api/v2/auth/logout", route => route.fulfill({ status: 204 }));
    await page.route("**/api/v2/auth/login", route => {
      currentUser = "next-user";
      return route.fulfill({ json: { userId: currentUser, workspaceId: "local-space", accessToken: "next-fixture-token", refreshToken: "next-fixture-refresh", accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" } });
    });
    await page.route("**/api/v2/me", route => route.fulfill({ json: { id: currentUser, email: "fixture@example.invalid", displayName: "Fixture", status: "ACTIVE", workspaces: [{ workspaceId: "local-space", name: "Fixture", slug: "fixture", effectivePermissions: state.permissions }] } }));
    try {
      await page.goto(path);
      await barrier.entered;
      await page.locator("#agent-chat-input").fill("Old account draft");
      await page.locator(".sidebar-foot button").click();
      await expect(page.locator('input[name="email"]')).toBeVisible();
      state.history = [seedSingleTurn(state, "new-account")];
      await page.locator('input[name="email"]').fill("fixture@example.invalid");
      await page.locator('input[name="password"]').fill("synthetic-password");
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole("log")).toContainText("Saved result for new-account");
      await expect(page.locator("#agent-chat-input")).toHaveValue("");
      const released = page.waitForResponse(response => boundary === "history" ? response.url().includes("/project-one/agent-runs/history") : response.url().endsWith("/agent-runs/old-account"));
      barrier.release();
      await (await released).finished();
      await expect(page.getByRole("log")).not.toContainText("old-account");
      await expect(page.getByRole("log")).toContainText("Saved result for new-account");
      if (boundary === "history") expect(state.runReads).not.toContain("old-account");
      expect(state.starts).toEqual([]);
      expect(state.writes).toEqual([]);
      expect(errors).toEqual([]);
    } finally { barrier.release(); }
  });
}
