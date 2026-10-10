import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const path = "/workspace/settings";
const rate = (id, name = id) => ({ id, name, workspaceId: "local-space", unit: "HOUR", rate: 100, minimumAmount: 0, currency: "KRW", active: true, version: 1 });
async function settingsFixture(page, initial = []) {
  const state = await fixture(page);
  const server = { cards: initial, writes: [], policyWrites: [], loseRateResponse: false, failPolicy: false, nextRate: null };
  await page.route("**/api/v2/workspaces/local-space/rate-cards**", async route => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: server.cards });
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
    if (route.request().method() === "GET") return route.fulfill({ json: state.policy });
    const input = route.request().postDataJSON(); server.policyWrites.push(input);
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
