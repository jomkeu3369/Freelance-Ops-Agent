import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

async function openSettings(page, { width = 1440, theme = "light", locale = "ko", usage = {} } = {}) {
  await page.setViewportSize({ width, height: 1000 });
  const state = await fixture(page);
  Object.assign(state.usage, { resetAt: "2026-10-25T15:00:00Z", ...usage });
  await page.addInitScript(({ theme, locale }) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("freelance-ops-ui-locale-v1", locale);
  }, { theme, locale });
  await page.goto("/workspace/settings");
  const summary = page.getByRole("region", { name: locale === "en" ? "Weekly credits" : "주간 크레딧", exact: true });
  await expect(summary.getByRole("meter")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { state, summary };
}

for (const [width, theme, locale] of [
  [1440, "light", "ko"], [1024, "light", "ko"], [760, "light", "en"],
  [390, "light", "ko"], [320, "dark", "ko"], [1440, "dark", "en"]
]) {
  test(`${width}px ${theme} ${locale}: approved credit layout stays readable and contained`, async ({ page }) => {
    const { summary } = await openSettings(page, { width, theme, locale });
    await expect(summary.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
    await expect(summary.locator(".weekly-credit-reset")).toContainText(locale === "en" ? "Oct 26, 2026" : "2026년 10월 26일");
    await expect(summary.getByRole("button", { name: locale === "en" ? "Check again" : "다시 확인", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await summary.locator("h2, .weekly-credit-label, .weekly-credit-amount, dt, dd, .weekly-credit-reset strong, .weekly-credit-reset p").evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
    expect(overflow).toEqual([]);
    if (locale === "en") expect(await summary.innerText()).not.toMatch(/[가-힣]/);
    if (width === 1440 && theme === "light") await page.screenshot({ path: "outputs/ui-ux/settings-credit-desktop.png" });
    if (width === 390) await summary.screenshot({ path: "outputs/ui-ux/settings-credit-mobile.png" });
    if (width === 1440 && theme === "dark") await page.screenshot({ path: "outputs/ui-ux/settings-credit-dark.png" });
  });
}

test("refresh uses the server's remaining balance after reservations and hides unverified values while loading", async ({ page }) => {
  const { state, summary } = await openSettings(page, { usage: { used: 65, reserved: 15, remaining: 20 } });
  await expect(summary.getByRole("meter")).toHaveAttribute("aria-valuenow", "20");
  await expect(summary.locator(".weekly-credit-fill")).toHaveAttribute("stroke-dashoffset", "80");
  await expect(summary.locator(".weekly-credit-metrics dd")).toHaveText(["65", "15"]);
  const barrier = requestBarrier();
  await page.route("**/api/v2/usage/free", async route => {
    await barrier.wait();
    return route.fulfill({ json: state.usage });
  });
  Object.assign(state.usage, { used: 80, reserved: 10, remaining: 10 });
  const refresh = summary.getByRole("button", { name: "다시 확인", exact: true });
  await refresh.click();
  await barrier.entered;
  await expect(refresh).toBeDisabled();
  await expect(summary.getByRole("meter")).toHaveCount(0);
  await expect(summary.locator(".weekly-credit-amount")).toHaveCount(0);
  await expect(summary.getByRole("status")).toContainText("확인 중");
  barrier.release();
  await expect(summary.getByRole("meter")).toHaveAttribute("aria-valuenow", "10");
  await expect(summary.locator(".weekly-credit-metrics dd")).toHaveText(["80", "10"]);
  expect(state.writes).toEqual([]);
});

test("failed refresh removes stale credit values and the refresh button recovers without navigation", async ({ page }) => {
  const { state, summary } = await openSettings(page);
  state.usageStatus = 503;
  await summary.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(summary.getByRole("status")).toContainText("확인하지 못했습니다");
  await expect(summary.getByRole("meter")).toHaveCount(0);
  await expect(summary.locator(".weekly-credit-amount")).toHaveCount(0);
  state.usageStatus = 200;
  await summary.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(summary.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
});

test("zero capacity is paused with an empty gauge and administration remains capability-gated", async ({ page }) => {
  const { state, summary } = await openSettings(page, { usage: { limit: 0, used: 0, reserved: 0, remaining: 0 } });
  await expect(summary.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  await expect(summary.locator(".weekly-credit-fill")).toHaveAttribute("opacity", "0");
  await expect(summary.getByRole("status")).toContainText("일시 중지");
  await expect(summary.getByRole("link", { name: "사이트 관리자" })).toHaveCount(0);
  state.usage.canManage = true;
  await summary.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(summary.getByRole("link", { name: "사이트 관리자" })).toHaveAttribute("href", "/admin");
});

test("large balances and English labels fit a narrow screen", async ({ page }) => {
  const { summary } = await openSettings(page, { width: 320, locale: "en", usage: { limit: 100000, remaining: 100000 } });
  await expect(summary.locator(".weekly-credit-amount > strong")).toHaveText("100,000");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await summary.locator(".weekly-credit-amount").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
