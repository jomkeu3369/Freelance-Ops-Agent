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


// The spatial scenes share one fictional project and never submit a Business API request.
function watchLandingApiRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    if (/^\/api\//.test(new URL(request.url()).pathname)) requests.push(`${request.method()} ${request.url()}`);
  });
  return requests;
}

async function expectSpatialLayout(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  // The outer glass hero intentionally bleeds right; its meaningful content must still fit.
  const clipped = await page.locator(".spatial-stage, .spatial-project-card, .spatial-review-panel, .spatial-proposal, .spatial-effort, .spatial-quote-table, .spatial-quote-total, #scope-comparison input[type=range], .spatial-comparison-grid > article").evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return [];
    return box.left < -1 || box.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1
      ? [{ className: element.className, left: box.left, right: box.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }]
      : [];
  }));
  expect(clipped, "Meaningful scene content must fit, even when its outer shell clips decoration").toEqual([]);
  const coveredAmounts = await page.locator('.spatial-quote-table [role="cell"]:last-child').evaluateAll(cells => {
    const panel = document.querySelector(".spatial-review-panel").getBoundingClientRect();
    return cells.filter(cell => {
      const amount = cell.getBoundingClientRect();
      return amount.left < panel.right && amount.right > panel.left && amount.top < panel.bottom && amount.bottom > panel.top;
    }).map(cell => cell.textContent);
  });
  expect(coveredAmounts, "The review panel must not cover quotation amounts").toEqual([]);
  for (const button of await page.locator(".spatial-world button").all()) {
    if (!await button.isVisible()) continue;
    const box = await button.evaluate(element => ({ height: element.getBoundingClientRect().height, clipped: element.scrollWidth > element.clientWidth + 1 }));
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.clipped).toBe(false);
  }
}

async function openClockedLanding(page, language = "ko") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
  // Install before navigation; assert the visible hero starts without a click or scroll.
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  await expect(page.locator(".spatial-motion-toggle")).toBeEnabled();
  await expect(page.locator(".spatial-flow")).toBeInViewport({ ratio: 0.2 });
  await expect(page.locator("#workflow")).toHaveAttribute("data-paused", "false");
  await expect(page.locator(".spatial-flow")).toHaveAttribute("data-playing", "true");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
}

async function releaseSpatialInteraction(page) {
  await page.locator("#main-content").evaluate(element => element.focus({ preventScroll: true }));
  await page.mouse.move(0, 0);
}

async function autoplayState(page) {
  return page.locator("#workflow").evaluate(element => ["data-run", "data-run-step", "data-phase"].map(name => element.getAttribute(name)));
}

async function expectAutoplayFrozen(page) {
  await expect(page.locator("#workflow")).toHaveAttribute("data-paused", "true");
  await expect(page.locator(".spatial-flow")).toHaveAttribute("data-playing", "false");
  const before = await autoplayState(page);
  await page.clock.fastForward(6000);
  expect(await autoplayState(page), "Paused autoplay must retain its execution cursor").toEqual(before);
}

const landingCopy = {
  ko: { skip: "본문으로 건너뛰기", menu: "페이지 메뉴 열기", product: "제품 소개", workflow: "작동 방식", evidence: "검증 원칙", audience: "대상 사용자", quote: "견적 근거 보기", scope: "견적 범위 선택", essential: "핵심 범위", extended: "예약 변경 추가", extra: "고객 예약 변경", table: "작업별 예시 공수와 금액", status: "진행 중", finalStatus: "협상 중", stage: ["문의", "요구사항", "리스크", "견적", "제안"] },
  en: { skip: "Skip to main content", menu: "Open page menu", product: "Product", workflow: "How it works", evidence: "Review principles", audience: "Who it is for", quote: "View estimate evidence", scope: "Choose estimate scope", essential: "Core scope", extended: "Add rescheduling", extra: "Customer rescheduling", table: "Sample task effort and price", status: "In progress", finalStatus: "Negotiating", stage: ["Inquiry", "Requirements", "Risks", "Estimate", "Proposal"] }
};

