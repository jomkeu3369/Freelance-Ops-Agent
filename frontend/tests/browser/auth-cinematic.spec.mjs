import { test, expect } from "@playwright/test";
import { localeStorageKey } from "../../app/lib/ui-locale.mjs";

const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
async function expectNaturalPanel(page) {
  for (const selector of [".auth-panel", ".auth-panel form", ".auth-fields"]) {
    const area = page.locator(selector);
    await expect(area).toHaveCSS("overflow-y", "visible");
    await expect(area).toHaveCSS("max-height", "none");
    expect(await area.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  }
}
async function openAuth(page, { locale = "ko", theme = "light", reduced = false } = {}) {
  const blocked = [];
  page.on("pageerror", error => blocked.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
    blocked.push(url.pathname); return route.abort();
  });
  await page.addInitScript(({ theme, locale, key }) => {
    localStorage.setItem("theme", theme); localStorage.setItem(key, locale);
  }, { theme, locale, key: localeStorageKey });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.goto("/workspace/projects");
  await expect(page.locator(".auth-layout")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".auth-layout")).toHaveCSS("border-left-width", "0px");
  await expect(page.locator(".auth-layout")).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".auth-header button, .auth-header select")).toHaveCount(0);
  await expect(page.locator(".auth-header a")).toHaveCount(1);
  await expect(page.locator(".auth-brand")).toHaveAttribute("href", "/");
  return blocked;
}

for (const theme of ["light", "dark"]) {
  test(`desktop ${theme}: scene stays exposed, right form has no nested scrollbar, header has only brand`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const blocked = await openAuth(page, { theme });
    await expect.poll(() => page.locator(".auth-backdrop__poster").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    const panel = await page.locator(".auth-panel").boundingBox();
    const message = await page.locator(".auth-scene-space").boundingBox();
    expect(panel.x).toBeGreaterThan(1440 * .55);
    expect(message.x + message.width).toBeLessThan(panel.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(1440);
    expect(panel.y + panel.height).toBeLessThanOrEqual(900);
    await expectNaturalPanel(page);
    await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "absent");
    await expect(page.locator(".auth-backdrop video")).toBeHidden();
    await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "업무 공간 열기", exact: true })).toBeVisible();
    await page.screenshot({ path: `outputs/ui-ux/login-cinematic-${theme}-desktop.png`, fullPage: true });
    expect(blocked).toEqual([]);
  });
}

for (const locale of ["ko", "en"]) {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
    test(`form-first ${locale} ${width}x${height}: page scrolling keeps signup and keyboard controls reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const blocked = await openAuth(page, { locale, reduced: true });
      const heading = locale === "en" ? "Welcome back." : "다시 만나 반가워요.";
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await expectNaturalPanel(page);
      await page.locator('input[name="email"]').fill("fixture@example.invalid");
      await page.locator('input[name="password"]').fill("synthetic-password-only");
      await page.getByRole("tab", { name: locale === "en" ? "Sign up" : "처음 시작하기", exact: true }).click();
      await expect(page.locator('input[name="ageAtLeast14"]')).not.toBeChecked();
      await page.locator('input[name="passwordConfirm"]').scrollIntoViewIfNeeded();
      await expect(page.locator('input[name="passwordConfirm"]')).toBeVisible();
      await expectNaturalPanel(page);
      await page.locator('button[type="submit"]').scrollIntoViewIfNeeded();
      await expect(page.locator('button[type="submit"]')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.getByRole("tab", { name: locale === "en" ? "Log in" : "로그인", exact: true }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.locator(".auth-backdrop video")).toBeHidden();
      await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
      await page.screenshot({ path: `outputs/ui-ux/login-cinematic-${locale}-${width}x${height}.png`, fullPage: true });
      expect(blocked).toEqual([]);
    });
  }
}

test("project brand returns to home without submitting the login form", async ({ page }) => {
  const blocked = await openAuth(page);
  await page.locator(".auth-brand").click();
  await expect(page).toHaveURL(`${origin}/`);
  expect(blocked).toEqual([]);
});
