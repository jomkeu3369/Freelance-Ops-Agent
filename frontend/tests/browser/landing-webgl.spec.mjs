import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 1000 } });

async function openScene(page, options = {}) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /THREE|WebGL|hydrated/.test(message.text())) errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: options.reduced ? "reduce" : "no-preference" });
  await page.goto("/");
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-ready", "true");
  return errors;
}

async function chartReady(page) {
  const chart = page.locator('[data-webgl-kind="chart"]');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toHaveAttribute("data-webgl-state", "ready", { timeout: 20_000 });
  return chart;
}

test("real GPU surfaces render and scope changes keep accessible totals and projected labels in sync", async ({ page }) => {
  const errors = await openScene(page);
  const hero = page.locator('[data-webgl-kind="hero"]');
  await expect(hero).toHaveAttribute("data-webgl-state", "ready", { timeout: 20_000 });
  const chart = await chartReady(page);
  await expect(chart.locator(".webgl-value")).toHaveText(["5일", "3.5일", "1.5일"]);
  await page.getByRole("button", { name: "예약 변경 추가 13일", exact: true }).click();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toHaveAttribute("data-webgl-values", "5,3.5,1.5,3");
  await expect(chart.locator(".webgl-value")).toHaveText(["5일", "3.5일", "1.5일", "3일"]);
  await expect(page.locator(".story-effort-prisms")).toHaveAttribute("aria-label", /총 13일/);
  const labels = await chart.locator(".webgl-label").evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    const parent = element.closest(".webgl-chart").getBoundingClientRect();
    return { positioned: Number.isFinite(parseFloat(element.style.left)), inside: rect.left >= parent.left && rect.right <= parent.right && rect.bottom <= parent.bottom };
  }));
  expect(labels.every(label => label.positioned && label.inside)).toBe(true);
  await page.locator('[data-story-scene="effort"]').screenshot({ path: "outputs/webgl/desktop-chart.png" });
  expect(errors).toEqual([]);
});

test("offscreen rendering stops and the global pause freezes every scene", async ({ page }) => {
  const errors = await openScene(page);
  const chart = await chartReady(page);
  const hero = page.locator('[data-webgl-kind="hero"]');
  await expect(hero).toHaveAttribute("data-webgl-running", "false");
  const frames = await hero.getAttribute("data-webgl-frames");
  await page.waitForTimeout(200);
  expect(await hero.getAttribute("data-webgl-frames")).toBe(frames);
  await page.getByRole("button", { name: "자동 진행 일시 정지", exact: true }).click();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toHaveAttribute("data-webgl-running", "false");
  // Returning to a paused scene paints one final frame; wait for that redraw
  // before asserting that its continuous loop has stopped.
  await expect.poll(async () => {
    const stopped = await chart.getAttribute("data-webgl-frames");
    await page.waitForTimeout(200);
    return await chart.getAttribute("data-webgl-frames") === stopped;
  }).toBe(true);
  expect(errors).toEqual([]);
});

test("reduced motion renders one complete 3D frame and explicit scope changes still redraw", async ({ page }) => {
  const errors = await openScene(page, { reduced: true });
  const chart = await chartReady(page);
  await expect(chart).toHaveAttribute("data-webgl-running", "false");
  const frames = await chart.getAttribute("data-webgl-frames");
  await page.waitForTimeout(200);
  expect(await chart.getAttribute("data-webgl-frames")).toBe(frames);
  await page.getByRole("button", { name: "예약 변경 추가 13일", exact: true }).click();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator(".webgl-value")).toHaveCount(4);
  await expect(chart).toHaveAttribute("data-webgl-running", "false");
  expect(Number(await chart.getAttribute("data-webgl-frames"))).toBeGreaterThan(Number(frames));
  expect(errors).toEqual([]);
});

test("unavailable WebGL preserves the readable CSS chart and working scope controls", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/webgl/.test(type)) return null;
      return original.call(this, type, ...args);
    };
  });
  await openScene(page);
  const chart = page.locator('[data-webgl-kind="chart"]');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toHaveAttribute("data-webgl-state", "fallback");
  await expect(chart.locator(".webgl-fallback")).toBeVisible();
  await page.getByRole("button", { name: "예약 변경 추가 13일", exact: true }).click();
  await expect(chart.locator(".spatial-bar-label")).toHaveText(["5일", "3.5일", "1.5일", "3일"]);
});

test("context loss returns to the complete fallback without leaving a blank chart", async ({ page }) => {
  await openScene(page);
  const chart = await chartReady(page);
  await chart.locator("canvas").evaluate(canvas => canvas.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
  await expect(chart).toHaveAttribute("data-webgl-state", "fallback");
  await expect(chart.locator(".webgl-fallback")).toBeVisible();
  await expect(chart.locator(".spatial-bar-label")).toHaveText(["5일", "3.5일", "1.5일"]);
});

for (const width of [390, 768]) {
  test(`mobile ${width}px keeps labels in the chart and disables continuous GPU motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await openScene(page);
    await page.getByRole("button", { name: "예약 변경 추가 13일", exact: true }).click();
    const chart = await chartReady(page);
    await expect(chart).toHaveAttribute("data-webgl-running", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await chart.locator(".webgl-label").evaluateAll(elements => elements.map(element => {
      const r = element.getBoundingClientRect();
      const parent = element.closest(".webgl-chart").getBoundingClientRect();
      return r.left >= parent.left && r.right <= parent.right && r.bottom <= parent.bottom;
    }));
    expect(bounds.every(Boolean)).toBe(true);
    await page.screenshot({ path: `outputs/webgl/mobile-${width}.png` });
    expect(errors).toEqual([]);
  });
}

for (const width of [1024, 1920]) {
  test(`desktop ${width}px retains the four-column 3D composition`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1080 });
    const errors = await openScene(page, { reduced: true });
    await page.getByRole("button", { name: "예약 변경 추가 13일", exact: true }).click();
    const chart = await chartReady(page);
    const bounds = await chart.locator(".webgl-value, .webgl-label").evaluateAll(elements => elements.map(element => {
      const r = element.getBoundingClientRect();
      const parent = element.closest(".webgl-chart").getBoundingClientRect();
      return r.left >= parent.left && r.right <= parent.right && r.top >= parent.top && r.bottom <= parent.bottom;
    }));
    expect(bounds.every(Boolean)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("hero and footer light fields render, and paused translated chart labels remain projected", async ({ page }) => {
  const errors = await openScene(page, { reduced: true });
  await expect(page.locator('[data-webgl-kind="hero"]')).toHaveAttribute("data-webgl-state", "ready", { timeout: 20_000 });
  await page.screenshot({ path: "outputs/webgl/desktop-hero.png" });
  await chartReady(page);
  await page.locator(".home-language-trigger").click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  const chart = await chartReady(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(chart.locator(".webgl-task-full")).not.toContainText(["예약 화면 · 시간 선택", "관리자 예약 관리", "반응형 · 검수"]);
  await expect.poll(() => chart.locator(".webgl-label").evaluateAll(labels => labels.every(label => !!label.style.left))).toBe(true);
  const footer = page.locator('[data-webgl-kind="footer"]');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toHaveAttribute("data-webgl-state", "ready", { timeout: 20_000 });
  expect(errors).toEqual([]);
});