for (const language of ["ko", "en"]) {
  for (const width of [320, 390, 768, 1024, 1100, 1440, 1920]) {
    for (const theme of ["light", "dark"]) {
      test(`landing ${language} ${width}px ${theme}: all spatial scenes and five previews fit without overflow`, async ({ page }) => {
        const copy = landingCopy[language];
        await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await setTheme(page, theme);
        const requests = watchLandingApiRequests(page);
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator("main")).toHaveCount(1);
        await expect(page.locator("main h1")).toHaveCount(1);
        await expect(page.locator("#workflow h1")).toBeVisible();
        await expect(page.locator("#workflow h1")).toHaveText(language === "ko" ? /문의는 한마디,\s*제안은 명확하게\./ : /The first words\.\s*A clearer proposal\./);
        const sections = page.locator("#workflow, #evidence, #review, #scope-comparison");
        await expect(sections).toHaveCount(4);
        expect(await sections.evaluateAll(chapters => chapters.map(chapter => chapter.id))).toEqual(["workflow", "evidence", "review", "scope-comparison"]);
        await expect(page.locator(".product-demo, .demo-layout, .demo-activity")).toHaveCount(0);
        const chapter = page.locator("#workflow");
        const card = page.locator(".spatial-project-card");
        await expect(card).toHaveCount(1);
        const original = await card.elementHandle();
        // Reduced motion starts with the finished, readable sample, without running the timeline.
        await expect(chapter).toHaveAttribute("data-step", "4");
        await expect(chapter).toHaveAttribute("data-paused", "true");
        await expect(page.locator(".spatial-flow")).toHaveAttribute("data-column", "1");
        await expect(page.getByRole("button", { name: language === "ko" ? "동작 줄이기 적용 중" : "Reduced motion enabled" })).toBeDisabled();
        for (const step of [0, 1, 2, 3, 4, 0, 4]) {
          const button = page.locator(".spatial-stage").nth(step);
          await button.click();
          await expect(chapter).toHaveAttribute("data-step", String(step));
          await expect(chapter).toHaveAttribute("data-run-step", "0");
          await expect(button).toHaveAttribute("aria-pressed", "true");
          await expect(button).toHaveAttribute("aria-controls", "workflow-example");
          await expect(page.locator('.spatial-stage[aria-pressed="true"]')).toHaveCount(1);
          await expect(card).toHaveAttribute("data-project-id", "FO-024");
          await expect(card).toHaveAttribute("aria-label", language === "ko" ? `${copy.stage[step]} 예시 결과` : `${copy.stage[step]} sample results`);
          await expect(card.locator(".spatial-status")).toHaveText(step === 4 ? copy.finalStatus : copy.status);
          await expect(page.locator(".spatial-flow")).toHaveAttribute("data-column", step === 4 ? "1" : "0");
          expect(await original.evaluate(element => element === document.querySelector(".spatial-project-card"))).toBe(true);
          await expect(chapter.getByRole("status")).toContainText(copy.stage[step]);
          await expectSpatialLayout(page);
        }
        await expect(page.locator(".spatial-proposal")).toContainText("3,000,000");
        await expect(page.locator(".spatial-effort-number")).toHaveText(language === "ko" ? "10일" : "10 days");
        await screenshot(page, `home-${language}-${width}-${theme}`);
        if (language === "ko" && width === 1440 && theme === "light") await page.locator(".spatial-world").screenshot({ path: "outputs/ui-ux/screenshots/landing-desktop-middle.png" });
        expect(requests).toEqual([]);
      });
    }
  }
}

