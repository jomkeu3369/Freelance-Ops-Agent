import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const path = "/workspace/settings";
const rate = (id, name = id) => ({ id, name, workspaceId: "local-space", unit: "HOUR", rate: 100, minimumAmount: 0, currency: "KRW", active: true, version: 1 });
async function settingsFixture(page, initial = []) {
  const state = await fixture(page);
  const server = {
    cards: initial, writes: [], moves: [], policyWrites: [], loseRateResponse: false, failMove: false, failPolicy: false, nextRate: null, nextPolicy: null,
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
      // 대기 전에 스냅샷을 잡아 이미 시작한 GET을 변경 요청이 덮어쓰지 못하게 한다.
      const status = server.rateReadStatus;
      const snapshot = structuredClone(server.cards);
      server.reads.rates.push({ authorization: request.headers().authorization, snapshot, status });
      const barrier = server.nextRateRead; server.nextRateRead = null;
      if (barrier) await barrier.wait();
      return route.fulfill({ status, json: status === 200 ? snapshot : { message: "Synthetic rate read failure" } });
    }
    const parts = new URL(request.url()).pathname.split("/"), moving = parts.at(-1) === "folder";
    const id = moving ? parts.at(-2) : parts.at(-1);
    const input = request.postDataJSON();
    (moving ? server.moves : server.writes).push({ id, input });
    if (moving && server.failMove) return route.fulfill({ status: 503, json: { message: "Synthetic folder move failure" } });
    const prior = server.cards.find(item => item.id === id);
    const saved = { ...rate(id), ...prior, ...input, version: (prior?.version ?? 0) + 1 };
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
  if (await form.count() === 0) await page.getByRole("button", { name: "새 단가", exact: true }).click();
  await form.getByLabel("서비스 이름", { exact: true }).fill(name);
  await form.getByLabel("기본 단가", { exact: true }).fill("100");
  return form;
}

