import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const path = "/workspace/settings";
const rate = (id, name = id) => ({ id, name, workspaceId: "local-space", unit: "HOUR", rate: 100, minimumAmount: 0, currency: "KRW", active: true, version: 1 });
async function settingsFixture(page, initial = []) {
  const state = await fixture(page);
  const server = {
    cards: initial, writes: [], policyWrites: [], loseRateResponse: false, failPolicy: false, nextRate: null, nextPolicy: null,
    nextRateRead: null, nextPolicyRead: null, rateReadStatus: 200, policyReadStatus: 200, profileReadStatus: 200,
    profileName: "Fixture", refreshes: 0, reads: { rates: [], policy: [], profile: [] },
  };
  await page.route("**/api/v2/me", async route => {
    const status = server.profileReadStatus;
    server.reads.profile.push(route.request().headers().authorization);
    return route.fulfill({ status, json: status === 200 ? {
      id: "local-user", email: "fixture@example.invalid", displayName: server.profileName, status: "ACTIVE",
      workspaces: [{ workspaceId: "local-space", name: "Fixture", slug: "fixture", effectivePermissions: state.permissions }],
    } : { message: "Synthetic profile read failure" } });
  });
  await page.route("**/api/v2/workspaces/local-space/rate-cards**", async route => {
    const request = route.request();
    if (request.method() === "GET") {
      // Capture before waiting: a write must not silently update an already-started GET.
      const status = server.rateReadStatus;
      const snapshot = structuredClone(server.cards);
      server.reads.rates.push({ authorization: request.headers().authorization, snapshot, status });
      const barrier = server.nextRateRead; server.nextRateRead = null;
      if (barrier) await barrier.wait();
      return route.fulfill({ status, json: status === 200 ? snapshot : { message: "Synthetic rate read failure" } });
    }
    const id = new URL(request.url()).pathname.split("/").at(-1);
    const input = request.postDataJSON();
    server.writes.push({ id, input });
    const prior = server.cards.find(item => item.id === id);
    const saved = { ...rate(id), ...input, version: (prior?.version ?? 0) + 1 };
    server.cards = [...server.cards.filter(item => item.id !== id), saved];
    const barrier = server.nextRate; server.nextRate = null;
    if (barrier) await barrier.wait();
    if (server.loseRateResponse) { server.loseRateResponse = false; return route.fulfill({ status: 503, json: { message: "Synthetic lost save response" } }); }
    return route.fulfill({ json: saved });
  });
  await page.route("**/api/v2/workspaces/local-space/estimation-policy", async route => {
    if (route.request().method() === "GET") {
      const status = server.policyReadStatus;
      const snapshot = structuredClone(state.policy);
      server.reads.policy.push({ authorization: route.request().headers().authorization, snapshot, status });
      const barrier = server.nextPolicyRead; server.nextPolicyRead = null;
      if (barrier) await barrier.wait();
      return route.fulfill({ status, json: status === 200 ? snapshot : { message: "Synthetic policy read failure" } });
    }
    const input = route.request().postDataJSON(); server.policyWrites.push(input);
    const barrier = server.nextPolicy; server.nextPolicy = null;
    if (barrier) await barrier.wait();
    if (server.failPolicy) { server.failPolicy = false; return route.fulfill({ status: 503, json: { message: "Synthetic policy save failure" } }); }
    state.policy = { ...state.policy, ...input, version: state.policy.version + 1 };
    return route.fulfill({ json: state.policy });
  });
  return { state, server };
}

async function fillRate(page, name) {
  const form = page.locator(".rate-card-form");
  await form.getByLabel("서비스 이름", { exact: true }).fill(name);
  await form.getByLabel("기본 단가", { exact: true }).fill("100");
  return form;
}

async function refreshSettings(page, server) {
  const token = `fixture-refreshed-token-${++server.refreshes}`;
  const profileName = `Settings refresh completed ${server.refreshes}`;
  server.profileName = profileName;
  // Only advance Date.now: expire the 15-second query cache without sleeping or firing timers.
  await page.clock.setFixedTime(new Date(await page.evaluate(() => Date.now()) + 16_000));
  await page.evaluate(token => {
    const key = "freelance-ops-session-v1";
    const session = JSON.parse(sessionStorage.getItem(key));
    const recovered = { ...session, accessToken: token, refreshToken: token };
    sessionStorage.setItem(key, JSON.stringify(recovered));
    window.dispatchEvent(new CustomEvent("freelance-ops-session-recovery", { detail: recovered }));
  }, token);
  return { token, profileName };
}

