import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
function seedConversation(state, count = 18) {
  state.projects[0].title = "Studio launch · Website estimate";
  state.history = Array.from({ length: count }, (_, index) => {
    const runId = `history-${index}`;
    state.pastRuns[runId] = {
      runId, status: "COMPLETED", result: { projectSummary: `Review ${index + 1}: A synthetic project summary for layout testing.\nScope, effort, and open questions stay available for your review.`, openQuestions: [], departmentResults: [], quotationDraft: null, quotationDrafts: [] },
      interruption: null, errorCode: null, metadata: null, updatedAt: `2026-10-01T00:${String(index).padStart(2, "0")}:00Z`,
    };
    return { runId, requirementText: `Please review the website requirements, round ${index + 1}.`, status: "COMPLETED", createdAt: state.pastRuns[runId].updatedAt };
  });
}
async function expectViewportLayout(page) {
  for (const selector of [".workspace-topbar", "#agent-chat-input", '.agent-chat-composer button[type="submit"]']) {
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    const size = page.viewportSize();
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
}

for (const [width, height] of [[320, 568], [390, 844], [640, 800], [1280, 800], [1440, 900], [844, 390]]) {
  test(`${width}×${height}: page fills viewport, only the conversation scrolls`, async ({ page }) => {
    const state = await fixture(page);
    seedConversation(state);
    await page.setViewportSize({ width, height });
    await page.goto(path);
    await expect(page.locator('[data-run-id="history-17"]')).toBeVisible();
    await page.locator("#agent-chat-input").fill("Unsent draft\nExact original wording");
    await expectViewportLayout(page);
    const before = await page.locator(".agent-chat-composer").boundingBox();
    const log = page.getByRole("log");
    await log.evaluate(element => { element.scrollTop = 0; });
    await expect(page.locator('[data-run-id="history-0"]')).toBeInViewport();
    const after = await page.locator(".agent-chat-composer").boundingBox();
    expect(after.y).toBeCloseTo(before.y, 1);
    expect(await log.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.screenshot({ path: `outputs/ui-ux/fullscreen-${width}-${height}.png`, fullPage: false });
    expect(state.starts).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.blocked).toEqual([]);
  });
}

test("shrinking viewport keeps a long draft, offline notice and send controls in view", async ({ page, context }) => {
  const state = await fixture(page);
  state.projects[0].title = "LongUnbrokenProjectName".repeat(30);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  const draft = "작성 중인 원문 English\n".repeat(30);
  await page.locator("#agent-chat-input").fill(draft);
  await context.setOffline(true);
  await expect(page.locator(".agent-chat-state")).toHaveText("오프라인");
  for (const [width, height] of [[390, 420], [844, 390], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expectViewportLayout(page);
    await expect(page.locator("#agent-chat-input")).toHaveValue(draft);
  }
  await context.setOffline(false);
  expect(state.starts).toEqual([]);
});

test("results, settings and usage open only on demand and return focus without changing the draft", async ({ page }) => {
  const state = await fixture(page);
  seedConversation(state, 1);
  await page.goto(path);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const input = page.locator("#agent-chat-input");
  await input.fill("Keep this draft while reviewing");
  for (const name of ["결과 열기", "AI 설정 열기"]) {
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", { name: "닫기", exact: true });
    await expect(close).toBeFocused();
    await close.press("Shift+Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(input).toHaveValue("Keep this draft while reviewing");
  }
  expect(state.writes).toEqual([]);
});

test("mobile project drawer traps focus, dismisses and preserves route-specific drafts through history", async ({ page }) => {
  const state = await fixture(page);
  state.projects.push({ ...state.projects[0], id: "project-two", title: "Second project" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await page.locator("#agent-chat-input").fill("Project one draft");
  const toggle = page.getByRole("button", { name: "메뉴 펼치기", exact: true });
  await toggle.click();
  const drawer = page.getByRole("dialog", { name: "작업 공간 탐색" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await drawer.getByRole("button", { name: /Second project/ }).click();
  await expect(page).toHaveURL(/project-two\/agent$/);
  await expect(drawer).toHaveCount(0);
  await expect(page.locator("#agent-chat-input")).toHaveValue("");
  await page.locator("#agent-chat-input").fill("Project two draft");
  await page.goBack();
  await expect(page.locator("#agent-chat-input")).toHaveValue("Project one draft");
  await page.goForward();
  await expect(page.locator("#agent-chat-input")).toHaveValue("Project two draft");
  await expectViewportLayout(page);
  expect(state.writes).toEqual([]);
});

for (const locale of ["ko", "en"]) for (const theme of ["light", "dark"]) {
  test(`${locale}/${theme}: empty fullscreen conversation is localized and motion-safe`, async ({ page }) => {
    await fixture(page);
    await page.addInitScript(({ locale, theme }) => { localStorage.setItem("freelance-ops-ui-locale-v1", locale); localStorage.setItem("theme", theme); }, { locale, theme });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await expect(page.locator(".agent-chat-empty strong")).toHaveText(locale === "en" ? "How can I help?" : "무엇을 도와드릴까요?");
    await expectViewportLayout(page);
    await page.screenshot({ path: `outputs/ui-ux/fullscreen-empty-${locale}-${theme}.png`, fullPage: false });
  });
}


test("late accepted send cannot erase a newer draft after returning to the same project", async ({ page }) => {
  const state = await fixture(page);
  state.projects.push({ ...state.projects[0], id: "project-two", title: "Second project" });
  const barrier = requestBarrier();
  state.nextStart = barrier;
  try {
    await page.goto(path);
    const input = page.locator("#agent-chat-input");
    await input.fill("First request held at server");
    await page.locator('.agent-chat-composer button[type="submit"]').click();
    await barrier.entered;
    const recent = page.getByRole("navigation", { name: "최근 프로젝트 대화" });
    await recent.getByRole("button", { name: /Second project/ }).click();
    await expect(page).toHaveURL(/project-two\/agent$/);
    await recent.getByRole("button", { name: /Original project title/ }).click();
    await expect(page).toHaveURL(/project-one\/agent$/);
    await input.fill("A newer unsent draft after returning");
    barrier.release();
    await expect.poll(() => state.starts.length).toBe(1);
    await page.reload();
    await expect(input).toHaveValue("A newer unsent draft after returning");
  } finally { barrier.release(); }
});

test("an async quota notice owns focus above an open usage panel", async ({ page }) => {
  await fixture(page);
  const barrier = requestBarrier();
  await page.route("**/agent-runs", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await barrier.wait();
    return route.fulfill({ status: 429, json: { code: "FREE_USAGE_EXHAUSTED", unit: "CREDITS", requiredCredits: 10, message: "Synthetic quota boundary", limit: 5, used: 5, reserved: 0, remaining: 0, resetAt: "2026-10-31T15:00:00Z", period: "2026-10", timezone: "Asia/Seoul", epoch: 1 } });
  });
  try {
    await page.goto(path);
    await page.locator("#agent-chat-input").fill("Preserve this request");
    await page.locator('.agent-chat-composer button[type="submit"]').click();
    await barrier.entered;
    await page.locator(".chat-credit-trigger").click();
    await page.getByRole("button", { name: "사용 내역", exact: true }).click();
    const usage = page.getByRole("dialog", { name: "사용 내역", exact: true });
    await expect(usage).toBeVisible();
    barrier.release();
    const quota = page.getByRole("dialog", { name: "기본 AI 크레딧이 부족합니다" });
    await expect(quota).toBeVisible();
    await expect(quota.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(quota.getByRole("button", { name: "API 등록하기" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(quota).toHaveCount(0);
    await expect(usage).toBeVisible();
    await expect(usage.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(usage).toHaveCount(0);
    await expect(page.locator("#agent-chat-input")).toHaveValue("Preserve this request");
  } finally { barrier.release(); }
});
