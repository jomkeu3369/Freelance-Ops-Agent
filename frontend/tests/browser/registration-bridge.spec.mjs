import { test as base, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const copy = { question: "만 14세 이상인가요? (필수)", error: "만 14세 이상임을 확인해 주세요. 만 14세 미만은 가입할 수 없습니다." };

// Every auth request is intercepted. These tests never create an account or contact a real API.
const test = base.extend({
  auth: async ({ page }, runFixture) => {
    const state = { requests: [], unexpected: [], errors: [], delay: 0 };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (/^\/api\//.test(url.pathname)) {
        if (request.method() === "POST" && ["/api/v2/auth/register", "/api/v2/auth/login"].includes(url.pathname)) {
          state.requests.push({ path: url.pathname, body: request.postDataJSON() });
          if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Local fixture response" }) });
        }
        state.unexpected.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      if (url.origin === localOrigin) return route.continue();
      state.unexpected.push(url.origin);
      return route.abort();
    });
    await runFixture(state);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  }
});

async function openSignup(page) {
  await page.goto("/workspace/projects");
  await page.getByRole("tab", { name: "처음 시작하기", exact: true }).click();
}

async function fillSignup(page) {
  await page.locator('input[name="displayName"]').fill("Local fixture");
  await page.locator('input[name="workspaceName"]').fill("Local fixture workspace");
  await page.locator('input[name="email"]').fill("fixture@example.invalid");
  await page.locator('input[name="password"]').fill("local-fixture-only");
  await page.locator('input[name="passwordConfirm"]').fill("local-fixture-only");
}

for (const theme of ["light", "dark"]) {
  for (const width of [320, 390, 1440]) {
    test(`${theme} ${width}px: unchecked signup is blocked with an accessible age question`, async ({ page, auth }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem("theme", value), theme);
      await openSignup(page);
      const age = page.getByRole("checkbox", { name: copy.question });
      await expect(age).not.toBeChecked();
      await expect(age).toHaveAttribute("required", "");
      await expect(age).toHaveAttribute("aria-describedby", "auth-age-hint");
      await fillSignup(page);
      await page.locator('button[type="submit"]').click();
      await expect(age).toBeFocused();
      await expect(age).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator("#auth-age-error")).toHaveText(copy.error);
      expect(auth.requests).toEqual([]);
      const layout = await page.locator(".auth-age-confirmation").evaluate(element => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        labelHeight: element.querySelector("label").getBoundingClientRect().height,
        overflow: [...element.querySelectorAll("p, label")].some(child => child.scrollWidth > child.clientWidth)
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.width);
      expect(layout.labelHeight).toBeGreaterThanOrEqual(44);
      expect(layout.overflow).toBe(false);
      await mkdir("outputs/signup-age", { recursive: true });
      await page.screenshot({ path: `outputs/signup-age/${theme}-${width}-unchecked.png`, fullPage: true });
      await age.press("Space");
      await expect(age).toBeChecked();
      await expect(page.locator("#auth-age-error")).toHaveCount(0);
      await age.press("Space");
      await expect(age).not.toBeChecked();
    });
  }
}

test("bypassing native required validation still cannot submit unchecked signup", async ({ page, auth }) => {
  await openSignup(page);
  await fillSignup(page);
  await page.locator("form").evaluate(form => {
    form.noValidate = true;
    form.requestSubmit();
  });
  await expect(page.locator("#auth-age-error")).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeFocused();
  expect(auth.requests).toEqual([]);
});

test("confirmed signup sends true once and busy state blocks repeated submission", async ({ page, auth }) => {
  auth.delay = 1000;
  await openSignup(page);
  await fillSignup(page);
  await page.getByRole("checkbox").check();
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(page.locator('button[type="submit"]')).toBeDisabled();
  await page.locator("form").dispatchEvent("submit");
  await expect(page.getByText("Local fixture response", { exact: true })).toBeVisible();
  expect(auth.requests).toEqual([{ path: "/api/v2/auth/register", body: {
    email: "fixture@example.invalid", password: "local-fixture-only", displayName: "Local fixture", workspaceName: "Local fixture workspace", ageAtLeast14: true
  } }]);
});

test("switching modes resets age confirmation and existing login needs no attestation", async ({ page, auth }) => {
  await openSignup(page);
  await fillSignup(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("tab", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByText("Local fixture response", { exact: true })).toBeVisible();
  expect(auth.requests).toEqual([{ path: "/api/v2/auth/login", body: { email: "fixture@example.invalid", password: "local-fixture-only" } }]);
  await page.getByRole("tab", { name: "처음 시작하기", exact: true }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.locator("#auth-age-error")).toHaveCount(0);
});

test("keyboard navigation reaches confirmation and original login visuals remain", async ({ page, auth }) => {
  await page.goto("/workspace/projects");
  await expect(page.locator(".auth-companion")).toHaveCount(3);
  await expect(page.locator(".auth-message h2")).toContainText("함께할 동료를.");
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("tab", { name: "로그인", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "처음 시작하기", exact: true })).toBeFocused();
  await fillSignup(page);
  await page.locator('input[name="passwordConfirm"]').focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox", { name: copy.question })).toBeFocused();
  const outline = await page.getByRole("checkbox").evaluate(input => getComputedStyle(input).outlineWidth);
  expect(Number.parseFloat(outline)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.locator('button[type="submit"]')).toBeFocused();
  expect(auth.requests).toEqual([]);
});