async function afterDelayedRead(page, server, resource, mutate) {
  const barrier = requestBarrier();
  const nextRead = resource === "rates" ? "nextRateRead" : "nextPolicyRead";
  const endpoint = resource === "rates" ? "/rate-cards" : "/estimation-policy";
  server[nextRead] = barrier;
  try {
    const refreshed = await refreshSettings(page, server);
    await barrier.entered;
    expect(server.reads[resource].at(-1).authorization).toBe(`Bearer ${refreshed.token}`);
    // A same-owner token rotation must leave the mounted settings editor usable.
    await expect(page.locator("#estimation-policy form")).toBeVisible();
    await expect(page.locator(".rate-card-form")).toBeVisible();
    await mutate();
    const completed = page.waitForResponse(response => response.request().method() === "GET"
      && new URL(response.url()).pathname.endsWith(endpoint)
      && response.request().headers().authorization === `Bearer ${refreshed.token}`);
    barrier.release();
    expect(await (await completed).finished()).toBeNull();
    // Network completion alone can precede React. This fresh profile is committed by
    // SettingsPanel's same allSettled batch, so persistence checks run after its render.
    await expect(page.locator("#workspace-profile")).toContainText(refreshed.profileName);
  } finally {
    server[nextRead] = null;
    barrier.release();
  }
}

async function fillPolicy(page, { tax = "25", buffer = "15", discount = "5" } = {}) {
  const policy = page.locator("#estimation-policy");
  await policy.getByLabel("기본 세율 (%)", { exact: true }).fill(tax);
  await policy.getByLabel("위험 대비율 (%)", { exact: true }).fill(buffer);
  await policy.getByLabel("최대 할인율 (%)", { exact: true }).fill(discount);
  return policy;
}

async function savePolicy(page, values) {
  const policy = await fillPolicy(page, values);
  await policy.getByRole("button", { name: "계산 기준 저장", exact: true }).click();
  await expect(page.locator(".settings-page > .settings-saved")).toHaveText("견적 정책이 저장되었습니다.");
}

async function expectPolicy(page, { tax = "25", buffer = "15", discount = "5" } = {}) {
  const policy = page.locator("#estimation-policy");
  await expect(policy.getByLabel("기본 세율 (%)", { exact: true })).toHaveValue(tax);
  await expect(policy.getByLabel("위험 대비율 (%)", { exact: true })).toHaveValue(buffer);
  await expect(policy.getByLabel("최대 할인율 (%)", { exact: true })).toHaveValue(discount);
}

test("lost rate save retries the same identity without duplicate registration", async ({ page }) => {
  const { state, server } = await settingsFixture(page); server.loseRateResponse = true;
  await page.goto(path);
  const form = await fillRate(page, "Retry-safe service");
  await form.getByRole("button", { name: "단가 등록", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("Retry-safe service");
  await expect(form.locator(".settings-saved")).toHaveCount(0);
  await form.getByRole("button", { name: "단가 등록", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("새 단가를 등록했습니다");
  expect(server.writes).toHaveLength(2);
  expect(server.writes[1]).toEqual(server.writes[0]);
  expect(server.cards).toHaveLength(1);
  await page.getByRole("button", { name: "새 단가", exact: true }).click();
  await fillRate(page, "Explicitly separate service");
  await form.getByRole("button", { name: "단가 등록", exact: true }).click();
  await expect(page.locator(".rate-card-list > button")).toHaveCount(2);
  expect(server.writes[2].id).not.toBe(server.writes[0].id);
  expect(state.blocked).toEqual([]);
  expect(state.starts).toEqual([]);
});

test("pending rate mutations serialize rapid submit and cannot discard another editor", async ({ page }) => {
  const { server } = await settingsFixture(page, [rate("one", "First service"), rate("two", "Second service")]);
  await page.goto(path);
  await page.locator(".rate-card-list > button").filter({ hasText: "First service" }).click();
  const form = await fillRate(page, "Updated first service");
  const barrier = requestBarrier(); server.nextRate = barrier;
  try {
    await form.evaluate(element => { element.requestSubmit(); element.requestSubmit(); });
    await barrier.entered;
    await expect(page.getByRole("button", { name: "새 단가", exact: true })).toBeDisabled();
    await expect(page.locator(".rate-card-list > button").filter({ hasText: "Second service" })).toBeDisabled();
    await expect(form.getByLabel("서비스 이름", { exact: true })).toBeDisabled();
    expect(server.writes).toHaveLength(1);
  } finally { barrier.release(); }
  await expect(form.getByRole("status")).toContainText("단가 변경을 저장했습니다");
  await page.locator(".rate-card-list > button").filter({ hasText: "Second service" }).click();
  await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("Second service");
});

test("mobile English policy requires every percentage, preserves failed edits and accepts explicit zero", async ({ page }) => {
  const { state, server } = await settingsFixture(page);
  await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "en"));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(path);
  const policy = page.locator("#estimation-policy");
  const tax = policy.getByLabel("Default tax (%)", { exact: true });
  await tax.fill("");
  await policy.getByRole("button", { name: "Save defaults", exact: true }).click();
  await expect(tax).toBeFocused();
  expect(server.policyWrites).toHaveLength(0);
  await tax.fill("0"); server.failPolicy = true;
  await policy.getByRole("button", { name: "Save defaults", exact: true }).click();
  await expect(page.locator(".settings-page > .inline-error")).toBeVisible();
  await expect(page.locator(".settings-page > .settings-saved")).toHaveCount(0);
  await expect(tax).toHaveValue("0");
  await policy.getByRole("button", { name: "Save defaults", exact: true }).click();
  await expect(page.locator(".settings-page > .settings-saved")).toHaveText("Estimate policy saved.");
  expect(server.policyWrites).toHaveLength(2);
  expect(server.policyWrites[1].defaultTaxRate).toBe(0);
  expect(state.policy.defaultTaxRate).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "outputs/ui-ux/settings-policy-mobile.png", fullPage: true });
  expect(state.blocked).toEqual([]);
});

