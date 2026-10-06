import { test, expect } from "@playwright/test";
import { requestBarrier } from "./helpers/chat-fixture.mjs";

const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const endpoint = "/api/v2/admin/ai-spending";
const session = {
  userId: "synthetic-cost-admin", workspaceId: "synthetic-cost-space", accessToken: "synthetic-admin-token",
  refreshToken: "synthetic-admin-refresh", accessTokenExpiresAt: "2099-01-01T00:00:00Z",
  refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer",
};
const labels = {
  ko: { heading: "기본 AI 비용 관리", budget: "예산 변경 검토", model: "모델 설정 변경 검토", cap: "실행당 최대 비용 (USD)", approve: "변경 승인", cancel: "취소", reload: "다시 확인" },
  en: { heading: "Included AI spending controls", budget: "Review budget changes", model: "Review model changes", cap: "Maximum cost per run (USD)", approve: "Approve changes", cancel: "Cancel", reload: "Check again" },
};
const states = new WeakMap();
const accountInput = page => page.locator("#admin-account-week-usd");
const dayInput = page => page.locator("#admin-global-day-usd");
const weekInput = page => page.locator("#admin-global-week-usd");
const modelRow = (page, model = "gpt-6-luna") => page.locator(".admin-model-rate").filter({ hasText: model });
const reviewBudget = (page, locale = "ko") => page.getByRole("button", { name: labels[locale].budget, exact: true });
const reload = (page, locale = "ko") => page.getByRole("button", { name: labels[locale].reload, exact: true, includeHidden: true });
const dialog = page => page.getByRole("dialog");

function settings(overrides = {}) {
  return {
    currency: "USD", accountWeekUsd: "1.25000001", globalDayUsd: "20.12345678", globalWeekUsd: "100.00000001",
    revision: 7, updatedAt: "2026-10-05T12:00:00.123456Z", spendingEnabled: true,
    models: [
      { provider: "OPENAI", model: "gpt-6-luna", maxRunUsd: "0.25000001", enabled: true },
      { provider: "OPENAI", model: "gpt-6-sol", maxRunUsd: "0.50000001", enabled: true },
    ],
    ...overrides,
  };
}

// Every API response is synthetic. Unknown API routes and off-origin network calls fail closed.
async function fixture(page, options = {}) {
  const state = {
    settings: settings(options.settings), readStatus: options.readStatus ?? 200, mutationStatus: 200,
    mutationStatuses: [], reads: [], writes: [], applied: [], refreshes: [], unexpected: [], blocked: [],
    nextRead: null, nextMutation: null, nextReadBody: undefined, refreshedSession: { ...session, accessToken: "synthetic-rotated-token" },
  };
  states.set(page, state);
  await page.addInitScript(({ currentSession, locale }) => {
    sessionStorage.setItem("freelance-ops-session-v1", JSON.stringify(currentSession));
    localStorage.setItem("freelance-ops-ui-locale-v1", locale);
  }, { currentSession: session, locale: options.locale ?? "ko" });
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    state.blocked.push(route.request().url());
    return route.abort();
  });
  await page.route("**/api/v2/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    // Navigation and deliberate session-loss tests may close a route before its barrier releases.
    const reply = (body, status = 200) => route.fulfill({ status, json: body }).catch(() => {});
    if (path === "/api/v2/auth/refresh" && method === "POST") {
      state.refreshes.push(request.postDataJSON());
      return reply(state.refreshedSession);
    }
    if (path !== endpoint && path !== `${endpoint}/models`) {
      state.unexpected.push({ path, method });
      return reply({ message: "Unexpected synthetic API request" }, 404);
    }
    if (path === endpoint && method === "GET") {
      const status = state.readStatus;
      const body = structuredClone(state.nextReadBody ?? state.settings);
      state.nextReadBody = undefined;
      const barrier = state.nextRead;
      state.nextRead = null;
      state.reads.push({ authorization: request.headers().authorization, body });
      if (barrier) await barrier.wait();
      return reply(status === 200 ? body : { message: "Synthetic access denied" }, status);
    }
    const body = request.postDataJSON();
    const write = { path, method, body, authorization: request.headers().authorization };
    state.writes.push(write);
    const status = state.mutationStatuses.shift() ?? state.mutationStatus;
    const barrier = state.nextMutation;
    state.nextMutation = null;
    if (barrier) await barrier.wait();
    if (method !== "PATCH") return reply({ message: "Only reviewed PATCH is supported" }, 405);
    if (status !== 200) return reply({ message: "Synthetic mutation was denied or its result is unknown" }, status);
    if (body.expectedRevision !== state.settings.revision) return reply({ code: "STALE_AI_SPENDING_SETTINGS" }, 409);
    if (path === `${endpoint}/models`) {
      state.settings.models = state.settings.models.map(model => model.provider === body.provider && model.model === body.model
        ? { provider: body.provider, model: body.model, maxRunUsd: body.maxRunUsd, enabled: body.enabled } : model);
    } else {
      for (const field of ["accountWeekUsd", "globalDayUsd", "globalWeekUsd"]) state.settings[field] = body[field];
    }
    state.settings.revision++;
    state.settings.updatedAt = "2026-10-05T12:01:00.000001Z";
    state.applied.push(write);
    return reply(state.settings);
  });
  return state;
}

