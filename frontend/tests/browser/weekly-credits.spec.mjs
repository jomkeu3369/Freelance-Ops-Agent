import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";
const path = "/workspace/projects/project-one/agent";
const send = page => page.getByRole("button", { name: "보내기", exact: true });

test("legacy usage blocks included AI while explicit BYOK remains available without a credit quote", async ({ page }) => {
  const state = await fixture(page);
  state.usage = { limit: 5, used: 1, reserved: 0, remaining: 4, resetAt: "2026-11-01T00:00:00Z" };
  state.connections = [{ id: "personal-key", provider: "OPENAI", model: "personal-model", maskedKey: "synthetic…key", updatedAt: "2026-10-01T00:00:00Z" }];
  await page.goto(path); await page.locator("#agent-chat-input").fill("Keep this exact request");
  await expect(page.locator(".agent-chat-credit-note")).toContainText("크레딧 가격을 확인한 뒤");
  await expect(send(page)).toBeDisabled();
  expect(state.starts).toEqual([]);
  await page.locator(".chat-model-trigger").click();
  await page.getByRole("dialog", { name: "AI 모델 선택", exact: true }).getByLabel("AI 연결", { exact: true }).selectOption("personal-key");
  await page.keyboard.press("Escape");
  await expect(page.locator(".agent-chat-credit-note")).toContainText("제공사 계정에 사용 요금");
  await send(page).click(); await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].creditQuote).toBeUndefined();
  expect(state.starts[0].modelSelection.credentialId).toBe("personal-key");
});

for (const [status, code] of [[428, "CREDIT_QUOTE_REQUIRED"], [409, "CREDIT_QUOTE_STALE"]]) {
  test(`${code} refreshes price but requires a new explicit Send and key`, async ({ page }) => {
    const state = await fixture(page); const attempts = [];
    await page.route("**/agent-runs", async route => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON(); attempts.push({ body, key: route.request().headers()["idempotency-key"] });
      if (attempts.length > 1) return route.fallback();
      state.usage.pricingUpdatedAt = "2026-10-04T12:01:00.654321Z";
      state.usage.modelRates = state.usage.modelRates.map(rate => rate.model === body.modelSelection.model ? { ...rate, credits: 20 } : rate);
      return route.fulfill({ status, json: { code, message: "Synthetic quote rejection" } });
    });
    await page.goto(path); await page.locator("#agent-chat-input").fill("Price needs confirmation");
    await send(page).click();
    await expect(page.locator(".agent-chat .form-error")).toContainText("새 차감량을 검토");
    await expect(page.locator(".agent-chat-credit-note")).toContainText("20 크레딧");
    await expect(page.locator("#agent-chat-input")).toHaveValue("Price needs confirmation");
    expect(attempts).toHaveLength(1); expect(state.starts).toHaveLength(0);
    await send(page).click(); await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[1].body.creditQuote).toEqual({ credits: 20, pricingUpdatedAt: "2026-10-04T12:01:00.654321Z" });
    expect(attempts[1].key).not.toBe(attempts[0].key);
  });
}

test("ambiguous retry retains its original body and key after a newer price and exhausted balance", async ({ page }) => {
  const state = await fixture(page); const attempts = []; let created = 0;
  await page.route("**/agent-runs", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON(); attempts.push({ body, key: route.request().headers()["idempotency-key"] });
    if (attempts.length === 1) {
      created++;
      state.run = { runId: "accepted-once", status: "RUNNING", activeDepartment: null, interruption: null, result: null, metadata: null, updatedAt: "2026-10-04T12:00:00Z" };
      state.history = [{ runId: "accepted-once", status: "RUNNING", requirementText: body.requirementText, createdAt: state.run.updatedAt }];
      return route.fulfill({ status: 503, json: { code: "TEMPORARY", message: "Synthetic lost response" } });
    }
    return route.fulfill({ status: 202, json: { runId: "accepted-once", status: "RUNNING", acceptedAt: state.run.updatedAt } });
  });
  await page.goto(path); await page.locator("#agent-chat-input").fill("Same original request"); await send(page).click();
  await expect(page.locator(".agent-chat .form-error")).toBeVisible();
  state.usage.remaining = 0; state.usage.reserved = 100;
  state.usage.pricingUpdatedAt = "2026-10-04T12:02:00.999999Z";
  state.usage.modelRates = state.usage.modelRates.map(rate => ({ ...rate, credits: 100 }));
  await page.getByRole("button", { name: "주간 크레딧", exact: true }).click();
  const usage = page.getByRole("dialog", { name: "주간 크레딧", exact: true });
  await usage.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(usage).toContainText("0 / 100 크레딧"); await page.keyboard.press("Escape");
  await expect(page.locator(".agent-chat-credit-note")).toContainText("원래 확인한 10 크레딧");
  await expect(send(page)).toBeEnabled(); await send(page).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]); expect(created).toBe(1);
});