for (const language of ["ko", "en"]) {
  test(`landing ${language}: keyboard, mobile menu, real anchors and history navigation`, async ({ page }) => {
    const copy = landingCopy[language];
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: copy.skip })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    const menu = page.locator(".home-menu-toggle");
    await expect(menu).toHaveAccessibleName(copy.menu);
    await expect(menu).toHaveAttribute("aria-controls", "home-navigation");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    for (const [name, target] of [[copy.product, "product"], [copy.workflow, "workflow"], [copy.audience, "audience"], [copy.evidence, "evidence"]]) {
      await menu.click();
      const link = page.locator("#home-navigation").getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("href", `#${target}`);
      await link.click();
      await expect(page.locator(`#${target}`)).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`#${target}$`));
      await expect(menu).toHaveAttribute("aria-expanded", "false");
    }
    const quote = page.locator("#evidence").getByRole("link", { name: copy.quote });
    await expect(quote).toHaveAttribute("href", "#review");
    await quote.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#review")).toBeFocused();
    await expect(page).toHaveURL(/#review$/);
    await page.goBack();
    await expect(page).toHaveURL(/#evidence$/);
    await page.goForward();
    await expect(page).toHaveURL(/#review$/);
    await page.locator(".spatial-stage").nth(4).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".spatial-stage").nth(4)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".spatial-status")).toHaveText(copy.finalStatus);
    const hashLinks = await page.locator('.figma-home a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute("href")));
    for (const hash of new Set(hashLinks)) await expect(page.locator(hash)).toHaveCount(1);
    await expect(page.locator(".hero-actions .primary-button")).toHaveAttribute("href", "/workspace");
    await expect(page.locator(".final-cta .primary-button")).toHaveAttribute("href", "/workspace");
  });

  for (const width of [390, 1440]) {
    test(`landing ${language} ${width}px: scope updates the same card, proposal, table and effort chart`, async ({ page }) => {
      const copy = landingCopy[language];
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
      const requests = watchLandingApiRequests(page);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const scopes = page.getByRole("group", { name: copy.scope });
      const table = page.getByRole("table", { name: copy.table });
      const slider = page.locator("#scope-comparison").getByRole("slider");
      await expect(slider).toHaveAccessibleName(/.+/);
      await expect(slider).toHaveAttribute("min", "0");
      await expect(slider).toHaveAttribute("max", "1");
      await expect(slider).toHaveAttribute("step", "1");
      const comparisons = page.locator(".spatial-comparison-grid > article");
      await expect(comparisons).toHaveCount(3);
      const card = page.locator(".spatial-project-card");
      const original = await card.elementHandle();
      for (const extended of [false, true, false, true]) {
        const days = extended ? 13 : 10;
        const total = extended ? "3,900,000" : "3,000,000";
        const choice = scopes.getByRole("button", { name: new RegExp(`^${extended ? copy.extended : copy.essential}`) });
        await choice.click();
        await expect(choice).toHaveAttribute("aria-pressed", "true");
        await expect(scopes.locator('[aria-pressed="true"]')).toHaveCount(1);
        await expect(slider).toHaveValue(extended ? "1" : "0");
        await expect(slider).toHaveAttribute("aria-valuetext", extended ? copy.extended : copy.essential);
        await expect(comparisons.nth(0).locator("li")).toHaveCount(extended ? 4 : 3);
        await expect(comparisons.nth(1).locator(".is-filled")).toHaveCount(days);
        await expect(comparisons.nth(2).locator(".spatial-comparison-price")).toHaveText(`${total}KRW`);
        await expect(table.getByRole("row")).toHaveCount(extended ? 5 : 4);
        // The visual effort breakdown may collapse on phones; the four-column DOM contract remains.
        await expect(table.getByRole("columnheader", { includeHidden: true })).toHaveCount(4);
        for (const heading of language === "ko" ? ["작업", "공수", "금액"] : ["Task", "Effort", "Price"]) {
          await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
        }
        await expect(table.getByRole("rowheader")).toHaveCount(extended ? 4 : 3);
        await expect(table.getByRole("rowheader", { name: copy.extra, exact: true })).toHaveCount(extended ? 1 : 0);
        await expect(page.locator(".spatial-quote-total")).toContainText(total);
        await expect(page.locator(".spatial-quote-total")).toContainText(language === "ko" ? `${days}일` : `${days} days`);
        await expect(page.locator(".spatial-effort-number")).toHaveText(language === "ko" ? `${days}일` : `${days} days`);
        await expect(page.locator(".spatial-effort")).toHaveAttribute("role", "img");
        await expect(page.locator(".spatial-effort")).toHaveAccessibleName(language === "ko"
          ? `예시 공수 구성: 예약 5일, 관리자 3.5일, 반응형과 검수 1.5일. ${extended ? "예약 변경 3일 추가. 총 13일." : "총 10일."}`
          : `Sample effort: booking 5 days, admin 3.5 days, responsive design and QA 1.5 days. ${extended ? "Rescheduling adds 3 days. Total: 13 days." : "Total: 10 days."}`);
        await expect(page.locator(".spatial-bars .spatial-bar")).toHaveCount(extended ? 4 : 3);
        await expect(page.locator(".spatial-bars .spatial-bar-label")).toHaveText((extended ? [5, 3.5, 1.5, 3] : [5, 3.5, 1.5]).map(value => language === "ko" ? `${value}일` : `${value} days`));
        const amounts = await table.getByRole("row").evaluateAll(rows => rows.slice(1).map(row => Number(row.querySelector('[role="cell"]:last-child').textContent.replaceAll(",", ""))));
        expect(amounts).toEqual(extended ? [1500000, 1050000, 450000, 900000] : [1500000, 1050000, 450000]);
        expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(extended ? 3900000 : 3000000);
        await page.locator(".spatial-stage").nth(1).click();
        await expect(card.locator(".spatial-card-detail")).toContainText(extended ? copy.extra : copy.stage[1]);
        if (!extended) await expect(card.locator(".spatial-card-detail")).not.toContainText(copy.extra);
        await page.locator(".spatial-stage").nth(3).click();
        await expect(card.locator(".spatial-card-detail")).toContainText(total);
        await page.locator(".spatial-stage").nth(4).click();
        await expect(card.locator(".spatial-card-detail")).toContainText(total);
        await expect(page.locator(".spatial-proposal")).toContainText(total);
        expect(await original.evaluate(element => element === document.querySelector(".spatial-project-card"))).toBe(true);
        await expectSpatialLayout(page);
      }
      // Both controls drive the same scope. Native keyboard input also clamps at each endpoint.
      for (const [key, extended] of [["Home", false], ["End", true], ["ArrowLeft", false], ["ArrowRight", true], ["ArrowRight", true], ["Home", false], ["ArrowLeft", false]]) {
        await slider.focus();
        await page.keyboard.press(key);
        const days = extended ? 13 : 10;
        const total = extended ? "3,900,000" : "3,000,000";
        await expect(slider).toHaveValue(extended ? "1" : "0");
        await expect(slider).toHaveAttribute("aria-valuetext", extended ? copy.extended : copy.essential);
        await expect(scopes.getByRole("button", { name: new RegExp(`^${extended ? copy.extended : copy.essential}`) })).toHaveAttribute("aria-pressed", "true");
        await expect(scopes.locator('[aria-pressed="true"]')).toHaveCount(1);
        await expect(table.getByRole("row")).toHaveCount(extended ? 5 : 4);
        await expect(table.getByRole("rowheader", { name: copy.extra, exact: true })).toHaveCount(extended ? 1 : 0);
        await expect(page.locator(".spatial-quote-total")).toContainText(total);
        await expect(page.locator(".spatial-effort-number")).toHaveText(language === "ko" ? `${days}일` : `${days} days`);
        await expect(page.locator(".spatial-bars .spatial-bar")).toHaveCount(extended ? 4 : 3);
        await expect(comparisons.nth(0).locator("li")).toHaveCount(extended ? 4 : 3);
        await expect(comparisons.nth(1).locator("strong")).toHaveText(language === "ko" ? `${days}일` : `${days} days`);
        await expect(comparisons.nth(1).locator(".is-filled")).toHaveCount(days);
        await expect(comparisons.nth(2).locator(".spatial-comparison-price")).toHaveText(`${total}KRW`);
        await expect(card.locator(".spatial-card-detail")).toContainText(total);
        await expect(page.locator("#workflow")).toHaveAttribute("data-paused", "true");
        expect(await original.evaluate(element => element === document.querySelector(".spatial-project-card"))).toBe(true);
        await expectSpatialLayout(page);
      }
      await page.locator(".spatial-assumptions summary").click();
      await expect(page.locator(".spatial-assumptions")).toHaveAttribute("open", "");
      await expect(page.locator(".spatial-assumptions")).toContainText("300,000");
      await page.locator(".spatial-assumptions summary").click();
      await expect(page.locator(".spatial-assumptions")).not.toHaveAttribute("open", "");
      if (language === "en") expect(await page.locator(".spatial-world").innerText()).not.toMatch(/[가-힣]/);
      expect(requests).toEqual([]);
    });
  }

  test(`landing ${language}: autoplay starts in view, moves FO-024 only at final completion and replays the same node`, async ({ page }) => {
    const requests = watchLandingApiRequests(page);
    await openClockedLanding(page, language);
    const chapter = page.locator("#workflow");
    const flow = page.locator(".spatial-flow");
    const card = page.locator(".spatial-project-card");
    const original = await card.elementHandle();
    await expect(flow).toBeInViewport({ ratio: 0.2 });
    await expect(chapter).toHaveAttribute("data-paused", "false");
    await expect(flow).toHaveAttribute("data-playing", "true");
    const initial = await card.boundingBox();
    for (let step = 0; step < 5; step++) {
      await expect(chapter).toHaveAttribute("data-run-step", String(step));
      await expect(chapter).toHaveAttribute("data-step", String(step));
      await expect(chapter).toHaveAttribute("data-phase", "running");
      await expect(flow).toHaveAttribute("data-column", "0");
      await expect(card.locator(".spatial-status")).toHaveText(landingCopy[language].status);
      await page.clock.fastForward(1700);
      await expect(chapter).toHaveAttribute("data-phase", "complete");
      await expect(flow).toHaveAttribute("data-column", step === 4 ? "1" : "0");
      await expect(card).toHaveAttribute("data-project-id", "FO-024");
      await expect(card).toHaveCount(1);
      expect(await original.evaluate(element => element === document.querySelector(".spatial-project-card"))).toBe(true);
      if (step < 4) await page.clock.fastForward(1100);
    }
    await expect(card.locator(".spatial-status")).toHaveText(landingCopy[language].finalStatus);
    await expect.poll(async () => (await card.boundingBox()).x).toBeGreaterThan(initial.x + 30);
    // Automatic updates stay silent; manual previews have their own status announcement.
    await expect(chapter.getByRole("status")).toBeEmpty();
    await page.clock.fastForward(4300);
    await expect(chapter).toHaveAttribute("data-run", "2");
    await expect(chapter).toHaveAttribute("data-run-step", "0");
    await expect(chapter).toHaveAttribute("data-step", "0");
    await expect(flow).toHaveAttribute("data-column", "0");
    expect(await original.evaluate(element => element === document.querySelector(".spatial-project-card"))).toBe(true);
    expect(requests).toEqual([]);
  });
}

