import { test as base, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;

// Every Business API request is fulfilled in this browser. No server writes or AI calls.
const test = base.extend({
  page: async ({ page }, runTest) => {
    const blocked = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === localOrigin) return route.continue();
      blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await runTest(page);
    expect(blocked, "Unexpected external network requests").toEqual([]);
    expect(errors, "Browser runtime errors").toEqual([]);
  }
});

async function setTheme(page, theme) {
  await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
}

async function screenshot(page, name) {
  await mkdir("outputs/ui-ux/screenshots", { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: `outputs/ui-ux/screenshots/${name}.png`, fullPage: true });
}

async function workspaceFixture(page, { projects = [], delay = 0, failLoad = null } = {}) {
  const state = { projects, failLoad, failSave: false, registerCalls: 0, submissions: [], unexpected: [] };
  const permissions = ["project.read", "project.write", "client.read", "client.write", "document.read", "quotation.read", "quotation.write"];
  await page.addInitScript(() => {
    sessionStorage.setItem("freelance-ops-session-v1", JSON.stringify({ userId: "local-user", workspaceId: "local-space", accessToken: "local-test-only", refreshToken: "local-test-only", accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" }));
  });
  await page.route("**/api/v2/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (url.origin !== "http://localhost:8080") { state.unexpected.push(path); return route.abort(); }
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "GET" && path.split("/").at(-1) === state.failLoad) return json({ detail: "로컬 검증용 불러오기 실패" }, 503);
    if (path === "/api/v2/auth/login" && method === "POST") return json({ userId: "local-user", workspaceId: "local-space", accessToken: "local-test-only", refreshToken: "local-test-only", accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" });
    if (path === "/api/v2/auth/register" && method === "POST") {
      state.registerCalls += 1;
      if (state.registerCalls > 1) return json({ detail: "이미 생성된 계정입니다." }, 409);
      return json({ userId: "local-user", workspaceId: "local-space", accessToken: "local-test-only", refreshToken: "local-test-only", accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" });
    }
    if (path === "/api/v2/me" && method === "GET") {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return json({ id: "local-user", email: "fixture@example.invalid", displayName: "로컬 검수", status: "ACTIVE", workspaces: ["local-space", "other-space"].map((workspaceId) => ({ workspaceId, name: workspaceId === "local-space" ? "로컬 작업 공간" : "다른 작업 공간", slug: workspaceId, effectivePermissions: permissions })) });
    }
    const owner = path.includes("/other-space/") ? "other-space" : "local-space";
    if (/\/projects$/.test(path) && method === "GET") {
      return json(url.searchParams.has("search") ? [] : state.projects.filter((project) => project.workspaceId === owner));
    }
    if (/\/projects$/.test(path) && method === "POST") {
      const input = request.postDataJSON();
      state.submissions.push(input);
      if (state.failSave) return json({ message: "로컬 검증용 저장 실패" }, 500);
      const project = { ...input, id: `local-project-${state.projects.length + 1}`, workspaceId: owner, status: "LEAD", updatedAt: "2026-09-30T00:00:00Z" };
      state.projects.push(project);
      return json(project, 201);
    }
    if (method === "GET" && /\/(clients|documents|rate-cards|requirements|model-pricing)$/.test(path)) return json([]);
    if (method === "GET" && /\/estimation-policy$/.test(path)) return json({ workspaceId: owner, defaultTaxRate: 0.1, defaultRiskBufferRate: 0.1, maximumDiscountRate: 0.1, version: 1 });
    state.unexpected.push(`${method} ${path}`);
    return route.abort();
  });
  return state;
}

async function openInquiry(page) {
  await page.getByRole("button", { name: /첫 고객 문의 등록|신규 문의 등록/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator('input[name="title"]')).toBeFocused();
}


for (const width of [320, 390, 768, 1024, 1100, 1440, 1920]) {
  for (const theme of ["light", "dark"]) {
    test(`landing ${width}px ${theme}: all five views readable with no overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setTheme(page, theme);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator(".problem-section, .evidence-section, .outcome-section")).toHaveCount(0);
      await expect(page.locator("#workflow")).toHaveAttribute("data-paused", "true");
      for (let step = 0; step < 5; step++) {
        await page.locator(".demo-step").nth(step).click();
        await expect(page.locator("#workflow")).toHaveAttribute("data-step", String(step));
        await expect(page.locator(".demo-step").nth(step)).toHaveAttribute("aria-pressed", "true");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (step === 3) {
          const coveredAmounts = await page.locator('.demo-quote-row [role="cell"]:last-child').evaluateAll(cells => {
            const panel = document.querySelector('.demo-activity').getBoundingClientRect();
            return cells.filter(cell => { const amount = cell.getBoundingClientRect(); return amount.left < panel.right && amount.right > panel.left && amount.top < panel.bottom && amount.bottom > panel.top; }).map(cell => cell.textContent);
          });
          expect(coveredAmounts, "Progress panel must not cover quotation amounts").toEqual([]);
        }
        for (const button of await page.locator(".product-demo button").all()) {
          if (!await button.isVisible()) continue;
          const box = await button.evaluate(e => ({ height: e.getBoundingClientRect().height, overflow: e.scrollWidth > e.clientWidth }));
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.overflow).toBe(false);
        }
      }
      await screenshot(page, `home-${width}-${theme}`);
      if (width === 1440 && theme === "light") await page.locator(".product-experience").screenshot({ path: "outputs/ui-ux/screenshots/landing-desktop-middle.png" });
    });
  }
}

test("landing keyboard, mobile menu, evidence anchor and history navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const menu = page.getByRole("button", { name: "페이지 메뉴 열기" });
  await menu.click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await page.locator("#home-navigation").getByRole("link", { name: "검증 원칙" }).click();
  await expect(page.locator("#evidence")).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  const quote = page.getByRole("button", { name: "견적 근거 보기" });
  await quote.focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#workflow-example")).toContainText("작업별 공수");
  await page.locator(".demo-step").nth(4).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".demo-proposal")).toContainText("예약 웹사이트 개발 제안");
  await page.goBack(); await page.goForward();
  await expect(page).toHaveURL(/#evidence$/);
});

test("one scope choice carries through requirements, quote and proposal without a real run", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const steps = page.locator(".demo-step");
  await steps.nth(0).click();
  await expect(page.locator("#workflow-example")).toContainText("예약 가능한 웹사이트");
  await steps.nth(2).click();
  await expect(page.locator("#workflow-example")).toContainText("온라인 결제도 필요한가요?");
  await page.getByRole("group", { name: "예약 변경 범위 선택" }).getByRole("button", { name: /예약 변경 추가/ }).click();
  await steps.nth(1).click();
  await expect(page.locator(".demo-requirements")).toContainText("고객 예약 변경");
  await steps.nth(3).click();
  await expect(page.getByRole("table", { name: "작업별 예시 공수와 금액" })).toContainText("관리자 예약 관리");
  await expect(page.locator(".demo-total")).toContainText("3,900,000");
  await expect(page.locator(".demo-total")).toContainText("13일");
  await steps.nth(4).click();
  await expect(page.locator(".demo-proposal")).toContainText("3,900,000원");
  await expect(page.locator(".demo-proposal")).toContainText("13일");
  await expect(page.locator(".demo-history li")).toHaveCount(0);
  for (let i = 0; i < 12; i++) {
    await page.getByRole("button", { name: "다음 단계", exact: true }).click();
    await expect(page.locator("#workflow")).toHaveAttribute("data-step", String(i % 5));
  }
  await steps.nth(3).click();
  await page.getByRole("group", { name: "견적 범위 선택" }).getByRole("button", { name: "핵심 범위", exact: true }).click();
  await steps.nth(4).click();
  await expect(page.locator(".demo-proposal")).toContainText("3,000,000원");
  await expect(page.locator(".demo-proposal")).not.toContainText("고객 예약 변경");
});

test("autoplay records five completed stages and automatically starts the next example", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.locator(".product-demo").scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const chapter = page.locator("#workflow");
  await expect(chapter).toHaveAttribute("data-paused", "false");
  await expect(page.locator(".demo-history li")).toHaveCount(1, { timeout: 6000 });
  await expect(chapter).toHaveAttribute("data-run-step", "4", { timeout: 22000 });
  await expect(chapter).toHaveAttribute("data-phase", "complete", { timeout: 6000 });
  await expect(page.locator(".demo-history li")).toHaveCount(5);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
  await mkdir("outputs/ui-ux/product-demo-after", { recursive: true });
  await mkdir("outputs/ui-ux/reference-layout-after", { recursive: true });
  await page.locator(".demo-scene").screenshot({ path: "outputs/ui-ux/reference-layout-after/demo-completed-desktop.png" });
  await page.waitForTimeout(1800);
  await expect(page.locator(".demo-history li")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "예시 다시 시작" })).toHaveCount(0);
  await expect(chapter).toHaveAttribute("data-run", "2", { timeout: 7000 });
  await expect(chapter).toHaveAttribute("data-run-step", "0");
  await expect(page.locator(".demo-history li")).toHaveCount(0);
});

test("focus, hover, explicit pause and live reduced motion independently stop autoplay", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const chapter = page.locator("#workflow");
  const controls = page.locator(".demo-controls button");
  await expect(controls.first()).toBeEnabled();
  await controls.first().focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".demo-step").first()).toBeFocused();
  await expect(chapter).toHaveAttribute("data-paused", "true");
  await page.waitForTimeout(2100);
  await expect(chapter).toHaveAttribute("data-phase", "running");
  await page.locator(".demo-step").nth(2).hover();
  await page.locator(".demo-step").nth(2).focus();
  await page.mouse.move(0, 0);
  await expect(chapter).toHaveAttribute("data-paused", "true");
  await page.locator("#workflow").focus();
  await expect(chapter).toHaveAttribute("data-paused", "false");
  await page.locator(".demo-history li").first().waitFor({ timeout: 6000 });
  await page.getByRole("button", { name: "자동 진행 일시 정지", exact: true }).click();
  await page.locator("#workflow").focus(); await page.mouse.move(0, 0);
  await expect(chapter).toHaveAttribute("data-paused", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "동작 줄이기 적용 중" })).toBeDisabled();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByRole("button", { name: "예시 자동 진행 재개" })).toBeEnabled();
  await page.getByRole("button", { name: "예시 자동 진행 재개" }).click();
  await page.locator("#workflow").focus(); await page.mouse.move(0, 0);
  await expect(chapter).toHaveAttribute("data-paused", "false");
});


test("offscreen demo stops, and a workspace round trip preserves coherent example data", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await workspaceFixture(page);
  await page.goto("/");
  const chapter = page.locator("#workflow");
  await expect(chapter).toHaveAttribute("data-paused", "true");
  await page.waitForTimeout(2100);
  await expect(page.locator(".demo-history li")).toHaveCount(0);
  await page.locator(".product-demo").scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect(chapter).toHaveAttribute("data-paused", "false");
  await page.locator(".demo-history li").first().waitFor({ timeout: 6000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(chapter).toHaveAttribute("data-paused", "true");
  const count = await page.locator(".demo-history li").count();
  await page.waitForTimeout(2100);
  await expect(page.locator(".demo-history li")).toHaveCount(count);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".demo-step").nth(3).click();
  await page.getByRole("group", { name: "견적 범위 선택" }).getByRole("button", { name: "예약 변경 추가" }).click();
  await page.locator(".hero-actions").getByRole("link", { name: "요구사항 정리 시작하기" }).click();
  await expect(page.locator(".workspace-empty")).toBeVisible();
  await expect(page).toHaveURL(/workspace\/projects$/);
  await page.goBack();
  await expect(page.locator(".product-demo")).toBeVisible();
  await page.locator(".demo-step").nth(3).click();
  const extended = await page.getByRole("group", { name: "견적 범위 선택" }).getByRole("button", { name: "예약 변경 추가" }).getAttribute("aria-pressed") === "true";
  await expect(page.locator(".demo-total")).toContainText(extended ? "3,900,000" : "3,000,000");
  await page.locator(".demo-step").nth(4).click();
  await expect(page.locator(".demo-proposal")).toContainText(extended ? "13일" : "10일");
  await page.goForward();
  await expect(page).toHaveURL(/workspace/);
});

test("a delayed workspace restore cannot redirect a user who already went back to the landing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await workspaceFixture(page, { delay: 1000 });
  await page.goto("/");
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator(".hero-actions").getByRole("link", { name: "요구사항 정리 시작하기" }).click();
    await expect(page).toHaveURL(/workspace/);
    await page.goBack();
    await expect(page).toHaveURL("/");
    await page.waitForTimeout(1400);
    await expect(page).toHaveURL("/");
    await expect(page.locator(".demo-step")).toHaveCount(5);
  }
  expect(fixture.unexpected).toEqual([]);
});

test("release excludes unapproved policy drafts and keeps the published footer links", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('footer a[href="/privacy"], footer a[href="/terms"]')).toHaveCount(0);
  await expect(page.locator("footer")).not.toContainText("초안");
  for (const route of ["privacy", "terms"]) {
    const response = await page.goto('/' + route);
    expect(response.status()).toBe(404);
    await expect(page.locator(".policy-page")).toHaveCount(0);
  }
});

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`intake ${width}px ${theme}: all close paths, validation, failure, discard and save`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await setTheme(page, theme);
      const state = await workspaceFixture(page);
      await page.goto("/workspace/projects");
      await expect(page.locator(".workspace-empty")).toBeVisible();
      await expect(page.locator(".pipeline-summary, .pipeline-toolbar, .pipeline-board")).toHaveCount(0);
      if (width === 1440 && theme === "light") {
        await mkdir("outputs/ui-ux/screenshots", { recursive: true });
        await page.locator(".workspace-main").screenshot({ path: "outputs/ui-ux/screenshots/workspace-empty.png" });
      }
      await page.locator(".skip-link").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main-content")).toBeFocused();
      await openInquiry(page);
      const title = page.locator('input[name="title"]');
      const text = page.locator('textarea[name="requirementText"]');
      await title.fill("  로컬 문의  ");
      await text.fill("첫 줄\n둘째 줄  ");
      await page.locator(".quick-intake-options > summary").click();
      await page.locator('select[name="currency"]').selectOption("USD");
      await page.locator('input[name="deadline"]').fill("2026-11-30");
      await page.locator('input[name="budgetMin"]').fill("1.25");
      await page.locator('input[name="budgetMax"]').fill("2.75");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "첫 고객 문의 등록" })).toBeFocused();
      await openInquiry(page);
      await expect(title).toHaveValue("  로컬 문의  ");
      await expect(text).toHaveValue("첫 줄\n둘째 줄  ");
      await expect(page.locator('select[name="currency"]')).toHaveValue("USD");
      await expect(page.locator('input[name="budgetMax"]')).toHaveValue("2.75");
      await screenshot(page, `intake-${width}-${theme}`);
      await page.getByRole("button", { name: "닫기", exact: true }).click();
      await openInquiry(page);
      await expect(title).toHaveValue("  로컬 문의  ");
      await page.locator(".dialog-backdrop").click({ position: { x: 2, y: 2 } });
      await openInquiry(page);
      await expect(text).toHaveValue("첫 줄\n둘째 줄  ");
      const close = page.getByRole("button", { name: "닫기", exact: true });
      await close.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("button", { name: "프로젝트 만들기", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await page.getByRole("button", { name: "초안 비우기" }).click();
      await page.getByRole("button", { name: "계속 작성" }).click();
      await expect(text).toHaveValue("첫 줄\n둘째 줄  ");
      await page.getByRole("button", { name: "초안 비우기" }).click();
      await page.getByRole("button", { name: "작성값 폐기" }).click();
      await expect(title).toHaveValue("");
      await expect(text).toHaveValue("");
      await expect(page.locator('select[name="currency"]')).toHaveValue("KRW");
      await title.fill("실패 후 재시도");
      await text.fill("보존할 문의");
      state.failSave = true;
      await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
      await expect(page.locator("#project-dialog-error")).toBeVisible();
      await page.keyboard.press("Escape");
      await openInquiry(page);
      await expect(text).toHaveValue("보존할 문의");
      state.failSave = false;
      await page.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/intake$/);
      await page.locator(".workspace-nav").getByRole("button", { name: "프로젝트 현황" }).click();
      await openInquiry(page);
      await expect(title).toHaveValue("");
      await expect(text).toHaveValue("");
      expect(state.submissions).toHaveLength(2);
      expect(state.unexpected).toEqual([]);
    });
  }
}

test("drafts survive browser history and remain isolated between workspaces", async ({ page }) => {
  const state = await workspaceFixture(page);
  await page.goto("/workspace/projects");
  await openInquiry(page);
  await page.locator('input[name="title"]').fill("원래 문의");
  await page.keyboard.press("Escape");
  await page.locator(".workspace-nav").getByRole("button", { name: "고객 관리" }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await page.goBack();
  await expect(page.locator(".workspace-empty")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/clients$/);
  await page.goBack();
  await openInquiry(page);
  await expect(page.locator('input[name="title"]')).toHaveValue("원래 문의");
  await page.keyboard.press("Escape");
  const workspace = page.getByRole("combobox", { name: "작업 공간 전환" });
  await workspace.selectOption("other-space");
  await expect(page.locator(".workspace-empty")).toBeVisible();
  await openInquiry(page);
  await expect(page.locator('input[name="title"]')).toHaveValue("");
  await page.locator('input[name="title"]').fill("다른 문의");
  await page.keyboard.press("Escape");
  await workspace.selectOption("local-space");
  await openInquiry(page);
  await expect(page.locator('input[name="title"]')).toHaveValue("원래 문의");
  expect(state.unexpected).toEqual([]);
});

for (const endpoint of ["me", "projects", "clients"]) {
  test(`restore failure at ${endpoint} returns to login and allows retry without reload`, async ({ page }) => {
    const state = await workspaceFixture(page, { failLoad: endpoint });
    await page.goto("/workspace/projects");
    await expect(page.locator(".auth-page")).toBeVisible();
    await expect(page.locator(".auth-page").getByRole("alert")).toContainText("로컬 검증용 불러오기 실패");
    await expect(page.locator(".workspace-loading")).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem("freelance-ops-session-v1"))).toBeNull();
    await page.locator('input[name="email"]').fill("fixture@example.invalid");
    await page.locator('input[name="password"]').fill("local-fixture-only");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator(".auth-page").getByRole("alert")).toContainText("로컬 검증용 불러오기 실패");
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
    await expect(page.locator(".workspace-loading")).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem("freelance-ops-session-v1"))).toBeNull();
    state.failLoad = null;
    await page.locator('button[type="submit"]').click();
    await expect(page.locator(".workspace-empty")).toBeVisible();
    await expect(page.locator(".auth-page, .workspace-loading")).toHaveCount(0);
    expect(state.unexpected).toEqual([]);
  });
}

test("successful registration with failed workspace loading switches to login without registering twice", async ({ page }) => {
  const state = await workspaceFixture(page, { failLoad: "projects" });
  await page.goto("/workspace/projects");
  await expect(page.locator(".auth-page")).toBeVisible();
  await page.getByRole("tab", { name: "처음 시작하기", exact: true }).click();
  await page.locator('input[name="displayName"]').fill("로컬 검수");
  await page.locator('input[name="workspaceName"]').fill("로컬 작업 공간");
  await page.locator('input[name="email"]').fill("fixture@example.invalid");
  await page.locator('input[name="password"]').fill("local-fixture-only");
  await page.locator('input[name="passwordConfirm"]').fill("local-fixture-only");
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole("tab", { name: "로그인", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".auth-page").getByRole("alert")).toContainText("계정은 생성되었습니다.");
  await expect(page.locator('input[name="email"]')).toHaveValue("fixture@example.invalid");
  await expect(page.locator('input[name="password"]')).toHaveValue("local-fixture-only");
  await expect(page.locator(".workspace-loading")).toHaveCount(0);
  state.failLoad = null;
  await page.locator('button[type="submit"]').click();
  await expect(page.locator(".workspace-empty")).toBeVisible();
  expect(state.registerCalls).toBe(1);
  expect(state.unexpected).toEqual([]);
});

test("loading, entire workspace empty and search empty are separate states", async ({ page }) => {
  const project = { id: "existing", workspaceId: "local-space", clientId: null, title: "기존 프로젝트", requirementText: "문의", currency: "KRW", deadline: null, budgetMin: null, budgetMax: null, status: "LEAD", updatedAt: "2026-09-30T00:00:00Z" };
  const state = await workspaceFixture(page, { projects: [project], delay: 800 });
  await page.goto("/workspace/projects");
  await expect(page.locator(".workspace-loading")).toBeVisible();
  await expect(page.locator(".workspace-empty")).toHaveCount(0);
  await expect(page.locator(".pipeline-summary")).toBeVisible();
  await page.getByRole("button", { name: "목록 보기", exact: true }).click();
  await page.getByRole("textbox", { name: "프로젝트 검색" }).fill("결과 없는 검색");
  await expect(page.locator(".pipeline-empty")).toContainText("검색 조건에 맞는 프로젝트가 없습니다.");
  await expect(page.locator(".workspace-empty")).toHaveCount(0);
  await page.getByRole("textbox", { name: "프로젝트 검색" }).fill("");
  await expect(page.locator(".pipeline-list")).toContainText("기존 프로젝트");
  await screenshot(page, "workspace-existing-project");
  expect(state.unexpected).toEqual([]);
});

for(const width of [320,390,1440]) for(const theme of ['light','dark']) {
  test(`English ${width}px ${theme}: language persists, main and auth labels fit`, async ({page}) => {
    await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});await setTheme(page,theme);
    await page.goto('/');await expect(page.locator('html')).toHaveAttribute('lang','ko');
    await page.getByRole('combobox',{name:'표시 언어'}).selectOption('en');await expect(page.locator('html')).toHaveAttribute('lang','en');
    for(let stage=0;stage<5;stage++) {
      await page.locator('.demo-step').nth(stage).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const remaining=await page.locator('.demo-view').innerText();expect(remaining).not.toMatch(/[가-힣]/);
      for(const button of await page.locator('.product-demo button').all())if(await button.isVisible())expect(await button.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    }
    await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','en');await expect(page.getByRole('combobox',{name:'Interface language'})).toHaveValue('en');
    await page.goto('/workspace');await expect(page.getByRole('tab',{name:'Log in',exact:true})).toBeVisible();
    await page.getByRole('tab',{name:'Sign up',exact:true}).click();
    await expect(page.locator('input[name="displayName"]')).toHaveAttribute('placeholder','What should we call you?');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await screenshot(page,`auth-en-${width}-${theme}`);
  });
}
test('language switching preserves inquiry drafts and never translates saved client content',async({page})=>{
  const project={id:'content-fixture',workspaceId:'local-space',clientId:null,title:'진행 중',requirementText:'고객 원문을 그대로 보존',currency:'KRW',deadline:null,budgetMin:null,budgetMax:null,status:'LEAD',updatedAt:'2026-10-01T00:00:00Z'};
  const state=await workspaceFixture(page,{projects:[project]});await page.goto('/workspace/projects');await expect(page.locator('.pipeline-summary')).toBeVisible();
  await page.getByRole('combobox',{name:'표시 언어'}).selectOption('en');await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('.pipeline-board h3, .pipeline-list h2').first()).toHaveText('진행 중');
  await page.getByRole('button',{name:'New inquiry',exact:true}).click();
  await page.locator('input[name="title"]').fill('견적');await page.locator('textarea[name="requirementText"]').fill('원문 보관');await page.keyboard.press('Escape');
  await page.getByRole('combobox',{name:'Interface language'}).selectOption('ko');await page.getByRole('button',{name:'신규 문의 등록',exact:true}).click();
  await expect(page.locator('input[name="title"]')).toHaveValue('견적');await expect(page.locator('textarea[name="requirementText"]')).toHaveValue('원문 보관');
  await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'표시 언어'}).selectOption('en');
  await page.getByRole('button',{name:'New inquiry',exact:true}).click();await expect(page.locator('input[name="title"]')).toHaveValue('견적');
  await page.locator('input[name="title"]').fill('   ');await page.locator('button[type="submit"]').click();await expect(page.getByRole('alert')).toContainText('Enter a project name');
  expect(state.submissions).toEqual([]);expect(state.unexpected).toEqual([]);
});
for(const language of ['ko','en'])test(`continuous ${language} card motion freezes mid-flight and replays the same node`,async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.addInitScript(lang=>localStorage.setItem('freelance-ops-ui-locale-v1',lang),language);
  await page.goto('/');await page.locator('.demo-project-board').scrollIntoViewIfNeeded();await page.mouse.move(0,0);
  const card=page.locator('.demo-moving-card');const node=await card.elementHandle();
  await expect(card).toHaveAttribute('aria-hidden','false',{timeout:6000});await page.waitForTimeout(900);const initial=await card.boundingBox();
  await expect(page.locator('.demo-project-flow')).toHaveAttribute('data-column','1',{timeout:22000});
  await page.waitForTimeout(150);await page.locator('.demo-project-board').hover();const frozen=await card.getAttribute('style');await page.waitForTimeout(500);expect(await card.getAttribute('style')).toBe(frozen);
  await page.mouse.move(0,0);await page.waitForTimeout(1000);expect((await card.boundingBox()).x).toBeGreaterThan(initial.x+30);
  expect(await node.evaluate(e=>e===document.querySelector('.demo-moving-card'))).toBe(true);
  await expect(page.locator('#workflow')).toHaveAttribute('data-run','2',{timeout:7000});expect(await node.evaluate(e=>e===document.querySelector('.demo-moving-card'))).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.demo-step').nth(4).click();await expect(card).toHaveAttribute('aria-hidden','false');
});
