import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

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
  await form.locator("textarea").fill("10월 말\n핵심 기능 먼저");
  await form.getByRole("button", { name: "답변하고 계속" }).click();
  await expect.poll(() => state.resumes.length).toBe(1);
  await expect(form.locator("textarea")).toHaveValue("10월 말\n핵심 기능 먼저");
  await page.reload();
  await expect(form.locator("textarea")).toHaveValue("10월 말\n핵심 기능 먼저");
  await form.evaluate(el => { el.requestSubmit(); el.requestSubmit(); });
  await expect.poll(() => state.resumes.length).toBe(2);
  await expect(form).toHaveCount(0);
  expect(state.resumes[1].answers[0].answer).toBe("10월 말\n핵심 기능 먼저");
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
  await expect(page.getByRole("alert").filter({ hasText: "Fixture poll failure" })).toBeVisible();
  state.run.status = "COMPLETED";
  state.run.result = completedResult;
  await expect(page.getByRole("button", { name: "결과 열기" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Fixture poll failure" })).toHaveCount(0);
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
      await page.locator(".ui-language-selector select").selectOption(locale);
      const open = page.getByRole("button", { name: locale === "ko" ? "결과 열기" : "Open result" });
      await open.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".agent-chat-result-panel")).toHaveAttribute("open", "");
      await expect(page.locator(".agent-chat-result-panel summary")).toBeFocused();
      await expect(page.locator(".run-result")).toContainText(completedResult.projectSummary);
      await page.locator(".agent-chat-result-panel summary").click();
      await page.locator("#agent-chat-input").fill("한글과 English · 원문 ".repeat(250) + "\n새 줄");
      expect(await page.locator("#agent-chat-input").evaluate(el => el.clientHeight)).toBeLessThanOrEqual(180);
      expect(await page.locator(".agent-chat-message").first().evaluate(el => getComputedStyle(el).animationName)).toBe("none");
      await page.locator("#agent-chat-input").fill("기본 세율 12%, 위험 버퍼 15%, 최대 할인 20%로 변경");
      await page.locator('.agent-chat-composer button[type="submit"]').click();
      await expect(page.locator(".agent-chat-policy")).toHaveCount(1);
      await expect(page.locator(".agent-chat-policy")).toContainText("10% → 12%");
      await page.locator(".agent-chat-turns").evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `outputs/ui-ux/chat-after-${width}-${locale}.png`, fullPage: true });
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
  await input.scrollIntoViewIfNeeded();
  await expect(input).toBeInViewport();
  await expect(input).toHaveValue("모바일 작성 중\n원문 유지");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(input).toHaveValue("모바일 작성 중\n원문 유지");
});