test("read-only settings disclose saved values without any mutation controls", async ({ page }) => {
  const { state, server } = await settingsFixture(page, [rate("one", "Visible saved service")]);
  state.permissions = ["project.read", "quotation.read"];
  await page.goto(path);
  await expect(page.locator(".rate-card-list")).toContainText("Visible saved service");
  await expect(page.locator(".rate-card-form")).toHaveCount(0);
  await expect(page.locator("#estimation-policy form")).toHaveCount(0);
  await expect(page.locator("#ai-connections")).toHaveCount(0);
  await expect(page.locator("#estimation-policy")).toContainText("10%");
  expect(server.writes).toEqual([]);
  expect(server.policyWrites).toEqual([]);
  expect(state.starts).toEqual([]);
});

test("a policy save wins over an older refresh snapshot and a later refresh still updates settings", async ({ page }) => {
  const { state, server } = await settingsFixture(page, [rate("one", "Existing service")]);
  await page.goto(path);
  await expectPolicy(page, { tax: "10", buffer: "10", discount: "10" });

  await afterDelayedRead(page, server, "policy", () => savePolicy(page));
  expect(server.reads.policy.at(-1).snapshot.version).toBe(1);
  expect(state.policy.version).toBe(2);
  await expectPolicy(page);
  await expect(page.locator(".settings-page > .inline-error")).toHaveCount(0);
  await expect(page.locator(".settings-page > .settings-saved")).toHaveText("견적 정책이 저장되었습니다.");

  // Read suppression must be scoped to the older request, not all future refreshes.
  state.policy = { ...state.policy, defaultTaxRate: .3, defaultRiskBufferRate: .2, maximumDiscountRate: .1, version: 3 };
  server.cards = [rate("one", "Externally refreshed service")];
  const refreshed = await refreshSettings(page, server);
  await expect(page.locator("#workspace-profile")).toContainText(refreshed.profileName);
  await expectPolicy(page, { tax: "30", buffer: "20", discount: "10" });
  await expect(page.locator(".rate-card-list")).toContainText("Externally refreshed service");
  expect(server.policyWrites).toHaveLength(1);
  expect(state.blocked).toEqual([]);
  expect(state.starts).toEqual([]);
});

test("a delayed policy read failure cannot replace a successful policy save with an error", async ({ page }) => {
  const { state, server } = await settingsFixture(page);
  await page.goto(path);
  await expectPolicy(page, { tax: "10", buffer: "10", discount: "10" });
  server.policyReadStatus = 503;
  try {
    await afterDelayedRead(page, server, "policy", () => savePolicy(page));
    expect(server.reads.policy.at(-1).status).toBe(503);
    await expectPolicy(page);
    await expect(page.locator(".settings-page > .inline-error")).toHaveCount(0);
    await expect(page.locator(".settings-page > .settings-saved")).toHaveText("견적 정책이 저장되었습니다.");
    expect(state.blocked).toEqual([]);
  } finally { server.policyReadStatus = 200; }
});