async function refreshSettings(page, server) {
  const token = `fixture-refreshed-token-${++server.refreshes}`;
  const profileName = `Settings refresh completed ${server.refreshes}`;
  server.profileName = profileName;
  // Date.now만 진행해 15초 캐시를 만료시킨다. 대기하거나 타이머를 실행하지 않는다.
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
  const editorCount = await page.locator(".rate-card-form").count();
  const barrier = requestBarrier();
  const nextRead = resource === "rates" ? "nextRateRead" : "nextPolicyRead";
  const endpoint = resource === "rates" ? "/rate-cards" : "/estimation-policy";
  server[nextRead] = barrier;
  try {
    const refreshed = await refreshSettings(page, server);
    await barrier.entered;
    expect(server.reads[resource].at(-1).authorization).toBe(`Bearer ${refreshed.token}`);
    // 같은 사용자의 토큰 교체는 열린 설정 편집기를 계속 사용할 수 있게 해야 한다.
    await expect(page.locator("#estimation-policy form")).toBeVisible();
    await expect(page.locator(".rate-card-form")).toHaveCount(editorCount);
    await mutate();
    const completed = page.waitForResponse(response => response.request().method() === "GET"
      && new URL(response.url()).pathname.endsWith(endpoint)
      && response.request().headers().authorization === `Bearer ${refreshed.token}`);
    barrier.release();
    expect(await (await completed).finished()).toBeNull();
    // 네트워크 완료가 React 반영보다 빠를 수 있다. 같은 allSettled 묶음으로
    // 프로필이 반영된 것을 확인한 뒤 저장 결과를 검사한다.
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
  await expect(page.locator("#estimation-policy .settings-saved")).toHaveText("견적 정책이 저장되었습니다.");
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
  await expect(page.locator(".rate-card-manager .inline-error")).toBeVisible();
  await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("Retry-safe service");
  await expect(form.locator(".settings-saved")).toHaveCount(0);
  await form.getByRole("button", { name: "단가 등록", exact: true }).click();
  await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("새 단가를 등록했습니다");
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
  await page.locator(".rate-card-list > button").filter({ hasText: "Second service" }).click();
  await expect(page.locator(".rate-card-switch-confirm")).toBeVisible();
  const barrier = requestBarrier(); server.nextRate = barrier;
  try {
    await form.evaluate(element => { element.requestSubmit(); element.requestSubmit(); });
    await barrier.entered;
    await expect(page.getByRole("button", { name: "새 단가", exact: true })).toBeDisabled();
    await expect(form.getByRole("button", { name: "닫기", exact: true })).toBeDisabled();
    await expect(page.locator(".rate-card-list > button").filter({ hasText: "Second service" })).toBeDisabled();
    await expect(form.getByLabel("서비스 이름", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "계속 편집", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "변경 버리고 이동", exact: true })).toBeDisabled();
    expect(server.writes).toHaveLength(1);
  } finally { barrier.release(); }
  await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("단가 변경을 저장했습니다");
  await expect(page.locator(".rate-card-switch-confirm")).toHaveCount(0);
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
  await expect(policy.getByRole("alert")).toBeVisible();
  await expect(page.locator("#estimation-policy .settings-saved")).toHaveCount(0);
  await expect(tax).toHaveValue("0");
  await policy.getByRole("button", { name: "Save defaults", exact: true }).click();
  await expect(page.locator("#estimation-policy .settings-saved")).toHaveText("Estimate policy saved.");
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
  await expect(page.locator("#estimation-policy .settings-saved")).toHaveText("견적 정책이 저장되었습니다.");

  // 이전 요청만 반영을 막고 이후 모든 갱신을 막지 않아야 한다.
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
    await expect(page.locator("#estimation-policy .settings-saved")).toHaveText("견적 정책이 저장되었습니다.");
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
    else await page.getByRole("button", { name: "새 단가", exact: true }).click();
    const form = page.locator(".rate-card-form");
    // 같은 조회 묶음의 다른 자료는 계속 갱신할 수 있어야 한다.
    state.policy = { ...state.policy, defaultTaxRate: .17, version: 2 };

    await afterDelayedRead(page, server, "rates", async () => {
      if (operation === "edit" || operation === "create") {
        await fillRate(page, operation === "edit" ? "Saved first service" : "Saved new service");
        await form.getByLabel("기본 단가", { exact: true }).fill("250");
        await form.getByRole("button", { name: operation === "edit" ? "변경 저장" : "단가 등록", exact: true }).click();
        await expect(page.locator(".rate-card-manager .settings-saved")).toContainText(operation === "edit" ? "단가 변경을 저장했습니다" : "새 단가를 등록했습니다");
      } else {
        await form.getByRole("button", { name: operation === "deactivate" ? "비활성화" : "다시 사용", exact: true }).click();
        if (operation === "deactivate") await form.locator(".archive-confirm").getByRole("button", { name: "비활성화", exact: true }).click();
        await expect(page.locator(".rate-card-manager .settings-saved")).toContainText(operation === "deactivate"
          ? "이 단가를 새 견적의 선택 항목에서 제외했습니다" : "이 단가를 새 견적에서 다시 사용할 수 있습니다");
      }
    });

    expect(server.writes).toHaveLength(1);
    expect(server.reads.rates.at(-1).snapshot).toEqual([first, rate("two", "Untouched service")]);
    await expect(page.locator(".rate-card-list > button")).toHaveCount(operation === "create" ? 3 : 2);
    await expect(page.locator(".rate-card-list")).toContainText("Untouched service");
    const savedName = operation === "edit" ? "Saved first service" : operation === "create" ? "Saved new service" : "First service";
    const savedCard = page.locator(".rate-card-list > button").filter({ hasText: savedName });
    await expect(savedCard).toHaveAttribute("aria-pressed", operation === "create" ? "false" : "true");
    await expect(savedCard.locator("strong")).toHaveText(savedName);
    if (operation === "create") await expect(form).toHaveCount(0);
    else {
      await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue(savedName);
      await expect(form.getByLabel("기본 단가", { exact: true })).toHaveValue(operation === "edit" ? "250" : "100");
      await expect(form.locator(".rate-card-form-heading")).toContainText("수정 이력 2");
    }
    if (operation === "deactivate") {
      await expect(savedCard).toHaveClass(/inactive/);
      await expect(form.getByRole("button", { name: "다시 사용", exact: true })).toBeVisible();
    } else {
      await expect(savedCard).not.toHaveClass(/inactive/);
      if (operation !== "create") await expect(form.getByRole("button", { name: "비활성화", exact: true })).toBeVisible();
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
        await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("새 단가를 등록했습니다");
      } else {
        await savePolicy(page);
        await expectPolicy(page);
      }
      await expect(error).toHaveText(message);

      // 실패한 자료를 정상 조회하면 해당 자료의 이전 오류를 지워야 한다.
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
        await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("새 단가를 등록했습니다");
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
    await expect(page.locator("#estimation-policy").getByRole("alert")).toHaveText("Synthetic policy save failure");
    await expect(page.locator("#estimation-policy form")).toHaveAttribute("aria-busy", "false");
    await expectPolicy(page);
    await expect(page.locator("#estimation-policy .settings-saved")).toHaveCount(0);
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
    await expect(page.locator(".rate-card-manager .inline-error")).toHaveText("Synthetic lost save response");
    await expect(form).toHaveAttribute("aria-busy", "false");
    await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("Submitted service");
    await expect(form.getByLabel("기본 단가", { exact: true })).toHaveValue("250");
    await expect(page.locator(".rate-card-manager .settings-saved")).toHaveCount(0);
    expect(server.writes).toHaveLength(1);
    expect(state.blocked).toEqual([]);
  } finally {
    server.nextRate = null; server.loseRateResponse = false; saveBarrier.release();
  }
});

