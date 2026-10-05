import { test, expect } from "@playwright/test";

const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
async function openAuth(page, { locale = "ko", theme = "light", reduced = false } = {}) {
  const blocked = [];
  page.on("pageerror", error => blocked.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
    blocked.push(url.pathname); return route.abort();
  });
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.goto("/workspace/projects");
  await page.getByRole("combobox").selectOption(locale);
  return blocked;
}

for (const theme of ["light", "dark"]) {
  test(`desktop ${theme}: form is right-aligned and header blends into the scene shell`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const blocked = await openAuth(page, { theme });
    const panel = await page.locator(".auth-panel").boundingBox();
    const message = await page.locator(".auth-scene-space").boundingBox();
    const header = await page.locator(".auth-header-actions").boundingBox();
    expect(panel.x).toBeGreaterThan(1440 * .55);
    expect(message.x + message.width).toBeLessThan(panel.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(1440);
    expect(header.x + header.width).toBeLessThanOrEqual(1440);
    await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "absent");
    await expect(page.locator(".auth-backdrop video")).toBeHidden();
    await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "업무 공간 열기", exact: true })).toBeVisible();
    await page.screenshot({ path: `outputs/ui-ux/login-cinematic-${theme}-desktop.png`, fullPage: true });
    expect(blocked).toEqual([]);
  });
}

for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
  test(`form-first ${width}x${height}: both languages and signup stay scrollable without sideways overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const blocked = await openAuth(page, { locale: "en", reduced: true });
    await expect(page.getByRole("heading", { name: "Welcome back.", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('input[name="email"]').fill("fixture@example.invalid");
    await page.locator('input[name="password"]').fill("synthetic-password-only");
    await page.getByRole("tab", { name: "Sign up", exact: true }).click();
    await expect(page.locator('input[name="ageAtLeast14"]')).not.toBeChecked();
    await page.locator('input[name="passwordConfirm"]').scrollIntoViewIfNeeded();
    await expect(page.locator('input[name="passwordConfirm"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.getByRole("tab", { name: "Log in", exact: true }).click();
    await page.getByRole("combobox").selectOption("ko");
    await expect(page.getByRole("heading", { name: "다시 만나 반가워요.", exact: true })).toBeVisible();
    await expect(page.locator(".auth-backdrop video")).toBeHidden();
    await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
    await page.screenshot({ path: `outputs/ui-ux/login-cinematic-${width}x${height}.png`, fullPage: true });
    expect(blocked).toEqual([]);
  });
}
