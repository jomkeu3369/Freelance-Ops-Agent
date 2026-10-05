import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const outline = locator => locator.evaluate(node => { const style = getComputedStyle(node); return style.outlineStyle === "none" ? "0px" : style.outlineWidth; });

for (const width of [320, 390, 1440]) test(`${width}px composer: quiet pointer states, keyboard focus, dismissals and preserved draft`, async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width, height: 844 });
  await page.goto(path);
  const input = page.locator("#agent-chat-input");
  await input.fill("Exact draft"); await input.press("Enter"); await input.press("a");
  await expect(input).toHaveValue("Exact draft\na");
  await expect(page.getByText("Enter로 줄바꿈 · Ctrl/⌘ + Enter로 보내기. 초안은 이 탭에 저장됩니다.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".chat-credit-notice")).toHaveCount(0);
  const model = page.locator(".chat-model-trigger");
  await model.click();
  await expect(model).toHaveAttribute("aria-expanded", "true");
  expect(await outline(model)).toBe("0px");
  await expect(model).toBeFocused();
  await page.locator(".chat-model-popover").screenshot({ path: `outputs/ui-ux/controls-model-${width}.png` });
  await page.keyboard.press("Escape");
  await expect(model).toHaveAttribute("aria-expanded", "false");
  expect(await outline(model)).toBe("2px");
  await model.press("ArrowDown");
  await expect(page.getByLabel("AI 연결", { exact: true })).toBeFocused();
  expect(await page.getByLabel("AI 연결", { exact: true }).evaluate(node => getComputedStyle(node).boxShadow)).toBe("none");
  await page.keyboard.press("Escape");
  const gear = page.getByRole("button", { name: "AI 설정 열기", exact: true });
  await gear.hover(); await expect(page.getByRole("tooltip", { name: "AI 설정", exact: true })).toBeVisible();
  expect(await gear.innerText()).toBe("");
  const box = await gear.boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  await gear.click(); await expect(page.getByRole("dialog", { name: "AI 설정", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(gear).toBeFocused();
  await expect(input).toHaveValue("Exact draft\na");
  await page.reload(); await expect(input).toHaveValue("Exact draft\na");
  expect(state.starts).toEqual([]); expect(state.writes).toEqual([]);
  await page.screenshot({ path: `outputs/ui-ux/controls-composer-${width}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await input.press("Control+Enter"); await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].requirementText).toBe("Exact draft\na");
});

test("credit ring uses server capacity and supports hover, focus, Escape and outside dismissal", async ({ page }) => {
  const state = await fixture(page); Object.assign(state.aiUsage, { limitUsd: "2.40", settledUsd: "0.4", reservedUsd: "0.2", remainingUsd: "1.8", remainingPercent: "75", reservedPercent: "8.333333333333" });
  await page.goto(path);
  const credit = page.locator(".chat-credit-trigger");
  await expect(credit).toHaveAccessibleName(/75%/);
  await expect(credit.locator(".chat-credit-progress")).toHaveAttribute("stroke-dasharray", "75 100");
  await expect(page.locator(".chat-credit-popover")).toHaveCount(0);
  const details = page.locator(".chat-credit-popover");
  await credit.hover(); await expect(details).toContainText("진행 중 예약 ≈8.33%");
  await expect(details).toContainText("8.333333333333%"); await expect(details).toContainText("다음 초기화");
  await details.hover(); await expect(details).toBeVisible();
  await page.keyboard.press("Escape"); await expect(details).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "AI 설정 열기", exact: true }).focus(); await page.keyboard.press("Tab");
  await expect(credit).toBeFocused(); await expect(details).toBeVisible();
  expect(await outline(credit)).toBe("2px");
  await page.screenshot({ path: "outputs/ui-ux/controls-credit-focus.png" });
  await page.locator(".workspace-page-label").click(); await expect(details).toHaveCount(0);
});

for (const scenario of ["zero", "exhausted", "unknown", "loading", "failure"]) test(`credit ring never invents a balance: ${scenario}`, async ({ page }) => {
  const state = await fixture(page);
  if (scenario === "zero") Object.assign(state.aiUsage, { limitUsd: "0", settledUsd: "0", reservedUsd: "0", remainingUsd: "0", remainingPercent: null, reservedPercent: null });
  if (scenario === "exhausted") Object.assign(state.aiUsage, { settledUsd: "1.25", reservedUsd: "0", remainingUsd: "0", remainingPercent: "0", reservedPercent: "0" });
  if (scenario === "unknown") state.aiUsage = { remainingPercent: 75 };
  if (scenario === "failure") state.aiUsageStatus = 503;
  if (scenario === "loading") await page.route("**/api/v2/me/ai-usage", () => {});
  await page.goto(path); await page.locator("#agent-chat-input").fill("Do not send");
  const credit = page.locator(".chat-credit-trigger");
  if (scenario === "zero") await expect(credit).toHaveAccessibleName(/한도가 설정되지/);
  else if (scenario === "exhausted") await expect(credit.locator(".chat-credit-progress")).toHaveAttribute("stroke-dasharray", "0 100");
  else await expect(credit).toHaveAccessibleName(scenario === "loading" ? /확인 중/ : /확인 필요/);
  if (scenario !== "exhausted") await expect(credit.locator(".chat-credit-progress")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  expect(state.starts).toEqual([]);
});

test("usage history retains precise costs, unconfirmed reservations, pagination and focus restoration", async ({ page }) => {
  const state = await fixture(page);
  const entry = { runId: "ledger-one", workspaceId: "local-space", model: "server-model", status: "UNKNOWN", startedAt: "2026-10-05T00:00:00Z", platformCostUsd: null, platformReservedUsd: "0.000123456789", usageKnown: false, byokInputTokens: 25, byokOutputTokens: 10 };
  state.aiHistory = { items: [entry], nextCursor: "page-two" };
  await page.goto(path); const trigger = page.locator(".chat-credit-trigger");
  await trigger.hover(); await page.getByRole("button", { name: "사용 내역", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "사용 내역", exact: true });
  await expect(panel).toContainText("0.000123456789"); await expect(panel).toContainText("사용량 미확정 · 예약 유지");
  state.aiHistory = { items: [{ ...entry, runId: "ledger-two", usageKnown: true, platformCostUsd: "0.000009" }], nextCursor: null };
  await panel.getByRole("button", { name: "더 보기" }).click(); await expect(panel.locator("li")).toHaveCount(2);
  await page.screenshot({ path: "outputs/ui-ux/controls-usage-history.png" });
  await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(page.locator(".chat-credit-popover")).toHaveCount(0);
  state.aiHistoryStatus = 503;
  await trigger.click(); await page.getByRole("button", { name: "사용 내역", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("불러오지 못했습니다");
});

test("server model constraints and spending pause prevent unpriced generation", async ({ page }) => {
  const state = await fixture(page); state.aiUsage.spendingEnabled = false;
  state.aiUsage.models[0].reasoningEfforts = ["medium", "high"];
  await page.goto(path); await page.locator("#agent-chat-input").fill("Do not run while paused");
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await expect(page.locator(".chat-credit-notice")).toContainText("중지되어");
  await page.locator(".chat-model-trigger").click();
  await expect(page.locator(".chat-model-popover")).toContainText("예약 상한 $0.25");
  await expect(page.locator(".chat-model-popover")).toContainText("예상 실제 비용이 아닙니다");
  await expect(page.locator(".chat-model-popover")).toContainText("medium, high");
  expect(state.starts).toEqual([]);
});

test("language menu supports checked state, arrows, selection, Escape, outside click and persistence", async ({ page }) => {
  await fixture(page); await page.goto(path);
  const trigger = page.locator(".workspace-language-trigger");
  await expect(trigger).toHaveText("KO");
  await trigger.focus(); await trigger.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "KO 한국어" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("End"); await expect(page.getByRole("menuitemradio", { name: "EN English" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText("EN"); await expect(trigger).toBeFocused(); await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await trigger.press("ArrowUp"); await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await trigger.click(); await expect(page.getByRole("menuitemradio", { name: "EN English" })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "outputs/ui-ux/controls-language-en.png" });
  await page.locator("#agent-chat-input").click(); await expect(page.getByRole("menu")).toHaveCount(0);
  await page.reload(); await expect(trigger).toHaveText("EN");
  await trigger.click(); await page.getByRole("menuitemradio", { name: "KO 한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

test("mobile tap toggles credit details and language menu without overflow", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); await fixture(page); await page.goto(path);
  try {
    const credit = page.locator(".chat-credit-trigger");
    await expect(credit).toHaveAccessibleName(/80%/);
    await credit.tap(); await expect(page.locator(".chat-credit-popover")).toBeVisible();
    await page.screenshot({ path: "outputs/ui-ux/controls-mobile-credit.png" });
    await credit.tap(); await expect(page.locator(".chat-credit-popover")).toHaveCount(0);
    await credit.tap(); await page.locator(".workspace-page-label").tap(); await expect(page.locator(".chat-credit-popover")).toHaveCount(0);
    await page.locator(".workspace-language-trigger").tap();
    await page.getByRole("menuitemradio", { name: "EN English" }).tap();
    await expect(page.locator(".workspace-language-trigger")).toHaveText("EN");
    await page.locator(".workspace-language-trigger").tap();
    await page.screenshot({ path: "outputs/ui-ux/controls-mobile-language.png" });
    const box = await page.getByRole("menu").boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
    await page.locator("#agent-chat-input").tap(); await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  } finally { await context.close(); }
});