async function open(page, options = {}) {
  const state = await fixture(page, options);
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  if (state.readStatus === 200) await expect(accountInput(page)).toHaveValue(state.settings.accountWeekUsd);
  return state;
}

async function prepareBudget(page, values = { accountWeekUsd: "2.12345678" }, locale = "ko") {
  if (values.accountWeekUsd !== undefined) await accountInput(page).fill(values.accountWeekUsd);
  if (values.globalDayUsd !== undefined) await dayInput(page).fill(values.globalDayUsd);
  if (values.globalWeekUsd !== undefined) await weekInput(page).fill(values.globalWeekUsd);
  await reviewBudget(page, locale).click();
  await expect(dialog(page)).toBeVisible();
}

async function approve(page, locale = "ko") {
  await dialog(page).getByRole("checkbox").check();
  await dialog(page).getByRole("button", { name: labels[locale].approve, exact: true }).click();
}

async function releaseReply(page, barrier, method = "GET") {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === endpoint && value.request().method() === method);
  barrier.release();
  await (await response).finished();
}

async function recover(page, nextSession) {
  await page.evaluate(value => {
    if (value) sessionStorage.setItem("freelance-ops-session-v1", JSON.stringify(value));
    else sessionStorage.removeItem("freelance-ops-session-v1");
    window.dispatchEvent(new CustomEvent("freelance-ops-session-recovery", { detail: value }));
  }, nextSession);
}

test.afterEach(async ({ page }) => {
  const state = states.get(page);
  if (!state) return;
  expect(state.unexpected, "No legacy admin, provider, or workspace API may be called").toEqual([]);
  expect(state.blocked, "No real account or provider may be contacted").toEqual([]);
  expect(state.writes.every(write => write.method === "PATCH"), "No reset POST or unreviewed write exists").toBe(true);
});