test("a background rate refresh preserves an unsaved editor before its first save", async ({ page }) => {
  const { server } = await settingsFixture(page, [rate("one", "Initial service")]);
  await page.goto(path);
  await page.locator(".rate-card-list > button").first().click();
  const form = await fillRate(page, "아직 저장하지 않은 편집");
  await form.getByLabel("기본 단가", { exact: true }).fill("250");
  server.cards = [{ ...rate("one", "External server change"), rate: 300, version: 2 }];
  const refreshed = await refreshSettings(page, server);
  await expect(page.locator("#workspace-profile")).toContainText(refreshed.profileName);
  await expect(page.locator(".rate-card-list")).toContainText("External server change");
  await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("아직 저장하지 않은 편집");
  await expect(form.getByLabel("기본 단가", { exact: true })).toHaveValue("250");
  await expect(form.locator(".rate-card-form-heading")).toContainText("수정 이력 1");
  await form.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator(".rate-card-manager").getByRole("alert")).toContainText("저장하지 않은 단가 변경");
  await page.getByRole("button", { name: "계속 편집", exact: true }).click();
  await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("아직 저장하지 않은 편집");
  expect(server.writes).toEqual([]);
});

for (const protection of ["dirty", "pending"]) {
  test(`${protection} rate editing protects a native reload and releases protection after completion`, async ({ page }) => {
    const { server } = await settingsFixture(page, [rate("one", "Initial service")]);
    await page.goto(path);
    await page.locator(".rate-card-list > button").first().click();
    const form = page.locator(".rate-card-form");
    const barrier = requestBarrier();
    if (protection === "dirty") await fillRate(page, "새로고침에도 보존");
    else {
      server.nextRate = barrier;
      await form.getByRole("button", { name: "비활성화", exact: true }).click();
      await form.locator(".archive-confirm").getByRole("button", { name: "비활성화", exact: true }).click();
      await barrier.entered;
    }
    const dialogs = [];
    const dismiss = async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); };
    page.on("dialog", dismiss);
    try {
      await page.reload({ timeout: 5_000 }).catch(() => null);
      expect(dialogs).toEqual(["beforeunload"]);
      if (protection === "dirty") {
        await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("새로고침에도 보존");
        await form.getByRole("button", { name: "닫기", exact: true }).click();
        await page.getByRole("button", { name: "변경 버리고 이동", exact: true }).click();
      } else {
        await expect(form).toHaveAttribute("aria-busy", "true");
        await expect(form.getByRole("button", { name: "닫기", exact: true })).toBeDisabled();
        barrier.release();
        await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("선택 항목에서 제외했습니다");
        await form.getByRole("button", { name: "닫기", exact: true }).click();
      }
      await expect(form).toHaveCount(0);
      await page.reload();
      expect(dialogs).toEqual(["beforeunload"]);
      await expect(form).toHaveCount(0);
    } finally {
      barrier.release(); server.nextRate = null;
      page.off("dialog", dismiss);
    }
  });
}

async function openMovedRateDraft(page, name) {
  const { server } = await settingsFixture(page, [rate("one", "Original rate")]);
  await page.route("**/api/v2/workspaces/local-space/rate-card-folders", route => route.fulfill({ json: [{ id: "external-folder", workspaceId: "local-space", parentId: null, name: "다른 PC 폴더", version: 0 }] }));
  await page.goto(path);
  await page.locator(".rate-card-list > button").first().click();
  const form = await fillRate(page, name);
  await form.getByLabel("기본 단가", { exact: true }).fill("250");
  server.cards = [{ ...rate("one", "Original rate"), folderId: "external-folder", version: 2 }];
  const refreshed = await refreshSettings(page, server);
  await expect(page.locator("#workspace-profile")).toContainText(refreshed.profileName);
  await expect(page.locator(".rate-card-list > button")).toHaveCount(0);
  return { server, form };
}

test("an unsaved rate moved to another folder by another PC saves its original identity", async ({ page }) => {
  const { server, form } = await openMovedRateDraft(page, "이동된 기존 단가의 변경");
  await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("이동된 기존 단가의 변경");
  await expect(form.getByRole("button", { name: "변경 저장", exact: true })).toBeVisible();
  await form.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("단가 변경을 저장했습니다");
  expect(server.writes).toHaveLength(1);
  expect(server.writes[0].id).toBe("one");
  expect(server.cards).toHaveLength(1);
  expect(server.cards[0]).toMatchObject({ id: "one", name: "이동된 기존 단가의 변경" });
  expect(server.moves.map(item => item.id)).toEqual(["one"]);
});

