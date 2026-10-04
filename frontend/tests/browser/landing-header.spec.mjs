import { test as base, expect } from "@playwright/test";

const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const test = base.extend({
  page: async ({ page }, runTest) => {
    const errors = [];
    const external = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === localOrigin && !url.pathname.startsWith("/api/")) return route.continue();
      external.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await runTest(page);
    expect(external, "Header interactions must not contact real services").toEqual([]);
    expect(errors, "Browser runtime errors").toEqual([]);
  }
});

async function openLanding(page, { locale = "ko", theme = "dark" } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(values => {
    localStorage.setItem("theme", values.theme);
    localStorage.setItem("freelance-ops-ui-locale-v1", values.locale);
  }, { locale, theme });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(() => document.fonts.ready);
}

async function expectHeaderGeometry(page) {
  const geometry = await page.locator(".nav-shell").evaluate(shell => {
    const viewport = document.documentElement.clientWidth;
    const bounds = shell.getBoundingClientRect();
    const inner = shell.querySelector(".nav-inner").getBoundingClientRect();
    const controls = [...shell.querySelectorAll(".brand, .home-menu-toggle, .nav-actions > *, .nav-links a")]
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width && rect.height);
    return {
      left: bounds.left, right: bounds.right, viewport,
      innerLeft: inner.left, innerRight: inner.right,
      overflow: document.documentElement.scrollWidth - viewport,
      clipped: controls.filter(({ element, rect }) => rect.left < 12 || rect.right > viewport - 12 || element.scrollWidth > element.clientWidth + 1).map(({ element }) => element.className),
      overlapping: controls.flatMap(({ rect }, index) => controls.slice(index + 1).filter(other => Math.min(rect.right, other.rect.right) - Math.max(rect.left, other.rect.left) > 1 && Math.min(rect.bottom, other.rect.bottom) - Math.max(rect.top, other.rect.top) > 1).map(() => index))
    };
  });
  expect(geometry.left).toBeCloseTo(0, 1);
  expect(geometry.right).toBeCloseTo(geometry.viewport, 1);
  expect(geometry.innerLeft).toBeGreaterThanOrEqual(16);
  expect(geometry.viewport - geometry.innerRight).toBeGreaterThanOrEqual(16);
  expect(geometry.clipped).toEqual([]);
  expect(geometry.overlapping).toEqual([]);
  expect(geometry.overflow).toBe(0);
}

for (const locale of ["ko", "en"]) for (const theme of ["dark", "light"]) {
  test(`header backdrop and controls stay within wide/narrow ${locale} ${theme} viewports`, async ({ page }, testInfo) => {
    await openLanding(page, { locale, theme });
    for (const width of [2560, 1895, 1440, 1201, 1200, 1024, 821, 820, 590, 390, 320, 295, 1895]) {
      await page.setViewportSize({ width, height: 900 });
      await expectHeaderGeometry(page);
      await page.locator(".home-language-trigger").click();
      await expect(page.getByRole("listbox")).toBeVisible();
      const box = await page.getByRole("listbox").boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(12);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 12);
      if ([1895, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`header-${locale}-${theme}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.locator(".home-language-trigger")).toBeFocused();
    }
    await expect(page.locator(".spatial-hero-light")).toBeVisible();
    await expect(page.locator(".spatial-hero-light path").first()).toBeVisible();
    await page.evaluate(() => scrollTo(0, 700));
    await expectHeaderGeometry(page);
    await expect(page.locator(".nav-shell")).toHaveCSS("position", "fixed");
  });
}

test("language listbox supports arrows, selection, Escape, outside click, Tab and repeat openings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openLanding(page);
  const trigger = page.locator(".home-language-trigger");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeFocused();
  await expect(page.getByRole("option", { name: "한국어" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(trigger).toBeFocused();
  await trigger.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await trigger.press("Enter");
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await trigger.click();
  await page.locator(".brand").click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
  await trigger.click();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.locator(".nav-actions > .icon-button")).toBeFocused();
  await page.locator(".home-menu-toggle").click();
  await trigger.click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(page.locator(".home-menu-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toBeFocused();
  await expect(page.locator(".nav-links")).toBeVisible();
  await page.locator(".home-menu-toggle").press("Escape");
  await expect(page.locator(".home-menu-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".home-menu-toggle")).toBeFocused();
});

test("landing English preference stays local when entering the unchanged workspace and returning", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLanding(page);
  await page.locator(".home-language-trigger").click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Freelance Ops | Evidence-based estimates");
  await expect(page.locator("body > .skip-link")).toHaveText("Skip to main content");
  await page.locator(".nav-actions .text-link").click();
  await expect(page).toHaveURL(/\/workspace/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.locator("body > .skip-link")).toHaveText("본문으로 건너뛰기");
  await expect(page).toHaveTitle("Freelance Ops | 근거 있는 견적 운영");
  await expect(page.locator(".home-language")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".home-language-trigger")).toHaveText("English");
  await expect(page.locator("body > .skip-link")).toHaveText("Skip to main content");
  await expect(page).toHaveTitle("Freelance Ops | Evidence-based estimates");
});
