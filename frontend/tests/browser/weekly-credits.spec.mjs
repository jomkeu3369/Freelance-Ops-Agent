import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";
const path = "/workspace/projects/project-one/agent";
const send = page => page.getByRole("button", { name: "보내기", exact: true });

test("new included AI ignores legacy credits and sends no fixed-price quote", async ({ page }) => {
  const state = await fixture(page);
  state.usageStatus = 503;
  Object.assign(state.aiUsage, { remainingUsd: "0.000001", remainingPercent: "0.00008" });
  await page.goto(path); await page.locator("#agent-chat-input").fill("Small residual budget remains server-authorized");
  await expect(page.getByRole("button", { name: "주간 크레딧", exact: true })).toHaveCount(0);
  await expect(send(page)).toBeEnabled(); await send(page).click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].creditQuote).toBeUndefined();
});

test("missing actual usage blocks included AI while explicit BYOK stays distinct", async ({ page }) => {
  const state = await fixture(page); state.aiUsageStatus = 503;
  state.connections = [{ id: "personal-key", provider: "OPENAI", model: "personal-model", maskedKey: "synthetic…key", updatedAt: "2026-10-01T00:00:00Z" }];
  await page.goto(path); await page.locator("#agent-chat-input").fill("Keep this exact request");
  await expect(send(page)).toBeDisabled();
  await page.locator(".chat-model-trigger").click();
  const menu = page.getByRole("dialog", { name: "AI 모델 선택", exact: true });
  await menu.getByLabel("AI 연결", { exact: true }).selectOption("personal-key");
  await expect(menu).toContainText("플랫폼이 처리하는 라우팅 비용은 주간 예산에 포함");
  await page.keyboard.press("Escape");
  await send(page).click(); await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].creditQuote).toBeUndefined();
  expect(state.starts[0].modelSelection.credentialId).toBe("personal-key");
});

test("ambiguous retry retains its original body and key after the server reserves the balance", async ({ page }) => {
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
  Object.assign(state.aiUsage, { remainingUsd: "0", remainingPercent: "0", reservedUsd: "1.25", reservedPercent: "100" });
  await page.locator(".chat-credit-trigger").click();
  await page.locator(".chat-credit-popover").getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(page.locator(".chat-credit-trigger")).toHaveAccessibleName(/0%/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".agent-chat-credit-note")).toContainText("원래 확인한 조건");
  await expect(send(page)).toBeEnabled(); await send(page).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]); expect(created).toBe(1);
});

for (const [status, code] of [[429, "PLATFORM_SPEND_EXHAUSTED"], [503, "PLATFORM_SPEND_DISABLED"]]) {
  test(`${code} preserves draft and requires explicit user recovery`, async ({ page }) => {
    await fixture(page); const attempts = [];
    await page.route("**/agent-runs", route => {
      if (route.request().method() !== "POST") return route.fallback();
      attempts.push(route.request().postDataJSON());
      return route.fulfill({ status, json: { code, message: "Synthetic operating guard" } });
    });
    await page.goto(path); await page.locator("#agent-chat-input").fill("Preserved behind the operating guard"); await send(page).click();
    await expect(page.locator(".agent-chat .form-error")).toContainText("계정·운영 예산이 부족");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#agent-chat-input")).toHaveValue("Preserved behind the operating guard");
    expect(attempts).toHaveLength(1);
    await expect(page.locator(".agent-chat-credit-note")).toHaveCount(0);
  });
}

test("exhausted monetary budget blocks AI but deterministic settings still require approval", async ({ page }) => {
  const state = await fixture(page);
  Object.assign(state.aiUsage, { remainingUsd: "0", remainingPercent: "0" });
  await page.goto(path); await page.locator("#agent-chat-input").fill("A new analysis");
  await expect(page.locator(".agent-chat-credit-note")).toContainText("주간 잔여 예산이 없습니다");
  await expect(send(page)).toBeDisabled();
  await page.locator("#agent-chat-input").fill("기본 세율 12%로 변경");
  await expect(page.locator(".agent-chat-credit-note")).toContainText("주간 한도 차감 없음");
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