test("an externally moved dirty rate keeps its toggled status through the next save", async ({ page }) => {
  const { server, form } = await openMovedRateDraft(page, "외부 이동 후 상태를 유지할 단가");
  await form.getByRole("button", { name: "비활성화", exact: true }).click();
  await form.locator(".archive-confirm").getByRole("button", { name: "비활성화", exact: true }).click();
  await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("선택 항목에서 제외했습니다");
  await expect(form.getByRole("button", { name: "다시 사용", exact: true })).toBeVisible();
  await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("외부 이동 후 상태를 유지할 단가");
  await expect(form.getByLabel("기본 단가", { exact: true })).toHaveValue("250");
  await form.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("단가 변경을 저장했습니다");
  expect(server.writes.map(item => item.id)).toEqual(["one", "one"]);
  expect(server.writes[1].input).toMatchObject({ name: "외부 이동 후 상태를 유지할 단가", rate: 250, active: false });
  expect(server.cards).toHaveLength(1);
  expect(server.cards[0]).toMatchObject({ id: "one", folderId: null, active: false });
});

test("an externally moved rate preserves saved metadata and status after a partial save retry", async ({ page }) => {
  const { server, form } = await openMovedRateDraft(page, "외부 이동 후 저장된 이름");
  server.failMove = true;
  await form.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.locator(".rate-card-manager .inline-error")).toContainText("단가는 저장했지만 폴더를 옮기지 못했습니다");
  await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("외부 이동 후 저장된 이름");
  await expect(form.getByLabel("기본 단가", { exact: true })).toHaveValue("250");
  await form.getByRole("button", { name: "비활성화", exact: true }).click();
  await form.locator(".archive-confirm").getByRole("button", { name: "비활성화", exact: true }).click();
  await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("선택 항목에서 제외했습니다");
  await expect(form.getByRole("button", { name: "다시 사용", exact: true })).toBeVisible();
  expect(server.writes[1]).toMatchObject({ id: "one", input: { name: "외부 이동 후 저장된 이름", rate: 250, active: false } });
  await expect(form.getByLabel("단가 폴더", { exact: true })).toHaveValue("");
  server.failMove = false;
  await form.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.locator(".rate-card-manager .settings-saved")).toContainText("단가 변경을 저장했습니다");
  expect(server.writes.map(item => item.id)).toEqual(["one", "one", "one"]);
  expect(server.moves.map(item => item.id)).toEqual(["one", "one"]);
  expect(server.cards).toHaveLength(1);
  expect(server.cards[0]).toMatchObject({ id: "one", name: "외부 이동 후 저장된 이름", rate: 250, folderId: null, active: false });
});

for (const [width, height, locale] of [[390, 640, "ko"], [320, 568, "en"]]) {
  for (const outcome of ["create success", "edit failure then retry"]) {
    test(`${width}px ${locale}: ${outcome} feedback is visible above a long rate list`, async ({ page }) => {
      const initial = Array.from({ length: 16 }, (_, index) => rate(`rate-${index}`, `Service ${index} ${"Long service ".repeat(6)}`));
      const { server } = await settingsFixture(page, initial);
      await page.setViewportSize({ width, height });
      await page.addInitScript(locale => localStorage.setItem("freelance-ops-ui-locale-v1", locale), locale);
      await page.goto(path);
      await expect(page.locator(".rate-card-list > button")).toHaveCount(16);
      if (outcome === "create success") await page.getByRole("button", { name: locale === "en" ? "New rate" : "새 단가", exact: true }).click();
      else await page.locator(".rate-card-list > button").last().click();
      const form = page.locator(".rate-card-form");
      await form.locator('[name="name"]').fill("Viewport feedback service");
      await form.locator('[name="rate"]').fill("250");
      if (outcome !== "create success") server.loseRateResponse = true;
      await form.locator('button[type="submit"]').click();
      if (outcome !== "create success") {
        const error = page.locator(".rate-card-manager .inline-error");
        await expect(error).toContainText("Synthetic lost save response");
        await expect(error).toBeInViewport({ ratio: 1 });
        await expect(form.locator('[name="name"]')).toHaveValue("Viewport feedback service");
        await form.locator('button[type="submit"]').click();
      }
      const notice = page.locator(".rate-card-manager .settings-saved");
      await expect(notice).toBeVisible();
      await expect(notice).toBeInViewport({ ratio: 1 });
      if (outcome === "create success") {
        await expect(form).toHaveCount(0);
        const newButton = page.getByRole("button", { name: locale === "en" ? "New rate" : "새 단가", exact: true });
        await expect(newButton).toBeFocused();
        await expect(newButton).toBeInViewport({ ratio: 1 });
        expect(server.writes).toHaveLength(1);
      } else {
        await expect(form).toBeVisible();
        expect(server.writes).toHaveLength(2);
        expect(server.writes.map(item => item.id)).toEqual(["rate-15", "rate-15"]);
      }
    });
  }
}
