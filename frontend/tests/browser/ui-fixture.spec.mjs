import { test, expect } from "@playwright/test";

for (const width of [390, 1440]) test(`standalone real-component fixture at ${width}px makes no API requests`, async ({ page }) => {
  const requests = [];
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.goto("/ui-preview/fullscreen-chat");
  await expect(page.locator('[data-ui-fixture="synthetic-only"]')).toBeVisible();
  await expect(page.locator("[data-ui-fixture-label]")).toContainText("샘플 데이터");
  await expect(page.locator("#agent-chat-input")).toBeInViewport();
  await page.screenshot({ path: `outputs/ui-ux/fixture-fullscreen-${width}.png`, fullPage: false });
  await page.locator("#agent-chat-input").fill("Synthetic request that must not be sent");
  await page.locator(".chat-model-trigger").click();
  const menu = page.getByRole("dialog", { name: "AI 모델 선택", exact: true });
  await expect(menu.getByLabel("AI 모델", { exact: true })).toBeVisible();
  const options = await menu.getByLabel("AI 모델", { exact: true }).locator("option").evaluateAll(items => items.map(item => item.value));
  await menu.getByLabel("AI 모델", { exact: true }).selectOption(options.at(-1));
  await page.keyboard.press("Escape");
  await expect(page.locator(".chat-model-trigger")).toContainText(options.at(-1));
  await expect(page.locator("#agent-chat-input")).toHaveValue("Synthetic request that must not be sent");
  await page.locator('.agent-chat-composer button[type="submit"]').click();
  await expect(page.locator(".agent-chat .form-error")).toContainText("AI를 호출하거나 변경사항을 저장하지 않습니다");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem("freelance-ops-session-v1"))).toBeNull();
});