test("landing manual preview pauses normal motion, stays readable and resumes its execution cursor", async ({ page }) => {
  await openClockedLanding(page);
  const chapter = page.locator("#workflow");
  await page.locator(".spatial-flow").scrollIntoViewIfNeeded();
  await releaseSpatialInteraction(page);
  await expect(chapter).toHaveAttribute("data-paused", "false");
  await page.clock.fastForward(1700);
  await expect(chapter).toHaveAttribute("data-phase", "complete");
  await page.locator(".spatial-stage").nth(2).click();
  await expect(chapter).toHaveAttribute("data-step", "2");
  await expect(chapter).toHaveAttribute("data-run-step", "0");
  await expect(page.locator(".spatial-card-detail")).toContainText("온라인 결제도 필요한가요?");
  await expect(page.locator(".spatial-card-detail")).toHaveCSS("opacity", "1");
  await releaseSpatialInteraction(page);
  await expectAutoplayFrozen(page);
  await page.getByRole("button", { name: "예시 자동 진행 재개" }).click();
  await releaseSpatialInteraction(page);
  await expect(chapter).toHaveAttribute("data-paused", "false");
  await expect(chapter).toHaveAttribute("data-step", "0");
  await page.clock.fastForward(1100);
  await expect(chapter).toHaveAttribute("data-run-step", "1");
  await expect(chapter).toHaveAttribute("data-step", "1");
});

