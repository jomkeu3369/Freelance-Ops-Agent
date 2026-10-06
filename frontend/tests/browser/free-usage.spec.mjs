import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const draft = "  무료 한도에 도달해도 보존할 고객 원문\n분석은 직접 시작합니다  ";
const initialUsage = { limit: 100, used: 80, reserved: 10, remaining: 10, resetAt: "2026-10-11T15:00:00Z", period: "2026-10-05", timezone: "Asia/Seoul", epoch: 1, canManage: false };

async function quotaFixture(page, options = {}) {
  const state = await fixture(page);
  state.quotaAttempts = [];
  state.usage = {...state.usage, ...initialUsage, ...options.usage};
  state.startStatus = options.startStatus ?? 429;
  state.startCode = options.startCode ?? "FREE_USAGE_EXHAUSTED";
  await page.route("**/api/v2/usage/free", route => route.fulfill({json: state.usage}));
  await page.route("**/agent-runs", route => {
    if (route.request().method() !== "POST") return route.fallback();
    state.quotaAttempts.push({key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON()});
    if (state.startCode === "FREE_USAGE_EXHAUSTED") { state.usage.used = 90; state.usage.reserved = 10; state.usage.remaining = 0; }
    return route.fulfill({status: state.startStatus, json: {...state.usage, requiredCredits: 10, remaining: 0, code: state.startCode, message: "Fixture request unavailable"}});
  });
  return state;
}

async function exhaust(page) {
  await page.goto(path);
  await page.locator("#agent-chat-input").fill(draft);
  await page.locator('.agent-chat-composer button[type="submit"]').click();
}

test("quota dialog is typed, keyboard-contained, dismissible and preserves exact draft", async ({page}) => {
  const state = await quotaFixture(page);
  await page.setViewportSize({width: 390, height: 844});
  await exhaust(page);
  const dialog = page.getByRole("dialog", {name: "기본 AI 크레딧이 부족합니다"});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("예약 10 크레딧");
  expect(await page.locator("main").first().evaluate(element => element.inert)).toBe(true);
  await expect(dialog.getByRole("button", {name: "닫기", exact: true})).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", {name: "API 등록하기"})).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", {name: "닫기", exact: true})).toBeFocused();
  await page.screenshot({path: "outputs/ui-ux/quota-dialog-ko-mobile.png"});
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.locator("main").first().evaluate(element => element.inert)).toBe(false);
  await expect(page.locator("#agent-chat-input")).toBeFocused();
  await expect(page.locator("#agent-chat-input")).toHaveValue(draft);
  expect(state.quotaAttempts).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("register CTA preserves project context; registering a key never starts or resubmits analysis", async ({page}) => {
  const state = await quotaFixture(page);
  let registrations = 0;
  await page.route("**/ai-connections/OPENAI", route => {
    registrations++;
    const connection = {id: "personal-one", provider: "OPENAI", model: "fixture-model", maskedKey: "test…fixture", updatedAt: "2026-10-03T00:00:00Z"};
    state.connections = [connection];
    return route.fulfill({json: connection});
  });
  await exhaust(page);
  await page.getByRole("dialog").getByRole("button", {name: "API 등록하기"}).click();
  await expect(page).toHaveURL(/\/workspace\/settings\?returnTo=.*#ai-connections$/);
  await expect(page.locator("#ai-connections")).toBeVisible();
  await page.locator('#ai-connections input[type="password"]').fill("fixture-key-never-real");
  await page.locator(".ai-connection-form button").click();
  await expect.poll(() => registrations).toBe(1);
  await expect(page.locator("#ai-connections [role=status]")).toContainText("연결을 선택");
  expect(state.quotaAttempts).toHaveLength(1);
  await page.getByRole("link", {name: "작성하던 분석으로 돌아가기"}).click();
  await expect(page).toHaveURL(path);
  await expect(page.locator("#agent-chat-input")).toHaveValue(draft);
  expect(state.quotaAttempts).toHaveLength(1);
  await page.goBack();
  await expect(page.getByRole("link", {name: "작성하던 분석으로 돌아가기"})).toBeVisible();
  expect(state.quotaAttempts).toHaveLength(1);
});

test("English quota dialog and usage counter localize; generic 429 does not open upgrade dialog", async ({page}) => {
  const state = await quotaFixture(page, {startCode: "RATE_LIMITED"});
  await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "en"));
  await exhaust(page);
  await expect(page.locator(".agent-chat .form-error")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", {name: "Weekly credits", exact: true}).click();
  await expect(page.getByRole("dialog", {name: "Weekly credits", exact: true})).toContainText("10 / 100 credits remaining this week");
  await page.keyboard.press("Escape");
  state.startCode = "FREE_USAGE_EXHAUSTED";
  await page.locator('.agent-chat-composer button[type="submit"]').click();
  await expect(page.getByRole("dialog", {name: "Not enough included AI credits"})).toBeVisible();
  await page.screenshot({path: "outputs/ui-ux/quota-dialog-en-desktop.png"});
});

test("ambiguous start retries reuse idempotency key while changing a draft starts a new submission", async ({page}) => {
  const state = await quotaFixture(page, {startStatus: 503, startCode: "TEMPORARY"});
  await exhaust(page);
  await expect(page.locator(".agent-chat .form-error")).toBeVisible();
  await page.locator('.agent-chat-composer button[type="submit"]').click();
  await expect.poll(() => state.quotaAttempts.length).toBe(2);
  expect(state.quotaAttempts[1].key).toBe(state.quotaAttempts[0].key);
  await page.locator("#agent-chat-input").fill("A genuinely new submission");
  await page.locator('.agent-chat-composer button[type="submit"]').click();
  await expect.poll(() => state.quotaAttempts.length).toBe(3);
  expect(state.quotaAttempts[2].key).not.toBe(state.quotaAttempts[0].key);
});
