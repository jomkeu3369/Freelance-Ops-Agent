import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const request = "  고객 원문을 그대로 검토해 주세요.\n두 번째 줄 · 견적은 초안으로만  ";
const completedResult = { projectSummary: "요구사항과 작업 범위를 정리했습니다. 견적은 검토 후 확정하세요.", openQuestions: [], departmentResults: [], quotationDraft: null, quotationDrafts: [] };

function seedRun(state, status = "RUNNING") {
  state.run = { runId: "run-one", status, activeDepartment: "requirements", interruption: null, result: null, errorCode: null, metadata: null, usage: null, updatedAt: "2026-10-01T00:01:00Z" };
  state.history = [{ runId: "run-one", requirementText: request, status, createdAt: "2026-10-01T00:01:00Z" }];
}

test("multiline text, simulated Korean composition, duplicate submit and next draft", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(path);
  const input = page.locator("#agent-chat-input");
  await input.fill(request);
  await input.dispatchEvent("compositionstart");
  await input.press("Control+Enter");
  expect(state.starts).toHaveLength(0);
  await input.dispatchEvent("compositionend");
  await input.evaluate(el => { el.form.requestSubmit(); el.form.requestSubmit(); });
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].requirementText).toBe(request);
  await expect(input).toBeEditable();
  await input.fill("다음 요청 초안\n아직 보내지 않음");
  await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeDisabled();
  await page.reload();
  await expect(input).toHaveValue("다음 요청 초안\n아직 보내지 않음");
  expect(state.starts).toHaveLength(1);
  expect(state.blocked).toEqual([]);
});

test("send failure retains exact text and explicit retry sends once", async ({ page }) => {
  const state = await fixture(page);
  state.startFailures = 1;
  await page.goto(path);
  await page.locator("#agent-chat-input").fill(request);
  await page.locator('.agent-chat-composer button[type="submit"]').click();
  await expect(page.locator(".agent-chat .form-error")).toContainText("입력은 보존되었습니다");
  await expect(page.locator("#agent-chat-input")).toHaveValue(request);
  await page.locator('.agent-chat-composer button[type="submit"]').click();
  await expect.poll(() => state.starts.length).toBe(2);
  expect(state.starts[1].requirementText).toBe(request);
  await expect(page.locator("#agent-chat-input")).toHaveValue("");
  expect(state.blocked).toEqual([]);
});

test("clarification stays in chat, failed answer and reload retain draft, approval resumes once", async ({ page }) => {
  const state = await fixture(page);
  seedRun(state, "WAITING_FOR_USER");
  state.run.interruption = { interruptionId: "question-one", kind: "CLARIFICATION", questions: ["납기와 우선 범위를 알려 주세요."] };
  state.resumeFailures = 1;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  const form = page.locator(".agent-chat .interruption-form");
  await expect(form).toBeVisible();
  await form.locator("textarea").fill("  10월 말\n핵심 기능 먼저  ");
  await form.getByRole("button", { name: "답변하고 계속" }).click();
  await expect.poll(() => state.resumes.length).toBe(1);
  await expect(form.locator("textarea")).toHaveValue("  10월 말\n핵심 기능 먼저  ");
  await page.reload();
  await expect(form.locator("textarea")).toHaveValue("  10월 말\n핵심 기능 먼저  ");
  await form.evaluate(el => { el.requestSubmit(); el.requestSubmit(); });
  await expect.poll(() => state.resumes.length).toBe(2);
  await expect(form).toHaveCount(0);
  expect(state.resumes[1].answers[0].answer).toBe("  10월 말\n핵심 기능 먼저  ");
  expect(state.blocked).toEqual([]);
});