test("landing hover, focus, explicit pause and live reduced motion independently stop autoplay", async ({ page }) => {
  await openClockedLanding(page);
  const chapter = page.locator("#workflow");
  const flow = page.locator(".spatial-flow");
  await flow.scrollIntoViewIfNeeded();
  await releaseSpatialInteraction(page);
  await expect(chapter).toHaveAttribute("data-paused", "false");
  // Hover alone pauses; focus then keeps it paused after the pointer leaves.
  await page.locator(".spatial-project-card").hover();
  await expectAutoplayFrozen(page);
  await page.locator(".spatial-stage").first().focus();
  await page.mouse.move(0, 0);
  await expect(page.locator(".spatial-stage").first()).toBeFocused();
  await expectAutoplayFrozen(page);
  await releaseSpatialInteraction(page);
  await expect(chapter).toHaveAttribute("data-paused", "false");
  await page.clock.fastForward(1700);
  await expect(chapter).toHaveAttribute("data-phase", "complete");
  await page.getByRole("button", { name: "자동 진행 일시 정지", exact: true }).click();
  await releaseSpatialInteraction(page);
  await expectAutoplayFrozen(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "동작 줄이기 적용 중" })).toBeDisabled();
  await expect(chapter).toHaveAttribute("data-step", "4");
  await expectAutoplayFrozen(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByRole("button", { name: "예시 자동 진행 재개" })).toBeEnabled();
  await expectAutoplayFrozen(page); // Changing the preference must not erase explicit pause.
  await page.getByRole("button", { name: "예시 자동 진행 재개" }).click();
  await releaseSpatialInteraction(page);
  await expect(chapter).toHaveAttribute("data-paused", "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectAutoplayFrozen(page); // Reduced motion alone pauses a running example too.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(chapter).toHaveAttribute("data-paused", "false");
});

