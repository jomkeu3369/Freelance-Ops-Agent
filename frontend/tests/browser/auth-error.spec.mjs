import { test as base, expect } from "@playwright/test";

const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const copy = {
  ko: "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.",
  en: "Could not log in. Check your email and password."
};

// No real sign-in or external calls: only the local test response is used.
const test = base.extend({
  auth: async ({ page }, runFixture) => {
    const state = { status: 401, code: "INVALID_CREDENTIALS", delay: 0, requests: [], unexpected: [], errors: [] };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/v2/auth/login" && request.method() === "POST") {
        state.requests.push(request.postDataJSON());
        if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
        if (state.status === 0) return route.abort();
        return route.fulfill({ status: state.status, contentType: "application/json", body: JSON.stringify({ code: state.code, detail: state.code }) });
      }
      if (!url.pathname.startsWith("/api/") && url.origin === localOrigin) return route.continue();
      state.unexpected.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    });
    await runFixture(state);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  }
});

async function openLogin(page, locale = "ko") {
  await page.goto("/workspace/projects");
  await page.getByRole("combobox").selectOption(locale);
  await page.locator('input[name="email"]').fill("fixture@example.invalid");
  await page.locator('input[name="password"]').fill("fixture-password-only");
}

for (const locale of ["ko", "en"]) {
  for (const width of [320, 1440]) {
    for (const theme of ["light", "dark"]) {
      test(`${locale} ${width}px ${theme}: login failure is localized, accessible plain text`, async ({ page, auth }) => {
        await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
        await page.setViewportSize({ width, height: 900 });
        await openLogin(page, locale);
        await page.locator('button[type="submit"]').click();
        const error = page.locator("#auth-form-error");
        await expect(error).toHaveText(copy[locale]);
        await expect(error).toHaveAttribute("role", "alert");
        await expect(page.locator("form")).toHaveAttribute("aria-describedby", "auth-form-error");
        await expect(error).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(error).toHaveCSS("border-left-width", "0px");
        await expect(error).toHaveCSS("border-radius", "0px");
        await expect(error).toHaveCSS("font-size", "14px");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await expect(page.locator('input[name="email"]')).toHaveValue("fixture@example.invalid");
        await expect(page.locator('button[type="submit"]')).toBeEnabled();
        expect(auth.requests).toHaveLength(1);
      });
    }
  }
}

test("retry clears stale error, prevents double submission and supports language/mode changes", async ({ page, auth }) => {
  await openLogin(page);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#auth-form-error")).toHaveText(copy.ko);
  await page.getByRole("combobox").selectOption("en");
  await expect(page.locator("#auth-form-error")).toHaveText(copy.en);
  auth.delay = 500;
  await page.locator('input[name="password"]').fill("corrected-fixture-only");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator("#auth-form-error")).toHaveCount(0);
  await expect(page.locator('button[type="submit"]')).toBeDisabled();
  await page.locator("form").dispatchEvent("submit");
  await expect(page.locator("#auth-form-error")).toHaveText(copy.en);
  expect(auth.requests).toHaveLength(2);
  await page.getByRole("tab", { name: "Sign up", exact: true }).click();
  await expect(page.locator("#auth-form-error")).toHaveCount(0);
  await page.getByRole("tab", { name: "Log in", exact: true }).click();
  await expect(page.locator("#auth-form-error")).toHaveCount(0);
});

for (const [status, code, message] of [
  [429, "RATE_LIMITED", "Too many requests. Please try again later."],
  [503, "SERVICE_UNAVAILABLE", "Authentication is temporarily unavailable. Please try again later."],
  [400, "UNEXPECTED_AUTH_CODE", "Could not complete authentication. Check your details and try again."],
  [0, "", "Cannot reach the server. Check your connection and try again."]
]) {
  test(`status ${status}: recovery message replaces raw error details`, async ({ page, auth }) => {
    auth.status = status;
    auth.code = code;
    await openLogin(page, "en");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("#auth-form-error")).toHaveText(message);
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
  });
}