test("no response permission exposes read-only clarification and no approval request", async ({ page }) => {
  const state = await fixture(page);
  state.permissions = ["project.read", "agent.run"];
  seedRun(state, "WAITING_FOR_USER");
  state.run.interruption = { interruptionId: "question-one", kind: "QUOTE_APPROVAL", questions: ["견적 초안을 승인할까요?"] };
  await page.goto(path);
  await expect(page.locator(".interruption-form textarea")).not.toBeEditable();
  await expect(page.locator(".interruption-form")).toContainText("답변할 권한이 없습니다");
  await expect(page.locator(".interruption-form button[type=submit]")).toHaveCount(0);
  expect(state.resumes).toHaveLength(0);
});

test("quote settings require permission and never call apply without confirmation", async ({ page }) => {
  const state = await fixture(page);
  state.permissions = ["project.read", "agent.run", "quotation.read"];
  await page.goto(path);
  await page.locator("#agent-chat-input").fill("기본 세율 12%로 변경");
  await page.locator('.agent-chat-composer button[type="submit"]').click();
  await expect(page.locator(".agent-chat .form-error")).toContainText("권한이 없습니다");
  await expect(page.locator("#agent-chat-input")).toHaveValue("기본 세율 12%로 변경");
  expect(state.proposal).toBeNull();
  expect(state.confirms).toBe(0);
  expect(state.starts).toHaveLength(0);
});

