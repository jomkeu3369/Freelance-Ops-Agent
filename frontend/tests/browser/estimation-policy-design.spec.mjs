import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

async function openPolicy(page, { width = 1440, locale = "ko", theme = "light", permissions, readStatus = 200 } = {}) {
  await page.setViewportSize({ width, height: 1000 });
  const state = await fixture(page);
  if (permissions) state.permissions = permissions;
  const server = { writes: [], fail: false, barrier: null };
  await page.addInitScript(({ locale, theme }) => {
    localStorage.setItem("freelance-ops-ui-locale-v1", locale);
    localStorage.setItem("theme", theme);
  }, { locale, theme });
  await page.route("**/api/v2/workspaces/local-space/estimation-policy", async route => {
    if (route.request().method() === "GET") return route.fulfill({ status: readStatus, json: readStatus === 200 ? state.policy : { message: "Synthetic policy read failure" } });
    const input = route.request().postDataJSON(); server.writes.push(input);
    if (server.barrier) await server.barrier.wait();
    if (server.fail) return route.fulfill({ status: 503, json: { message: "Synthetic policy save failure" } });
    state.policy = { ...state.policy, ...input, version: state.policy.version + 1 };
    return route.fulfill({ json: state.policy });
  });
  await page.goto("/workspace/settings");
  const section = page.locator("#estimation-policy");
  await expect(section.getByRole("heading", { level: 2 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { section, state, server };
}

async function expectContained(section) {
  const clipped = await section.locator("header, .estimation-policy-field, label, input, .estimation-policy-control, button, .estimation-policy-note").evaluateAll(elements => {
    const bounds = elements[0].closest("#estimation-policy").getBoundingClientRect();
    return elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || element.scrollWidth > element.clientWidth + 1);
    }).map(element => ({ tag: element.tagName, text: element.textContent?.slice(0, 40) }));
  });
  expect(clipped).toEqual([]);
}

for (const [width, locale, theme] of [
  [1440, "ko", "light"], [1024, "en", "light"], [842, "ko", "light"], [821, "en", "dark"],
  [820, "ko", "light"], [760, "en", "light"], [390, "ko", "light"], [320, "en", "dark"]
]) {
  test(`${width}px ${locale} ${theme}: calculation card keeps fields, units and guidance readable`, async ({ page }) => {
    const { section, state, server } = await openPolicy(page, { width, locale, theme });
    await expect(section.getByRole("spinbutton")).toHaveCount(3);
    for (const input of await section.getByRole("spinbutton").all()) {
      await expect(input).toHaveValue("10");
      await expect(input).toHaveAccessibleDescription(/.+/);
    }
    await expect(section.locator(".estimation-policy-control > span")).toHaveText(["%", "%", "%"]);
    await expectContained(section);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const fields = await section.locator(".estimation-policy-field").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
    if (width === 1440) expect(fields[0].y).toBe(fields[2].y);
    else expect(fields[1].y).toBeGreaterThanOrEqual(fields[0].bottom);
    if (width === 1440 || width === 320) await section.screenshot({ path: `outputs/ui-ux/estimation-policy-${width}-${locale}.png` });
    expect(server.writes).toEqual([]);
    expect(state.blocked).toEqual([]);
    expect(state.starts).toEqual([]);
  });
}

test("percentage validation, pending feedback, failed retry and saved feedback stay in the calculation card", async ({ page }) => {
  const { section, state, server } = await openPolicy(page, { width: 390 });
  const tax = section.getByLabel("기본 세율 (%)", { exact: true });
  const submit = section.locator('button[type="submit"]');
  for (const value of ["", "-0.1", "100.1"]) {
    await tax.fill(value);
    await submit.click();
    expect(server.writes).toHaveLength(0);
    await expect(tax).toBeFocused();
  }
  await tax.fill("12.5");
  await section.getByLabel("위험 대비율 (%)", { exact: true }).fill("0");
  await section.getByLabel("최대 할인율 (%)", { exact: true }).fill("100");
  const barrier = requestBarrier(); server.barrier = barrier; server.fail = true;
  try {
    await submit.click();
    await barrier.entered;
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("저장 중…");
    await expect(tax).toBeDisabled();
    await expect(section.locator("form")).toHaveAttribute("aria-busy", "true");
  } finally { barrier.release(); server.barrier = null; }
  await expect(section.getByRole("alert")).toHaveText("Synthetic policy save failure");
  await expect(tax).toHaveValue("12.5");
  await expect(section.getByRole("status")).toHaveCount(0);
  server.fail = false;
  await submit.click();
  await expect(section.getByRole("status")).toHaveText("견적 정책이 저장되었습니다.");
  await expect(section.getByRole("alert")).toHaveCount(0);
  expect(server.writes).toEqual(Array(2).fill({ defaultTaxRate: .125, defaultRiskBufferRate: 0, maximumDiscountRate: 1 }));
  await expect(section.getByRole("status")).toBeInViewport({ ratio: 1 });
  await tax.fill("15");
  await expect(section.getByRole("status")).toHaveCount(0);
  expect(state.blocked).toEqual([]);
});

test("read-only calculations retain card guidance and expose no editing controls", async ({ page }) => {
  const { section, server } = await openPolicy(page, { width: 320, locale: "en", permissions: ["project.read", "quotation.read"] });
  await expect(section).toContainText("Read only");
  await expect(section.locator("dd strong")).toHaveText(["10%", "10%", "10%"]);
  await expect(section.getByRole("spinbutton")).toHaveCount(0);
  await expect(section.getByRole("button")).toHaveCount(0);
  await expectContained(section);
  expect(server.writes).toEqual([]);
});

for (const scenario of ["no-permission", "failed-read"]) {
  test(`${scenario}: calculation card explains its unavailable state without a save action`, async ({ page }) => {
    const { section, server } = await openPolicy(page, scenario === "no-permission" ? { permissions: ["project.read"] } : { readStatus: 503 });
    await expect(section.getByRole("status")).toHaveText(scenario === "no-permission" ? "계산 기준을 볼 권한이 없습니다." : "계산 기준을 불러오지 못했습니다. 설정을 다시 열어 주세요.");
    await expect(section.getByRole("button")).toHaveCount(0);
    expect(server.writes).toEqual([]);
  });
}
