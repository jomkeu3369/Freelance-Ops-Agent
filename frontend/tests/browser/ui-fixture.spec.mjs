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
  await page.locator('.agent-chat-composer button[type="submit"]').click();
  await expect(page.locator(".agent-chat .form-error")).toContainText("AI를 호출하거나 변경사항을 저장하지 않습니다");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem("freelance-ops-session-v1"))).toBeNull();
});