for (const operation of ["edit", "create", "deactivate", "reactivate"]) {
  test(`rate ${operation} survives an older refresh snapshot without suppressing unrelated policy data`, async ({ page }) => {
    const first = { ...rate("one", "First service"), active: operation !== "reactivate" };
    const { state, server } = await settingsFixture(page, [first, rate("two", "Untouched service")]);
    await page.goto(path);
    await expect(page.locator(".rate-card-list > button")).toHaveCount(2);
    if (operation !== "create") await page.locator(".rate-card-list > button").filter({ hasText: "First service" }).click();
    const form = page.locator(".rate-card-form");
    // An unrelated resource from this same read batch remains eligible to update.
    state.policy = { ...state.policy, defaultTaxRate: .17, version: 2 };

    await afterDelayedRead(page, server, "rates", async () => {
      if (operation === "edit" || operation === "create") {
        await fillRate(page, operation === "edit" ? "Saved first service" : "Saved new service");
        await form.getByLabel("기본 단가", { exact: true }).fill("250");
        await form.getByRole("button", { name: operation === "edit" ? "변경 저장" : "단가 등록", exact: true }).click();
        await expect(form.getByRole("status")).toContainText(operation === "edit" ? "단가 변경을 저장했습니다" : "새 단가를 등록했습니다");
      } else {
        await form.getByRole("button", { name: operation === "deactivate" ? "비활성화" : "다시 사용", exact: true }).click();
        if (operation === "deactivate") await form.locator(".archive-confirm").getByRole("button", { name: "비활성화", exact: true }).click();
        await expect(form.getByRole("status")).toContainText(operation === "deactivate"
          ? "이 단가를 새 견적의 선택 항목에서 제외했습니다" : "이 단가를 새 견적에서 다시 사용할 수 있습니다");
      }
    });

    expect(server.writes).toHaveLength(1);
    expect(server.reads.rates.at(-1).snapshot).toEqual([first, rate("two", "Untouched service")]);
    await expect(page.locator(".rate-card-list > button")).toHaveCount(operation === "create" ? 3 : 2);
    await expect(page.locator(".rate-card-list")).toContainText("Untouched service");
    const savedName = operation === "edit" ? "Saved first service" : operation === "create" ? "Saved new service" : "First service";
    const savedCard = page.locator(".rate-card-list > button").filter({ hasText: savedName });
    await expect(savedCard).toHaveAttribute("aria-pressed", "true");
    await expect(savedCard.locator("strong")).toHaveText(savedName);
    await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue(savedName);
    await expect(form.getByLabel("기본 단가", { exact: true })).toHaveValue(operation === "edit" || operation === "create" ? "250" : "100");
    await expect(form.locator(".rate-card-form-heading")).toContainText(`수정 이력 ${operation === "create" ? 1 : 2}`);
    if (operation === "deactivate") {
      await expect(savedCard).toHaveClass(/inactive/);
      await expect(form.getByRole("button", { name: "다시 사용", exact: true })).toBeVisible();
    } else {
      await expect(savedCard).not.toHaveClass(/inactive/);
      await expect(form.getByRole("button", { name: "비활성화", exact: true })).toBeVisible();
    }
    await expectPolicy(page, { tax: "17", buffer: "10", discount: "10" });
    await expect(page.locator(".settings-page > .inline-error")).toHaveCount(0);
    expect(state.blocked).toEqual([]);
    expect(state.starts).toEqual([]);
  });
}

for (const resource of ["rates", "profile", "policy"]) {
  test(`a successful unrelated save does not erase an existing ${resource} read error`, async ({ page }) => {
    const { state, server } = await settingsFixture(page);
    await page.goto(path);
    await expectPolicy(page, { tax: "10", buffer: "10", discount: "10" });
    const statusKey = resource === "rates" ? "rateReadStatus" : `${resource}ReadStatus`;
    const message = `Synthetic ${resource === "rates" ? "rate" : resource} read failure`;
    server[statusKey] = 503;
    try {
      await refreshSettings(page, server);
      const error = page.locator(".settings-page > .inline-error");
      await expect(error).toHaveText(message);
      if (resource === "policy") {
        const form = await fillRate(page, "Saved despite policy outage");
        await form.getByRole("button", { name: "단가 등록", exact: true }).click();
        await expect(form.getByRole("status")).toContainText("새 단가를 등록했습니다");
      } else {
        await savePolicy(page);
        await expectPolicy(page);
      }
      await expect(error).toHaveText(message);

      // A successful read of the failed resource should clear that resource's old error.
      server[statusKey] = 200;
      const recovered = await refreshSettings(page, server);
      await expect(page.locator("#workspace-profile")).toContainText(recovered.profileName);
      await expect(error).toHaveCount(0);
      expect(state.blocked).toEqual([]);
    } finally { server[statusKey] = 200; }
  });
}