test("landing starts at entry, pauses at the footer and resumes when the hero reenters", async ({ page }) => {
  await openClockedLanding(page);
  const chapter = page.locator("#workflow");
  const flow = page.locator(".spatial-flow");
  await expect(chapter).toHaveAttribute("data-paused", "false");
  await page.clock.fastForward(1700);
  await expect(chapter).toHaveAttribute("data-phase", "complete");
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(flow).not.toBeInViewport();
  await expectAutoplayFrozen(page);
  await flow.scrollIntoViewIfNeeded();
  await expect(chapter).toHaveAttribute("data-paused", "false");
  await page.clock.fastForward(1100);
  await expect(chapter).toHaveAttribute("data-run-step", "1");
});

test("a workspace round trip retains internally coherent spatial example data", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await workspaceFixture(page);
  await page.goto("/");
  await page.getByRole("group", { name: "견적 범위 선택" }).getByRole("button", { name: /^예약 변경 추가/ }).click();
  await page.locator(".hero-actions").getByRole("link", { name: "요구사항 정리 시작하기" }).click();
  await expect(page.locator(".workspace-empty")).toBeVisible();
  await expect(page).toHaveURL(/workspace\/projects$/);
  await page.goBack();
  await expect(page.locator(".spatial-flow")).toBeVisible();
  const extended = await page.getByRole("group", { name: "견적 범위 선택" }).getByRole("button", { name: /^예약 변경 추가/ }).getAttribute("aria-pressed") === "true";
  await expect(page.locator(".spatial-quote-total")).toContainText(extended ? "3,900,000" : "3,000,000");
  await expect(page.locator(".spatial-effort-number")).toHaveText(extended ? "13일" : "10일");
  await expect(page.locator(".spatial-quote-table").getByRole("row")).toHaveCount(extended ? 5 : 4);
  await page.locator(".spatial-stage").nth(4).click();
  await expect(page.locator(".spatial-card-detail")).toContainText(extended ? "3,900,000" : "3,000,000");
  await page.goForward();
  await expect(page).toHaveURL(/workspace/);
  expect(fixture.unexpected).toEqual([]);
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
    await expect(page.locator(".spatial-stage")).toHaveCount(5);
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
      await page.locator('.spatial-stage').nth(stage).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const remaining=await page.locator('.spatial-world').innerText();expect(remaining).not.toMatch(/[가-힣]/);
      for(const button of await page.locator('.spatial-world button').all())if(await button.isVisible())expect(await button.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    }
    await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','en');await expect(page.getByRole('combobox',{name:'Interface language'})).toHaveValue('en');
    await page.goto('/workspace');await expect(page.getByRole('tab',{name:'Log in',exact:true})).toBeVisible();
    await page.getByRole('tab',{name:'Sign up',exact:true}).click();
    await expect(page.locator('input[name="displayName"]')).toHaveAttribute('placeholder','What should we call you?');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const brand = await page.locator('.auth-brand').boundingBox();
    const language = await page.locator('.auth-header .ui-language-selector').boundingBox();
    expect(brand.x + brand.width).toBeLessThanOrEqual(language.x);
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
  await page.locator('input[name="title"]').fill('   ');await page.locator('.project-dialog button[type="submit"]').click();await expect(page.locator('.project-dialog [role="alert"]')).toContainText('Enter a project name');
  expect(state.submissions).toEqual([]);expect(state.unexpected).toEqual([]);
});