test("new real events do not move a reader; unread action follows the newest message", async ({ page }) => {
  const state = await fixture(page);
  seedRun(state);
  state.history.unshift(...Array.from({ length: 16 }, (_, i) => ({ runId: `old-${i}`, requirementText: `지난 요청 ${i}\n${"이전에 검토한 내용을 읽고 있습니다. ".repeat(8)}`, status: "CANCELLED", createdAt: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z` })));
  await page.goto(path);
  const log = page.getByRole("log");
  await expect(page.locator(".agent-chat-turn")).toHaveCount(17);
  await log.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
  state.events = [{ eventId: 2, runId: "run-one", type: "requirement.updated", occurredAt: "2026-10-01T00:02:00Z", data: { summary: "요구사항 검토가 반영되었습니다." } }];
  await expect(page.getByRole("button", { name: "새 메시지 보기" })).toBeVisible();
  expect(await log.evaluate(el => el.scrollTop)).toBeLessThan(5);
  await page.getByRole("button", { name: "새 메시지 보기" }).click();
  await expect.poll(() => log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(70);
  await expect(page.locator(".agent-chat-activity")).toContainText("요구사항 검토가 반영되었습니다.");
});

test("failed run shows recovery wording and reconnect does not duplicate requests or events", async ({ page }) => {
  const state = await fixture(page);
  seedRun(state);
  state.streamFailures = 1;
  await page.goto(path);
  await expect(page.locator(".agent-chat-connection")).toContainText("다시 보내지 않아도");
  await expect.poll(() => state.streamRequests).toBeGreaterThan(1);
  await expect(page.locator(".agent-chat-events li")).toHaveCount(1);
  state.run.status = "FAILED";
  state.run.errorCode = "SPRING_TOOL_FORBIDDEN";
  await expect(page.locator(".agent-chat-message.assistant")).toContainText("작업 공간 권한을 확인");
  expect(state.starts).toHaveLength(0);
  await expect(page.locator(".agent-chat-connection")).toHaveCount(0);
});

test("temporary run-read failure recovers to a completed result without resending", async ({ page }) => {
  const state = await fixture(page);
  seedRun(state);
  state.pollFailures = 1;
  await page.goto(path);
  await expect(page.locator(".agent-chat-connection")).toBeVisible();
  state.run.status = "COMPLETED";
  state.run.result = completedResult;
  await expect(page.getByRole("button", { name: "결과 열기" })).toBeVisible();
  await expect(page.locator(".agent-chat-connection")).toHaveCount(0);
  expect(state.starts).toHaveLength(0);
});

for (const width of [320, 390, 1440]) {
  for (const locale of ["ko", "en"]) {
    test(`${width}px ${locale}: single approval card, reduced motion, long input and result keyboard flow`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const state = await fixture(page);
      seedRun(state, "COMPLETED");
      state.run.result = completedResult;
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(value => { localStorage.setItem("freelance-ops-ui-locale-v1", value); localStorage.setItem("theme", value === "en" ? "dark" : "light"); }, locale);
      await page.goto(path);
      await page.locator(".workspace-language-trigger").click();
      await page.getByRole("menuitemradio", { name: locale === "en" ? "EN English" : "KO 한국어" }).click();
      const open = page.getByRole("button", { name: locale === "ko" ? "결과 열기" : "Open result" });
      await open.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".agent-chat-result-panel")).toHaveAttribute("role", "dialog");
      await expect(page.locator(".agent-chat-result-panel .workspace-panel-heading button")).toBeFocused();
      await expect(page.locator(".run-result")).toContainText(completedResult.projectSummary);
      await page.keyboard.press("Escape");
      await expect(open).toBeFocused();
      await page.locator("#agent-chat-input").fill("한글과 English · 원문 ".repeat(250) + "\n새 줄");
      expect(await page.locator("#agent-chat-input").evaluate(el => el.clientHeight)).toBeLessThanOrEqual(180);
      expect(await page.locator(".agent-chat-message").first().evaluate(el => getComputedStyle(el).animationName)).toBe("none");
      await page.locator("#agent-chat-input").fill("기본 세율 12%, 위험 버퍼 15%, 최대 할인 20%로 변경");
      await page.locator('.agent-chat-composer button[type="submit"]').click();
      await expect(page.locator(".agent-chat-policy")).toHaveCount(1);
      await expect(page.locator(".agent-chat-policy")).toContainText("10% → 12%");
      await page.locator(".agent-chat-turns").evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `outputs/ui-ux/chat-after-${width}-${locale}.png`, fullPage: false });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(state.confirms).toBe(0);
      expect(state.blocked).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test("short viewport emulates keyboard space without losing composer or draft", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  const input = page.locator("#agent-chat-input");
  await input.fill("모바일 작성 중\n원문 유지");
  await page.setViewportSize({ width: 390, height: 420 });
  await input.focus();
  await expect(input).toBeInViewport();
  await expect(input).toHaveValue("모바일 작성 중\n원문 유지");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(input).toHaveValue("모바일 작성 중\n원문 유지");
});

test("polls are serialized while a prior read is pending and stop at completion", async ({ page }) => {
  const state = await fixture(page);
  seedRun(state);
  await page.clock.install();
  await page.goto(path);
  await expect(page.locator('[data-run-id="run-one"]')).toBeVisible();
  await expect(page.getByText("작업 기록을 불러오는 중입니다.", { exact: true })).toHaveCount(0);
  const barrier = requestBarrier();
  state.nextRunRead = barrier;
  try {
    await barrier.entered;
    const readsWhilePending = state.runReads.length;
    await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
    await page.clock.runFor(6000);
    expect(state.runReads).toHaveLength(readsWhilePending);

    // The held response is a RUNNING snapshot; only the following read sees completion.
    state.run = { ...state.run, status: "COMPLETED", result: completedResult };
    const heldResponse = page.waitForResponse(response => response.url().endsWith("/agent-runs/run-one") && response.request().method() === "GET");
    barrier.release();
    await (await heldResponse).finished();
    await page.evaluate(() => Promise.resolve());
    await page.clock.runFor(2100);
    await expect(page.getByRole("button", { name: "결과 열기" })).toBeVisible();
    const completedReads = state.runReads.length;
    await page.clock.runFor(6000);
    expect(state.runReads).toHaveLength(completedReads);
    expect(state.starts).toHaveLength(0);
  } finally {
    barrier.release();
  }
});

test("a delayed initial latest-null response cannot erase a newly accepted run", async ({ page }) => {
  const state = await fixture(page);
  const barrier = requestBarrier();
  state.nextLatestRead = barrier;
  try {
    await page.goto(path);
    await barrier.entered;
    await page.locator("#agent-chat-input").fill(request);
    await page.locator('.agent-chat-composer button[type="submit"]').click();
    await expect.poll(() => state.starts.length).toBe(1);
    await expect(page.locator('.agent-chat-actions .danger')).toBeVisible();
    await expect(page.locator("#agent-chat-input")).toBeEditable();
    await page.locator("#agent-chat-input").fill("The next request must remain unsent");

    const latestResponse = page.waitForResponse(response => response.url().endsWith("/agent-runs/latest"));
    barrier.release();
    await (await latestResponse).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('[data-run-id="run-one"]')).toBeVisible();
    await expect(page.locator('.agent-chat-actions .danger')).toBeVisible();
    await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeDisabled();
    await page.locator("#agent-chat-input").press("Control+Enter");
    expect(state.starts).toHaveLength(1);
    await expect(page.locator("#agent-chat-input")).toHaveValue("The next request must remain unsent");
  } finally {
    barrier.release();
  }
});

test("a delayed project-A start cannot replace project B after SPA navigation", async ({ page }) => {
  const state = await fixture(page);
  state.projects.push({ ...state.projects[0], id: "project-two", title: "Second project", requirementText: "Project B source stays separate" });
  const barrier = requestBarrier();
  state.nextStart = barrier;
  try {
    await page.goto(path);
    await page.locator("#agent-chat-input").fill(request);
    await page.locator('.agent-chat-composer button[type="submit"]').click();
    await barrier.entered;
    await page.getByRole("button", { name: "Freelance Ops · 프로젝트 현황", exact: true }).click();
    await page.locator('[data-project-id="project-two"] button').first().click();
    await page.locator(".workbench-steps").getByRole("button", { name: "AI 분석" }).click();
    await expect(page).toHaveURL(/\/projects\/project-two\/agent$/);
    await expect.poll(() => state.latestReads.includes("project-two")).toBe(true);
    await page.locator("#agent-chat-input").fill("  Project B unfinished draft\nLeave it here  ");
    const readsBeforeRelease = state.runReads.length;
    const acceptedResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/projects/project-one/agent-runs"));
    barrier.release();
    await (await acceptedResponse).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await expect(page.locator(".project-heading h1")).toHaveText("Second project");
    await expect(page.locator('[data-run-id="run-one"]')).toHaveCount(0);
    await expect(page.locator('.agent-chat-actions .danger')).toHaveCount(0);
    await expect(page.locator("#agent-chat-input")).toHaveValue("  Project B unfinished draft\nLeave it here  ");
    await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeEnabled();
    expect(state.runReads.slice(readsBeforeRelease)).not.toContain("run-one");
    expect(state.startProjects).toEqual(["project-one"]);
    expect(state.blocked).toEqual([]);
  } finally {
    barrier.release();
  }
});

test("only the current result offers quote comparison; historical results stay read-only", async ({ page }) => {
  const state = await fixture(page);
  seedRun(state, "COMPLETED");
  state.run.result = { ...completedResult, projectSummary: "Current quote result", quotationDraft: { items: [{ title: "Current quote task" }] } };
  state.pastRuns["run-older"] = { ...state.run, runId: "run-older", result: { ...completedResult, projectSummary: "Historical quote result", quotationDraft: { items: [{ title: "Historical quote task" }] } } };
  state.history.unshift({ runId: "run-older", requirementText: "Earlier request", status: "COMPLETED", createdAt: "2026-09-30T00:00:00Z" });
  await page.goto(path);
  await page.locator('[data-run-id="run-older"]').getByRole("button", { name: "결과 열기" }).click();
  const panel = page.locator(".agent-chat-result-panel");
  await expect(panel).toContainText("Historical quote result");
  await expect(panel.getByRole("button", { name: "견적 비교하기" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator('[data-run-id="run-one"]').getByRole("button", { name: "결과 열기" }).click();
  await expect(panel).toContainText("Current quote result");
  await expect(panel.getByRole("button", { name: "견적 비교하기" })).toBeVisible();
  expect(state.writes).toEqual([]);
});

for (const locale of ["ko", "en"]) {
  test(`${locale}: proposal creation and confirmation announce accessible status`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto(path);
    await page.locator(".workspace-language-trigger").click();
    await page.getByRole("menuitemradio", { name: locale === "en" ? "EN English" : "KO 한국어" }).click();
    await page.locator("#agent-chat-input").fill("기본 세율 12%로 변경");
    await page.locator('.agent-chat-composer button[type="submit"]').click();
    const announcement = page.locator('.agent-chat > .sr-only[role="status"]');
    await expect(announcement).toHaveText(locale === "ko" ? "견적 기본 설정 변경안" : "Quote default settings proposal");
    expect(state.confirms).toBe(0);
    await page.locator(".agent-chat-policy button").click();
    await expect(announcement).toHaveText(locale === "ko" ? "견적 기본 설정이 변경되었습니다." : "Quote default settings updated.");
    expect(state.confirms).toBe(1);
    expect(state.starts).toHaveLength(0);
  });
}

test("repeated cancellation submits once while its response is pending", async ({ page }) => {
  const state = await fixture(page);
  seedRun(state);
  const barrier = requestBarrier();
  state.nextCancel = barrier;
  try {
    await page.goto(path);
    const cancel = page.locator(".agent-chat-actions .danger");
    await expect(cancel).toBeVisible();
    await cancel.evaluate(button => { button.click(); button.click(); });
    await barrier.entered;
    await expect(cancel).toBeDisabled();
    expect(state.cancels).toEqual(["run-one"]);
    barrier.release();
    await expect(page.locator('[data-run-id="run-one"] .assistant')).toContainText("사용자 중단");
    await expect(cancel).toHaveCount(0);
    expect(state.cancels).toEqual(["run-one"]);
    expect(state.starts).toHaveLength(0);
  } finally {
    barrier.release();
  }
});

test("AI settings retain provider, model, personal connection and pet customization controls", async ({ page }) => {
  const state = await fixture(page);
  state.connections = [{ id: "fixture-connection", provider: "OPENAI", model: "personal-fixture-model", maskedKey: "fixture-...masked", updatedAt: "2026-10-01T00:00:00Z" }];
  await page.goto(path);
  const settings = page.locator(".agent-chat-settings");
  await page.getByRole("button", { name: "AI 설정 열기" }).click();
  await expect(settings).toBeVisible();
  await expect(settings.getByLabel("AI 제공사", { exact: true })).toBeVisible();
  await expect(settings.getByLabel("AI 모델", { exact: true })).toBeVisible();
  const connection = settings.getByLabel("AI 연결", { exact: true });
  await expect(connection).toBeVisible();
  await expect(connection.locator('option[value="fixture-connection"]')).toHaveCount(1);
  await connection.selectOption("fixture-connection");
  await expect(settings.locator(".model-selection-note").filter({ hasText: "내 키로 실행" })).toBeVisible();
  await expect(settings.getByLabel("AI 제공사", { exact: true })).toHaveCount(0);
  const customizer = settings.locator(".pet-customizer");
  await expect(customizer).toBeVisible();
  await expect(customizer.getByRole("button", { name: "펫 미리보기" })).toBeVisible();
  await expect(customizer.getByLabel("어떤 펫을 만들까요?")).toBeVisible();
  await expect(customizer).toContainText("비활성");
  await connection.selectOption("");
  await expect(settings.getByLabel("AI 제공사", { exact: true })).toBeVisible();
  await expect(settings.getByLabel("AI 모델", { exact: true })).toBeVisible();
  expect(state.starts).toHaveLength(0);
  expect(state.writes).toEqual([]);
  expect(state.blocked).toEqual([]);
});