for (const resource of ["rates", "policy"]) {
  test(`a delayed ${resource} read failure is still reported after an unrelated save`, async ({ page }) => {
    const { state, server } = await settingsFixture(page);
    await page.goto(path);
    await expectPolicy(page, { tax: "10", buffer: "10", discount: "10" });
    const statusKey = resource === "rates" ? "rateReadStatus" : "policyReadStatus";
    server[statusKey] = 503;
    try {
      await afterDelayedRead(page, server, resource, async () => {
        if (resource === "rates") return savePolicy(page);
        const form = await fillRate(page, "Saved while policy read was pending");
        await form.getByRole("button", { name: "단가 등록", exact: true }).click();
        await expect(form.getByRole("status")).toContainText("새 단가를 등록했습니다");
      });
      await expect(page.locator(".settings-page > .inline-error")).toHaveText(`Synthetic ${resource === "rates" ? "rate" : "policy"} read failure`);
      if (resource === "rates") await expectPolicy(page);
      else await expect(page.locator(".rate-card-list")).toContainText("Saved while policy read was pending");
      expect(state.blocked).toEqual([]);
    } finally { server[statusKey] = 200; }
  });
}

test("a newer policy read cannot reset submitted fields while their save is pending or fails", async ({ page }) => {
  const { state, server } = await settingsFixture(page, [rate("one", "Initial service")]);
  await page.goto(path);
  await expectPolicy(page, { tax: "10", buffer: "10", discount: "10" });
  state.policy = { ...state.policy, defaultTaxRate: .3, defaultRiskBufferRate: .2, maximumDiscountRate: .1, version: 2 };
  server.cards = [rate("one", "Refreshed unrelated service")];
  const saveBarrier = requestBarrier(); server.nextPolicy = saveBarrier; server.failPolicy = true;
  try {
    await afterDelayedRead(page, server, "policy", async () => {
      const policy = await fillPolicy(page);
      await policy.getByRole("button", { name: "계산 기준 저장", exact: true }).click();
      await saveBarrier.entered;
      await expect(policy.locator("form")).toHaveAttribute("aria-busy", "true");
    });
    await expectPolicy(page);
    await expect(page.locator("#estimation-policy form")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(".rate-card-list")).toContainText("Refreshed unrelated service");
    saveBarrier.release();
    await expect(page.locator(".settings-page > .inline-error")).toHaveText("Synthetic policy save failure");
    await expect(page.locator("#estimation-policy form")).toHaveAttribute("aria-busy", "false");
    await expectPolicy(page);
    await expect(page.locator(".settings-page > .settings-saved")).toHaveCount(0);
    expect(state.policy.version).toBe(2);
    expect(server.policyWrites).toHaveLength(1);
    expect(state.blocked).toEqual([]);
  } finally {
    server.nextPolicy = null; server.failPolicy = false; saveBarrier.release();
  }
});

test("a newer rate read cannot reset submitted fields while their save is pending or fails", async ({ page }) => {
  const { state, server } = await settingsFixture(page, [rate("one", "Initial service")]);
  await page.goto(path);
  await page.locator(".rate-card-list > button").filter({ hasText: "Initial service" }).click();
  server.cards = [{ ...rate("one", "Newer server service"), rate: 300, version: 2 }];
  state.policy = { ...state.policy, defaultTaxRate: .17, version: 2 };
  const form = page.locator(".rate-card-form");
  const saveBarrier = requestBarrier(); server.nextRate = saveBarrier; server.loseRateResponse = true;
  try {
    await afterDelayedRead(page, server, "rates", async () => {
      await fillRate(page, "Submitted service");
      await form.getByLabel("기본 단가", { exact: true }).fill("250");
      await form.getByRole("button", { name: "변경 저장", exact: true }).click();
      await saveBarrier.entered;
      await expect(form).toHaveAttribute("aria-busy", "true");
    });
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("Submitted service");
    await expect(form.getByLabel("기본 단가", { exact: true })).toHaveValue("250");
    await expectPolicy(page, { tax: "17", buffer: "10", discount: "10" });
    saveBarrier.release();
    await expect(form.getByRole("alert")).toHaveText("Synthetic lost save response");
    await expect(form).toHaveAttribute("aria-busy", "false");
    await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("Submitted service");
    await expect(form.getByLabel("기본 단가", { exact: true })).toHaveValue("250");
    await expect(form.getByRole("status")).toHaveCount(0);
    expect(server.writes).toHaveLength(1);
    expect(state.blocked).toEqual([]);
  } finally {
    server.nextRate = null; server.loseRateResponse = false; saveBarrier.release();
  }
});