for (const [locale, width, height] of [["ko", 1440, 1000], ["en", 390, 844]]) {
  test(`${locale} cost controls preserve sub-cent USD and fit the ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const state = await open(page, { locale });
    await expect(page.getByRole("heading", { name: labels[locale].heading, exact: true })).toBeVisible();
    await expect(dayInput(page)).toHaveValue("20.12345678");
    await expect(weekInput(page)).toHaveValue("100.00000001");
    await expect(modelRow(page).getByLabel(labels[locale].cap, { exact: true })).toHaveValue("0.25000001");
    await expect(reviewBudget(page, locale)).toBeDisabled();
    await expect(page.getByRole("button", { name: /전체 초기화|reset/i })).toHaveCount(0);
    await expect(page.locator("#admin-free-limit")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await prepareBudget(page, { accountWeekUsd: "0.00000001" }, locale);
    await expect(dialog(page)).toContainText("0.00000001");
    await expect(dialog(page).getByRole("button", { name: labels[locale].approve, exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `outputs/ui-ux/admin-costs-${locale}-${width}.png`, fullPage: true });
    await dialog(page).getByRole("button", { name: labels[locale].cancel, exact: true }).click();
    expect(state.writes).toEqual([]);
  });
}

test("budget input rejects malformed, out-of-range and overprecision USD before review", async ({ page }) => {
  const state = await open(page);
  for (const input of [accountInput(page), dayInput(page), weekInput(page)]) {
    const original = await input.inputValue();
    for (const invalid of ["", "-1", "100000.00000001", "0.123456789", "1e2", "NaN", "1,25"]) {
      await input.fill(invalid);
      await reviewBudget(page).click();
      await expect(page.locator("main [role=alert]")).toBeVisible();
      await expect(dialog(page)).toHaveCount(0);
    }
    await input.fill(original);
  }
  expect(state.writes).toEqual([]);
  await prepareBudget(page, { accountWeekUsd: "100000", globalDayUsd: "100000", globalWeekUsd: "100000" });
  await expect(dialog(page)).toContainText("100000");
  await approve(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes[0].body).toEqual({ accountWeekUsd: "100000", globalDayUsd: "100000", globalWeekUsd: "100000", expectedRevision: 7 });
});

test("review cancellation, Escape and missing acknowledgement never mutate or retain approval", async ({ page }) => {
  const state = await open(page);
  await prepareBudget(page);
  const confirm = dialog(page).getByRole("button", { name: "변경 승인", exact: true });
  await expect(confirm).toBeDisabled();
  await expect(dialog(page).getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await dialog(page).getByRole("checkbox").check();
  await dialog(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(reviewBudget(page)).toBeFocused();
  await reviewBudget(page).click();
  await expect(dialog(page).getByRole("checkbox")).not.toBeChecked();
  await expect(confirm).toBeDisabled();
  await dialog(page).getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await reviewBudget(page).click();
  await expect(dialog(page).getByRole("checkbox")).not.toBeChecked();
  expect(state.writes).toEqual([]);
});

test("double approval sends one exact decimal PATCH and blocks refresh while in flight", async ({ page }) => {
  const state = await open(page);
  await prepareBudget(page, { accountWeekUsd: "0.00000001", globalDayUsd: "99.12345678", globalWeekUsd: "99999.99999999" });
  await dialog(page).getByRole("checkbox").check();
  const barrier = requestBarrier();
  state.nextMutation = barrier;
  // Two same-turn clicks exercise the synchronous request lock before React can disable the button.
  await dialog(page).getByRole("button", { name: "변경 승인", exact: true }).evaluate(button => { button.click(); button.click(); });
  await barrier.entered;
  await expect(dialog(page)).toHaveAttribute("aria-busy", "true");
  await expect(dialog(page).getByRole("button", { name: "처리 중…", exact: true })).toBeDisabled();
  await expect(reload(page)).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  expect(state.writes.map(({ path, method, body }) => ({ path, method, body }))).toEqual([{
    path: endpoint, method: "PATCH", body: { accountWeekUsd: "0.00000001", globalDayUsd: "99.12345678", globalWeekUsd: "99999.99999999", expectedRevision: 7 },
  }]);
  barrier.release();
  await expect(dialog(page)).toHaveCount(0);
  await expect(accountInput(page)).toHaveValue("0.00000001");
  await expect(dayInput(page)).toHaveValue("99.12345678");
  await expect(weekInput(page)).toHaveValue("99999.99999999");
  expect(state.applied).toHaveLength(1);
});

for (const field of ["accountWeekUsd", "globalDayUsd", "globalWeekUsd"]) {
  test(`zero ${field} is reviewed as a pause and retains the other budget settings`, async ({ page }) => {
    const state = await open(page);
    const before = structuredClone(state.settings);
    await prepareBudget(page, { [field]: "0" });
    await expect(dialog(page)).toContainText(/일시 중지/);
    await expect(dialog(page)).toContainText(/사용|예약/);
    await approve(page);
    await expect(dialog(page)).toHaveCount(0);
    expect(state.writes[0].body).toEqual({ accountWeekUsd: before.accountWeekUsd, globalDayUsd: before.globalDayUsd, globalWeekUsd: before.globalWeekUsd, [field]: "0", expectedRevision: 7 });
  });
}

test("model caps validate up to eight decimals and zero plus disable requires a reviewed PATCH", async ({ page }) => {
  const state = await open(page);
  const row = modelRow(page);
  const cap = row.getByLabel(labels.ko.cap, { exact: true });
  for (const invalid of ["", "-0.01", "100.00000001", "0.123456789", "1e1"]) {
    await cap.fill(invalid);
    await row.getByRole("button", { name: labels.ko.model, exact: true }).click();
    await expect(page.locator("main [role=alert]")).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  }
  await cap.fill("0.00000001");
  await row.getByRole("button", { name: labels.ko.model, exact: true }).click();
  await expect(dialog(page)).toContainText("0.00000001");
  await approve(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes[0].body).toEqual({ provider: "OPENAI", model: "gpt-6-luna", maxRunUsd: "0.00000001", enabled: true, expectedRevision: 7 });
  await cap.fill("0");
  await row.getByRole("button", { name: labels.ko.model, exact: true }).click();
  await expect(dialog(page)).toContainText(/일시 중지|사용 중지/);
  await expect(dialog(page).getByRole("button", { name: "변경 승인", exact: true })).toBeDisabled();
  await approve(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes[1]).toMatchObject({ path: `${endpoint}/models`, method: "PATCH", body: { provider: "OPENAI", model: "gpt-6-luna", maxRunUsd: "0", enabled: true, expectedRevision: 8 } });
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(row).toContainText("이 모델의 새 기본 AI 시작: 일시 중지");
  await cap.fill("0.5");
  await row.getByRole("checkbox").uncheck();
  await row.getByRole("button", { name: labels.ko.model, exact: true }).click();
  await expect(dialog(page)).toContainText("사용 중지");
  await approve(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes[2].body).toEqual({ provider: "OPENAI", model: "gpt-6-luna", maxRunUsd: "0.5", enabled: false, expectedRevision: 9 });
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await expect(row).toContainText("이 모델의 새 기본 AI 시작: 일시 중지");
  expect(state.settings.models[1]).toEqual({ provider: "OPENAI", model: "gpt-6-sol", maxRunUsd: "0.50000001", enabled: true });
});

test("disabled spending is read-only and editing a model does not enable global spending", async ({ page }) => {
  const state = await open(page, { settings: { spendingEnabled: false } });
  await expect(page.locator("main")).toContainText(/중지|비활성/);
  // The only toggles are per-model enablement; the global deployment switch is never editable.
  await expect(page.locator("main input[type=checkbox]")).toHaveCount(2);
  const row = modelRow(page);
  await row.getByLabel(labels.ko.cap, { exact: true }).fill("100");
  await row.getByRole("button", { name: labels.ko.model, exact: true }).click();
  await approve(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes[0].body).toEqual({ provider: "OPENAI", model: "gpt-6-luna", maxRunUsd: "100", enabled: true, expectedRevision: 7 });
  expect(state.settings.spendingEnabled).toBe(false);
});

test("forbidden reads expose no settings, model controls or mutation actions", async ({ page }) => {
  const state = await open(page, { readStatus: 403 });
  await expect(page.locator("main [role=alert]")).toContainText("접근 권한이 없습니다");
  await expect(accountInput(page)).toHaveCount(0);
  await expect(page.locator(".admin-model-rate")).toHaveCount(0);
  await expect(reviewBudget(page)).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test("revoked mutation access clears the reviewed dialog and every previously loaded control", async ({ page }) => {
  const state = await open(page);
  await prepareBudget(page);
  state.mutationStatus = 403;
  await approve(page);
  await expect(page.locator("main [role=alert]")).toContainText("접근 권한이 없습니다");
  await expect(dialog(page)).toHaveCount(0);
  await expect(accountInput(page)).toHaveCount(0);
  await expect(page.locator(".admin-model-rate")).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.applied).toEqual([]);
});

test("409 reloads the latest revision, discards stale intent and requires a new approval", async ({ page }) => {
  const state = await open(page);
  await prepareBudget(page);
  Object.assign(state.settings, { accountWeekUsd: "3.00000001", revision: 8 });
  await approve(page);
  await expect(accountInput(page)).toHaveValue("3.00000001");
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.applied).toEqual([]);
  await prepareBudget(page, { accountWeekUsd: "4.00000001" });
  await expect(dialog(page)).toContainText("3.00000001");
  await expect(dialog(page).getByRole("checkbox")).not.toBeChecked();
  await expect(dialog(page).getByRole("button", { name: "변경 승인", exact: true })).toBeDisabled();
  await approve(page);
  await expect(accountInput(page)).toHaveValue("4.00000001");
  expect(state.writes[1].body.expectedRevision).toBe(8);
  expect(state.applied).toHaveLength(1);
});

test("an unknown mutation outcome cannot be blindly retried before an explicit reload and new review", async ({ page }) => {
  const state = await open(page);
  await prepareBudget(page);
  state.mutationStatus = 503;
  await approve(page);
  await expect(page.locator("main [role=alert]")).toContainText("변경 결과를 확인하지 못했습니다");
  await expect(dialog(page)).toHaveCount(0);
  await expect(accountInput(page)).toHaveCount(0);
  await expect(reviewBudget(page)).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  const readsBefore = state.reads.length;
  Object.assign(state.settings, { accountWeekUsd: "2.12345678", revision: 8 });
  state.mutationStatus = 200;
  await reload(page).click();
  await expect(accountInput(page)).toHaveValue("2.12345678");
  expect(state.reads.length).toBeGreaterThan(readsBefore);
  expect(state.writes).toHaveLength(1);
  await prepareBudget(page, { accountWeekUsd: "4.12345678" });
  await expect(dialog(page).getByRole("checkbox")).not.toBeChecked();
  await approve(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes[1].body.expectedRevision).toBe(8);
});

test("invalid GET snapshots fail closed instead of manufacturing USD controls", async ({ page }) => {
  const state = await fixture(page);
  state.settings.accountWeekUsd = "0.123456789";
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main [role=alert]")).toBeVisible();
  await expect(accountInput(page)).toHaveCount(0);
  await expect(page.locator(".admin-model-rate")).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test("same-account session recovery preserves an in-flight approved mutation without a competing read", async ({ page }) => {
  const state = await open(page);
  await prepareBudget(page);
  const barrier = requestBarrier();
  state.nextMutation = barrier;
  await approve(page);
  await barrier.entered;
  const readsBefore = state.reads.length;
  await recover(page, { ...session, accessToken: "synthetic-recovered-token" });
  await expect(dialog(page)).toHaveAttribute("aria-busy", "true");
  await expect(reload(page)).toBeDisabled();
  barrier.release();
  await expect(accountInput(page)).toHaveValue("2.12345678");
  await expect(dialog(page)).toHaveCount(0);
  expect(state.reads).toHaveLength(readsBefore);
  expect(state.writes).toHaveLength(1);
  expect(state.applied).toHaveLength(1);
});

test("401 mutation results require reload and a fresh review without automatic token replay", async ({ page }) => {
  const state = await open(page);
  state.mutationStatus = 401;
  await prepareBudget(page);
  await approve(page);
  await expect(page.locator("main [role=alert]")).toContainText("변경 결과를 확인하지 못했습니다");
  await expect(dialog(page)).toHaveCount(0);
  await expect(accountInput(page)).toHaveCount(0);
  expect(state.refreshes).toEqual([]);
  expect(state.writes).toHaveLength(1);
  expect(state.applied).toEqual([]);
  state.mutationStatus = 200;
  await reload(page).click();
  await expect(accountInput(page)).toHaveValue("1.25000001");
  await prepareBudget(page);
  await expect(dialog(page).getByRole("checkbox")).not.toBeChecked();
  expect(state.writes).toHaveLength(1);
});

test("a pending mutation 401 never replays under a different recovered account", async ({ page }) => {
  const state = await open(page);
  state.mutationStatus = 401;
  const barrier = requestBarrier();
  state.nextMutation = barrier;
  await prepareBudget(page);
  await approve(page);
  await barrier.entered;
  state.settings = settings({ accountWeekUsd: "9.00000001", revision: 12 });
  await recover(page, { ...session, userId: "synthetic-other-admin", workspaceId: "synthetic-other-space", accessToken: "synthetic-other-token" });
  await expect(accountInput(page)).toHaveValue("9.00000001");
  await releaseReply(page, barrier, "PATCH");
  await expect(accountInput(page)).toHaveValue("9.00000001");
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].authorization).toBe(`Bearer ${session.accessToken}`);
  expect(state.refreshes).toEqual([]);
  expect(state.applied).toEqual([]);
});

// Only read-only GET requests may recover authentication automatically.
test("a 401 settings read recovers the session and loads the current snapshot", async ({ page }) => {
  const state = await fixture(page, { readStatus: 401 });
  await page.route("**/api/v2/auth/refresh", route => {
    state.refreshes.push(route.request().postDataJSON());
    state.readStatus = 200;
    return route.fulfill({ json: state.refreshedSession });
  });
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(accountInput(page)).toHaveValue("1.25000001");
  expect(state.refreshes).toEqual([{ refreshToken: session.refreshToken }]);
  expect(state.reads.at(-1).authorization).toBe(`Bearer ${state.refreshedSession.accessToken}`);
  expect(state.writes).toEqual([]);
});

test("session loss while a read is pending cannot restore settings or previous approvals", async ({ page }) => {
  const state = await open(page);
  const barrier = requestBarrier();
  state.nextRead = barrier;
  await reload(page).click();
  await barrier.entered;
  await recover(page, null);
  await releaseReply(page, barrier);
  await expect(page.getByRole("tab", { name: "로그인", exact: true })).toBeVisible();
  await expect(accountInput(page)).toHaveCount(0);
  await expect(page.locator(".admin-model-rate")).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test("an old-account read cannot overwrite a newer account snapshot", async ({ page }) => {
  const state = await open(page);
  const barrier = requestBarrier();
  state.nextRead = barrier;
  await reload(page).click();
  await barrier.entered;
  state.settings = settings({ accountWeekUsd: "9.00000001", revision: 12 });
  await recover(page, { ...session, userId: "synthetic-other-admin", workspaceId: "synthetic-other-space", accessToken: "synthetic-other-token" });
  await expect(accountInput(page)).toHaveValue("9.00000001");
  await releaseReply(page, barrier);
  await expect(accountInput(page)).toHaveValue("9.00000001");
  await prepareBudget(page, { accountWeekUsd: "10.00000001" });
  await approve(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes[0].body.expectedRevision).toBe(12);
  expect(state.writes[0].authorization).toBe("Bearer synthetic-other-token");
});

test("an old-account mutation response cannot reveal controls after the new account is denied", async ({ page }) => {
  const state = await open(page);
  await prepareBudget(page);
  const barrier = requestBarrier();
  state.nextMutation = barrier;
  await approve(page);
  await barrier.entered;
  state.readStatus = 403;
  await recover(page, { ...session, userId: "synthetic-non-admin", workspaceId: "synthetic-other-space", accessToken: "synthetic-other-token" });
  await expect(page.locator("main [role=alert]")).toContainText("접근 권한이 없습니다");
  await releaseReply(page, barrier, "PATCH");
  await expect(accountInput(page)).toHaveCount(0);
  await expect(page.locator(".admin-model-rate")).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});


test("existing over-ceiling budgets display exact ledger decimals and require lowering every oversized field", async ({ page }) => {
  const before = { accountWeekUsd: "99999999999.99999999", globalDayUsd: "12345678901.23456789", globalWeekUsd: "100000.00000001" };
  const state = await open(page, { settings: before });
  await expect(accountInput(page)).toHaveValue(before.accountWeekUsd);
  await expect(dayInput(page)).toHaveValue(before.globalDayUsd);
  await expect(weekInput(page)).toHaveValue(before.globalWeekUsd);
  await expect(page.locator("main")).toContainText("저장된 값은 그대로 표시");
  await accountInput(page).fill("100000.00000000");
  await reviewBudget(page).click();
  await expect(page.locator("main [role=alert]")).toContainText("수정 상한을 초과한 기존 예산이 남아 있습니다");
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes).toEqual([]);
  await dayInput(page).fill("99999.99999999");
  await reviewBudget(page).click();
  await expect(page.locator("main [role=alert]")).toContainText("세 예산을 모두");
  expect(state.writes).toEqual([]);
  await prepareBudget(page, { globalWeekUsd: "0.00000001" });
  for (const value of Object.values(before)) await expect(dialog(page)).toContainText(value);
  await expect(dialog(page).getByRole("button", { name: "변경 승인", exact: true })).toBeDisabled();
  await approve(page);
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes[0].body).toEqual({ accountWeekUsd: "100000.00000000", globalDayUsd: "99999.99999999", globalWeekUsd: "0.00000001", expectedRevision: 7 });
  await expect(accountInput(page)).toHaveValue("100000.00000000");
});
