import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const path = "/workspace/settings";
const cards = Array.from({ length: 16 }, (_, index) => ({
  id: `rate-${index}`, workspaceId: "local-space", name: index === 0 ? "Fixed service" : `Service ${index} ${"Long service name ".repeat(6)}`.slice(0, 120),
  unit: index === 0 ? "FIXED" : index % 2 ? "HOUR" : "DAY", rate: 400000, minimumAmount: 100000,
  currency: "KRW", active: index !== 1, version: 1
}));

async function openRates(page, { width = 842, height = 900, locale = "ko", theme = "light", canWrite = true, initial = cards } = {}) {
  await page.setViewportSize({ width, height });
  const state = await fixture(page);
  if (!canWrite) state.permissions = ["project.read", "quotation.read"];
  await page.addInitScript(({ locale, theme }) => {
    localStorage.setItem("freelance-ops-ui-locale-v1", locale);
    localStorage.setItem("theme", theme);
  }, { locale, theme });
  await page.route("**/api/v2/workspaces/local-space/rate-cards", route => {
    if (route.request().method() !== "GET") {
      state.writes.push({ method: route.request().method(), path: "/rate-cards" });
      return route.fulfill({ status: 405, json: { message: "Unexpected rate mutation" } });
    }
    return route.fulfill({ json: initial });
  });
  await page.goto(path);
  const section = page.locator("#rate-cards");
  await expect(section.locator(".rate-card-toolbar")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { section, state };
}

async function expectContained(section) {
  // 카드의 overflow:hidden은 문서 전체의 가로 넘침 검사만으로 발견할 수 없다.
  const clipped = await section.locator(".rate-card-toolbar, .rate-card-list, .rate-card-list > button, .rate-card-list strong, .rate-card-form, fieldset, label, input, select, .rate-card-form button").evaluateAll(elements => {
    const bounds = elements[0].closest("#rate-cards").getBoundingClientRect();
    return elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
    }).map(element => ({ tag: element.tagName, text: element.textContent?.slice(0, 40) }));
  });
  expect(clipped).toEqual([]);
}

for (const [width, locale, theme] of [
  [1440, "ko", "light"], [1024, "en", "light"], [842, "ko", "light"], [821, "en", "dark"],
  [820, "ko", "light"], [760, "en", "light"], [390, "ko", "light"], [320, "en", "dark"]
]) {
  test(`${width}px ${locale} ${theme}: rate controls stay inside the card and fixed units remain visible`, async ({ page }) => {
    const { section, state } = await openRates(page, { width, locale, theme });
    await expect(section.locator(".rate-card-list > button")).toHaveCount(cards.length);
    await expect(section.locator(".rate-card-list > button").first()).toContainText(locale === "en" ? "/ item" : "/ 건");
    await expectContained(section);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const geometry = await section.evaluate(element => {
      const list = element.querySelector(".rate-card-list");
      const form = element.querySelector(".rate-card-form");
      return { list: list.getBoundingClientRect().toJSON(), form: form.getBoundingClientRect().toJSON(), clientHeight: list.clientHeight, scrollHeight: list.scrollHeight };
    });
    expect(geometry.clientHeight).toBeLessThan(geometry.scrollHeight);
    expect(geometry.clientHeight).toBeLessThanOrEqual(400);
    if (width === 1440) expect(geometry.form.x).toBeGreaterThanOrEqual(geometry.list.right);
    else expect(geometry.form.y).toBeGreaterThanOrEqual(geometry.list.bottom);
    if (width === 842) {
      await page.getByRole("button", { name: "메뉴 접기", exact: true }).click();
      await expectContained(section);
      await page.getByRole("button", { name: "메뉴 펼치기", exact: true }).click();
      await expectContained(section);
    }
    if (width === 1440) await section.screenshot({ path: "outputs/ui-ux/rate-card-layout-desktop.png" });
    expect(state.writes).toEqual([]);
    expect(state.starts).toEqual([]);
    expect(state.blocked).toEqual([]);
  });
}

for (const [width, height] of [[1440, 900], [842, 720], [390, 844], [320, 568]]) {
  test(`${width}px: selecting a distant rate or New opens the editor without manual page scrolling`, async ({ page }) => {
    const { section, state } = await openRates(page, { width, height });
    const form = section.locator(".rate-card-form");
    const last = section.locator(".rate-card-list > button").last();
    if (width === 320) {
      await last.focus();
      await last.press("Enter");
    } else await last.click();
    await expect(form).toBeFocused();
    await expect(form.locator(".rate-card-form-heading")).toBeInViewport({ ratio: 1 });
    expect((await form.locator(".rate-card-form-heading").boundingBox()).y).toBeLessThan(height / 3);
    if (height >= 720) await expect(form.locator('button[type="submit"]')).toBeInViewport({ ratio: 1 });
    await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue(cards.at(-1).name);
    await expect(last).toHaveAttribute("aria-pressed", "true");
    await expect(last).toHaveAttribute("aria-controls", "rate-card-editor");
    await form.getByLabel("서비스 이름", { exact: true }).fill("Unsubmitted draft");
    await last.click();
    await expect(form).toBeFocused();
    await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("Unsubmitted draft");
    await section.getByRole("button", { name: "새 단가", exact: true }).click();
    await expect(form).toBeFocused();
    await expect(form.locator(".rate-card-form-heading")).toBeInViewport({ ratio: 1 });
    if (height >= 720) await expect(form.locator('button[type="submit"]')).toBeInViewport({ ratio: 1 });
    await expect(form.getByLabel("서비스 이름", { exact: true })).toHaveValue("");
    await expectContained(section);
    if (width === 842 || width === 390) await page.screenshot({ path: `outputs/ui-ux/rate-card-editor-${width}.png` });
    expect(state.writes).toEqual([]);
    expect(state.blocked).toEqual([]);
  });
}

test("read-only rates use the available width without exposing mutations", async ({ page }) => {
  const { section, state } = await openRates(page, { width: 1440, canWrite: false });
  await expect(section.locator(".rate-card-form")).toHaveCount(0);
  await expect(section.getByRole("button", { name: "새 단가", exact: true })).toHaveCount(0);
  await expectContained(section);
  expect(state.writes).toEqual([]);
});

test("an empty rate list keeps the creation form across the full column", async ({ page }) => {
  const { section, state } = await openRates(page, { width: 1440, initial: [] });
  await expect(section.locator(".rate-card-list")).toHaveCount(0);
  const widths = await section.evaluate(element => ({ manager: element.querySelector(".rate-card-manager").clientWidth, form: element.querySelector(".rate-card-form").getBoundingClientRect().width }));
  expect(widths.form).toBeGreaterThan(widths.manager * .95);
  await expectContained(section);
  expect(state.writes).toEqual([]);
});
