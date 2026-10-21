import { test as base, expect } from "@playwright/test";

const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const publicOrigin = "https://www.freelance-ops.site";
const test = base.extend({
  page: async ({ page }, runTest) => {
    const errors = [];
    const unexpected = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v2/notices") return route.fulfill({ json: [] });
      if (url.origin === localOrigin && !url.pathname.startsWith("/api/")) return route.continue();
      unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await runTest(page);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  }
});
const titles = { ko: "프리랜서를 위한 AI 견적서 작성 | Freelance Ops", en: "AI quote drafting for freelancers | Freelance Ops" };
async function open(page, locale) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(locale => { localStorage.setItem("freelance-ops-ui-locale-v1", locale); localStorage.setItem("theme", "dark"); }, locale);
  await page.goto("/");
  await expect(page).toHaveTitle(titles[locale]);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await page.evaluate(() => document.fonts.ready);
}
for (const locale of ["ko", "en"]) test(`${locale} landing copy fits desktop/mobile and keeps one canonical`, async ({ page }, testInfo) => {
  await open(page, locale);
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const description = page.locator("#product > p").nth(1);
    await expect(description).toContainText(locale === "ko" ? "프리랜서를 위한 AI 견적서 작성." : "AI quote drafting for freelancers.");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", publicOrigin);
    // ResizeObserver가 요청한 WebGL 투영도 새 화면 크기에 반영된 뒤 측정한다.
    await expect(async () => {
      const geometry = await page.locator("#product").evaluate(node => {
        const description = node.querySelectorAll("p")[1];
        const rect = description.getBoundingClientRect();
        const actions = node.querySelector(".hero-actions").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, left: rect.left, right: rect.right, viewport: innerWidth, gap: actions.top - rect.bottom };
      });
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.gap).toBeGreaterThanOrEqual(0);
    }).toPass({ timeout: 3000 });
    if ([1440, 390].includes(width)) await page.screenshot({ path: testInfo.outputPath(`search-copy-${locale}-${width}.png`), fullPage: true });
  }
});

test("home title follows repeated language switches and delayed metadata replacement", async ({ page }) => {
  await open(page, "ko");
  for (const locale of ["en", "ko", "en"]) {
    await page.locator(".home-language-trigger").click();
    await page.getByRole("option", { name: locale === "en" ? "English" : "한국어" }).click();
    await expect(page).toHaveTitle(titles[locale]);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", publicOrigin);
    await page.evaluate(title => { const node = document.createElement("title"); node.textContent = title; document.head.querySelector("title").replaceWith(node); }, titles.ko);
    await expect(page).toHaveTitle(titles[locale]);
  }
});

test("notices keeps its own canonical and localized title across client navigation", async ({ page }) => {
  await open(page, "en");
  await page.goto("/notices");
  await expect(page).toHaveTitle("Service notices | Freelance Ops");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${publicOrigin}/notices`);
  await page.getByRole("combobox").selectOption("ko");
  await expect(page).toHaveTitle("운영 공지 | Freelance Ops");
  await page.locator(".notice-header a").click();
  await expect(page).toHaveTitle(titles.ko);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", publicOrigin);
  await page.goBack();
  await expect(page).toHaveTitle("운영 공지 | Freelance Ops");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${publicOrigin}/notices`);
});