for (const [status, code] of [[429, "PLATFORM_SPEND_EXHAUSTED"], [503, "PLATFORM_SPEND_DISABLED"]]) {
  test(`${code} explains operating limits without a credit-exhaustion dialog or automatic retry`, async ({ page }) => {
    await fixture(page); const attempts = [];
    await page.route("**/agent-runs", route => {
      if (route.request().method() !== "POST") return route.fallback();
      attempts.push(route.request().postDataJSON());
      return route.fulfill({ status, json: { code, message: "Synthetic operating guard" } });
    });
    await page.goto(path); await page.locator("#agent-chat-input").fill("Preserved behind the operating guard"); await send(page).click();
    await expect(page.locator(".agent-chat .form-error")).toContainText("사용자 크레딧 소진과는 별개");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#agent-chat-input")).toHaveValue("Preserved behind the operating guard");
    expect(attempts).toHaveLength(1);
    await expect(page.locator(".agent-chat-credit-note")).not.toContainText("접수 여부가 불확실");
  });
}

test("model price and remaining credits govern included AI, while deterministic settings still require approval", async ({ page }) => {
  const state = await fixture(page); state.usage.remaining = 70; state.usage.used = 30;
  await page.goto(path); await page.locator("#agent-chat-input").fill("A new analysis");
  await page.locator(".chat-model-trigger").click();
  const menu = page.getByRole("dialog", { name: "AI 모델 선택", exact: true });
  await menu.getByLabel("AI 모델", { exact: true }).selectOption("gpt-5.6-terra"); await page.keyboard.press("Escape");
  await expect(page.locator(".agent-chat-credit-note")).toContainText("100 크레딧 필요 · 70 크레딧 남음");
  await expect(send(page)).toBeDisabled();
  await page.locator("#agent-chat-input").fill("기본 세율 12%로 변경");
  await expect(page.locator(".agent-chat-credit-note")).toContainText("AI 크레딧 차감 없음");
  await send(page).click(); await expect(page.locator(".agent-chat-policy")).toBeVisible();
  expect(state.confirms).toBe(0); expect(state.starts).toEqual([]);
});

test("administrator model prices require a reviewed version and explicit approval", async ({ page }) => {
  const state = await fixture(page);
  const settings = { unit: "CREDITS", periodType: "WEEKLY", modelRates: structuredClone(state.usage.modelRates), limit: 100, maxLimit: 100000, epoch: 7, updatedAt: "2026-10-04T12:00:00.987654Z", lastResetAt: null };
  const writes = [];
  await page.route("**/api/v2/admin/free-usage**", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: settings });
    const body = route.request().postDataJSON(); writes.push(body);
    settings.modelRates = settings.modelRates.map(rate => rate.model === body.model ? { ...rate, credits: body.credits, enabled: body.enabled } : rate);
    settings.updatedAt = "2026-10-04T12:01:00.111111Z";
    return route.fulfill({ json: settings });
  });
  await page.goto("/admin");
  const row = page.locator(".admin-model-rate").filter({ hasText: "gpt-5.6-luna" });
  await row.getByLabel("요청당 크레딧").fill("15"); await row.getByRole("checkbox").uncheck();
  await row.getByRole("button", { name: "모델 가격 변경 검토" }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toContainText("10 → 15 크레딧");
  await expect(dialog.getByRole("button", { name: "모델 가격 변경 승인" })).toBeDisabled(); expect(writes).toEqual([]);
  await dialog.getByRole("checkbox").check(); await dialog.getByRole("button", { name: "모델 가격 변경 승인" }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([{ provider: "OPENAI", model: "gpt-5.6-luna", credits: 15, enabled: false, expectedEpoch: 7, expectedUpdatedAt: "2026-10-04T12:00:00.987654Z" }]);
});
