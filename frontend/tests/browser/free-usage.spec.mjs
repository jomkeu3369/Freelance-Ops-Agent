import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const draft = "  무료 한도에 도달해도 보존할 고객 원문\n분석은 직접 시작합니다  ";
const initialUsage = { limit: 100, used: 80, reserved: 10, remaining: 10, resetAt: "2026-10-11T15:00:00Z", period: "2026-10-05", timezone: "Asia/Seoul", epoch: 1, canManage: false };

async function quotaFixture(page, options = {}) {
  const state = await fixture(page);
  state.quotaAttempts = [];
  state.usage = {...state.usage, ...initialUsage, ...options.usage};
  state.admin = {unit: "CREDITS", periodType: "WEEKLY", modelRates: structuredClone(state.usage.modelRates), limit: 100, maxLimit: 100000, epoch: 1, updatedAt: "2026-10-03T00:00:00.123456Z", lastResetAt: null};
  state.adminWrites = [];
  state.adminStatus = options.adminStatus ?? 403;
  state.startStatus = options.startStatus ?? 429;
  state.startCode = options.startCode ?? "FREE_USAGE_EXHAUSTED";
  state.adminMutationStatus = 200;
  await page.route("**/api/v2/usage/free", route => route.fulfill({json: state.usage}));
  await page.route("**/api/v2/admin/free-usage**", async route => {
    if (route.request().method() === "GET") return route.fulfill({status: state.adminStatus, json: state.adminStatus === 200 ? state.admin : {message: "Forbidden"}});
    state.adminWrites.push({method: route.request().method(), body: route.request().postDataJSON()});
    if (state.adminBarrier) await state.adminBarrier.wait();
    if (state.adminMutationStatus !== 200) return route.fulfill({status: state.adminMutationStatus, json: {message: "Changed or denied"}});
    if (route.request().method() === "PATCH" && new URL(route.request().url()).pathname.endsWith("/models")) {
      const body = state.adminWrites.at(-1).body;
      state.admin.modelRates = state.admin.modelRates.map(rate => rate.provider === body.provider && rate.model === body.model ? { provider: body.provider, model: body.model, credits: body.credits, enabled: body.enabled } : rate);
    } else if (route.request().method() === "PATCH") state.admin.limit = state.adminWrites.at(-1).body.limit;
    else { state.admin.epoch++; state.admin.lastResetAt = "2026-10-03T01:00:00Z"; }
    state.admin.updatedAt = "2026-10-03T01:00:00Z";
    return route.fulfill({json: state.admin});
  });
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

test("direct /admin is forbidden for ordinary and workspace-admin users without server capability", async ({page}) => {
  const state = await quotaFixture(page);
  state.permissions.push("workspace.admin");
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("접근 권한이 없습니다");
  await expect(page.locator("#admin-free-limit")).toHaveCount(0);
  expect(state.adminWrites).toHaveLength(0);
  await page.goto("/workspace/settings");
  await expect(page.getByRole("region", {name: "주간 크레딧"})).toBeVisible();
  await expect(page.getByRole("link", {name: "사이트 관리자"})).toHaveCount(0);
});

test("admin validates limits including zero and requires cost acknowledgment before a single mutation", async ({page}) => {
  const state = await quotaFixture(page, {adminStatus: 200});
  await page.goto("/admin");
  const input = page.locator("#admin-free-limit");
  await expect(input).toHaveValue("100");
  for (const value of ["-1", "100001", "1.5", ""]) {
    await input.fill(value);
    await page.getByRole("button", {name: "한도 변경 검토"}).click();
    await expect(page.getByRole("alert")).toContainText("정수");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(state.adminWrites).toHaveLength(0);
  await input.fill("0");
  await page.getByRole("button", {name: "한도 변경 검토"}).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("100 → 0");
  await expect(dialog.getByRole("button", {name: "한도 변경 승인"})).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  expect(state.adminWrites).toHaveLength(0);
  await page.getByRole("button", {name: "한도 변경 검토"}).click();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("checkbox").check();
  state.adminBarrier = requestBarrier();
  await dialog.getByRole("button", {name: "한도 변경 승인"}).click();
  await state.adminBarrier.entered;
  await expect(dialog.getByRole("button", {name: "처리 중…"})).toBeDisabled();
  expect(state.adminWrites).toEqual([{method: "PATCH", body: {limit: 0, expectedEpoch: 1, expectedUpdatedAt: "2026-10-03T00:00:00.123456Z"}}]);
  state.adminBarrier.release();
  await expect(dialog).toHaveCount(0);
  await expect(input).toHaveValue("0");
});

test("global reset warns about active reservations and sends explicit confirmation with both preconditions", async ({page}) => {
  const state = await quotaFixture(page, {adminStatus: 200});
  await page.goto("/admin");
  await page.getByRole("button", {name: "전체 초기화 검토"}).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("새 할당량에서 다시 차감하지 않아 추가 비용");
  await expect(dialog.getByRole("button", {name: "전체 초기화 승인"})).toBeDisabled();
  await dialog.getByRole("button", {name: "취소"}).click();
  expect(state.adminWrites).toHaveLength(0);
  await page.getByRole("button", {name: "전체 초기화 검토"}).click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", {name: "전체 초기화 승인"}).click();
  await expect(dialog).toHaveCount(0);
  expect(state.adminWrites).toEqual([{method: "POST", body: {confirmation: "RESET_ALL_FREE_USAGE", expectedEpoch: 1, expectedUpdatedAt: "2026-10-03T00:00:00.123456Z"}}]);
  await expect(page.getByRole("status")).toContainText("초기화했습니다");
});

test("stale admin settings require new review and revoked access hides all controls", async ({page}) => {
  const state = await quotaFixture(page, {adminStatus: 200});
  await page.goto("/admin");
  await page.locator("#admin-free-limit").fill("8");
  await page.getByRole("button", {name: "한도 변경 검토"}).click();
  state.admin.limit = 10;
  state.adminMutationStatus = 409;
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", {name: "한도 변경 승인"}).click();
  await expect(page.locator("#admin-free-limit")).toHaveValue("10");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.adminWrites).toHaveLength(1);
  await page.getByRole("button", {name: "전체 초기화 검토"}).click();
  state.adminMutationStatus = 403;
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", {name: "전체 초기화 승인"}).click();
  await expect(page.getByRole("alert")).toContainText("접근 권한이 없습니다");
  await expect(page.locator("#admin-free-limit")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
