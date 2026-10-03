import { test as base, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createBrandFlight } from "../../features/home/brand-flight.mjs";

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


test("landing header stays centered through narrow and restored viewports after its animated entrance", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator(".nav-shell")).toHaveCSS("opacity", "1");
  for (const width of [590, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.locator(".nav-shell").evaluate(element => {
      const rect = element.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - document.documentElement.clientWidth / 2);
    })).toBeLessThan(1);
    for (const selector of [".nav-shell .brand", ".nav-actions", ".home-menu-toggle"]) {
      const control = page.locator(selector);
      if (!await control.isVisible()) continue;
      const bounds = await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
    }
  }
});

// The spatial scenes share one fictional project and never submit a Business API request.
function watchLandingApiRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    if (/^\/api\//.test(new URL(request.url()).pathname)) requests.push(`${request.method()} ${request.url()}`);
  });
  return requests;
}

async function expectSpatialLayout(page) {
  // Include direct text beside SVGs, spans and <br>; leaf-only scans miss real copy.
  const tinyCopy = await page.locator(".figma-home *").evaluateAll(elements => elements.flatMap(element => {
    const directText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).filter(Boolean).join(" ");
    const rect = element.getBoundingClientRect();
    if (directText.length < 4 || rect.width < 2 || rect.height < 2 || element.closest('[aria-hidden="true"], .sr-only')) return [];
    const size = Number.parseFloat(getComputedStyle(element).fontSize);
    return size < 12 ? [{ text: directText, size, className: element.className }] : [];
  }));
  expect(tinyCopy, "Meaningful mixed-content text must not fall back to micro-type").toEqual([]);
  const documentSize = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, body: document.body.scrollWidth }));
  expect(documentSize.scroll, "Root overflow must be checked against usable width, excluding the scrollbar").toBeLessThanOrEqual(documentSize.client);
  expect(documentSize.body, "Body overflow must not be hidden by the page shell").toBeLessThanOrEqual(documentSize.client);
  // Decorative glass may extend beyond its frame; meaningful content must stay inside usable width.
  const clipped = await page.locator(".nav-shell, .nav-shell .brand, .nav-actions, .spatial-stage, .spatial-project-card, .spatial-review-panel, .spatial-proposal, .spatial-effort, .spatial-quote-table, .spatial-quote-total, .spatial-demo-disclaimer, .spatial-capability-strip, .spatial-capability-strip > div > span, #scope-comparison input[type=range], .spatial-comparison-grid > article").evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return [];
    return box.left < -1 || box.right > document.documentElement.clientWidth + 1 || element.scrollWidth > element.clientWidth + 1
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
  const collisions = await page.evaluate(() => {
    const failures = [];
    const intersects = (left, right) => left.left < right.right - 1 && left.right > right.left + 1 && left.top < right.bottom - 1 && left.bottom > right.top + 1;
    const card = document.querySelector(".spatial-project-card");
    const cardBox = card.getBoundingClientRect();
    const bottom = document.querySelector(".spatial-flow-bottom").getBoundingClientRect();
    if (intersects(cardBox, bottom)) failures.push("Project card overlaps playback controls");
    for (const label of document.querySelectorAll(".spatial-lane > span, .spatial-lane > small")) {
      if (intersects(cardBox, label.getBoundingClientRect())) failures.push("Project card overlaps a lane heading");
    }
    const flowBox = document.querySelector(".spatial-flow").getBoundingClientRect();
    const disclaimer = document.querySelector(".spatial-demo-disclaimer");
    const disclaimerBox = disclaimer.getBoundingClientRect();
    if (disclaimer.parentElement !== document.querySelector(".spatial-flow")) failures.push("Demo disclaimer is not an intrinsic glass-panel footer");
    if (["absolute", "fixed"].includes(getComputedStyle(disclaimer).position)) failures.push("Demo disclaimer is removed from content flow");
    if (disclaimerBox.left < flowBox.left - 1 || disclaimerBox.right > flowBox.right + 1 || disclaimerBox.top < flowBox.top - 1 || disclaimerBox.bottom > flowBox.bottom + 1) failures.push("Demo disclaimer escapes the glass panel");
    if (intersects(disclaimerBox, bottom) || intersects(disclaimerBox, cardBox)) failures.push("Demo disclaimer overlaps card or playback controls");
    if (disclaimer.scrollHeight > disclaimer.clientHeight + 1) failures.push("Demo disclaimer wraps into clipped height");
    const stages = [...document.querySelectorAll(".spatial-stage")];
    for (const stage of stages) {
      const box = stage.getBoundingClientRect();
      if (box.left < flowBox.left - 1 || box.right > flowBox.right + 1 || box.top < flowBox.top - 1 || box.bottom > flowBox.bottom + 1) {
        failures.push(`Stage trigger escapes the hero panel: ${stage.textContent.trim()}`);
      }
    }
    for (let index = 0; index < stages.length; index++) {
      for (const other of stages.slice(index + 1)) {
        if (intersects(stages[index].getBoundingClientRect(), other.getBoundingClientRect())) failures.push("Stage controls overlap");
      }
    }
    // Check glyph bounds as well as boxes: a fixed-width table cell can fit while its text paints over its neighbour.
    const textContainers = document.querySelectorAll('.spatial-capability-strip > span, .spatial-capability-strip > div > span, .spatial-demo-disclaimer, .spatial-project-card, .spatial-stage, .spatial-scope-switch button, .spatial-quote-table [role="cell"], .spatial-quote-table [role="rowheader"], .spatial-quote-table [role="columnheader"]');
    for (const container of textContainers) {
      const box = container.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim() || node.parentElement.closest('.sr-only, [aria-hidden="true"]')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const glyphs of range.getClientRects()) {
          if (!glyphs.width || !glyphs.height) continue;
          if (glyphs.left < box.left - 1 || glyphs.right > box.right + 1 || glyphs.top < box.top - 1 || glyphs.bottom > box.bottom + 1) {
            failures.push(`${container.className || container.getAttribute("role")}: clipped text ${node.textContent.trim()}`);
          }
        }
      }
    }
    return failures;
  });
  expect(collisions, "Functional text, the intrinsic project card and controls must not overlap or clip").toEqual([]);
  for (const button of await page.locator(".spatial-world button").all()) {
    if (!await button.isVisible()) continue;
    const box = await button.evaluate(element => ({ height: element.getBoundingClientRect().height, clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1 }));
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.clipped).toBe(false);
  }
}

async function expectCapabilityStrip(page, language, width) {
  const strip = page.locator(".spatial-capability-strip");
  const caption = strip.locator(":scope > span");
  const stages = strip.locator(":scope > div > span");
  await expect(stages).toHaveText(landingCopy[language].stage);
  await expect(caption).toHaveCSS("font-size", "16px");
  await expect(caption).toHaveCSS("font-weight", "500");
  await expect(caption).toHaveCSS("color", "rgb(214, 203, 225)");
  const columns = await strip.locator(":scope > div").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(/\s+/).length);
  expect(columns).toBe(width <= 420 ? 2 : width <= 820 ? 3 : 5);
  for (const stage of await stages.all()) {
    await expect(stage).toHaveCSS("font-size", width <= 820 ? "16px" : "18px");
    await expect(stage).toHaveCSS("font-weight", "550");
    await expect(stage).toHaveCSS("color", "rgb(240, 232, 248)");
    await expect(stage.locator("svg")).toHaveCSS("width", "48px");
    await expect(stage.locator("svg")).toHaveCSS("height", "48px");
  }
  for (const text of [caption, ...await stages.all()]) {
    await expect(text).toHaveCSS("font-family", /Noto Sans KR Variable/);
    await expect(text).toHaveCSS("font-style", "normal");
    expect(await text.evaluate(element => {
      let opacity = 1;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) opacity *= Number(getComputedStyle(ancestor).opacity);
      return opacity;
    }), "The stage summary must not be faded through an ancestor").toBe(1);
  }
}

async function expectLowerLandingTypography(page, width) {
  const minimums = [
    [".story-evidence-meters > div > div > span", 14], [".spatial-quote-total > div > span", 14],
    [".spatial-scope-slider > div > span", 14], [".spatial-comparison-grid strong + p", 14],
    [".spatial-comparison-grid li", 14], [".spatial-comparison-grid a", 14], [".spatial-comparison-footnote", 13],
    [".spatial-closing-link, .spatial-closing-link > span", 14], [".story-task-markers li > span:last-child", 14],
    [".spatial-quote-total small, .story-ring-figure strong small, .spatial-effort-number > span", 13],
    [".reference-story .story-panel-top > span:first-child", 15],
    [".reference-story .story-mono-label, .reference-story .story-quote-caption > span", 14],
    [".reference-story .story-timeline-row, .reference-story .story-scope-switch button", 14],
    [".reference-story .story-panel-footnote, .reference-story .spatial-effort > p", 13],
    [".reference-story .story-prism-column > small", 13],
    [".spatial-comparison-grid strong > span", 13], [".story-scope-chips > span", 12]
  ];
  const failures = await page.evaluate(rules => {
    const failures = [];
    for (const [selector, minimum] of rules) {
      const elements = document.querySelectorAll(selector);
      if (!elements.length) failures.push(`Missing readable text family: ${selector}`);
      for (const element of elements) {
        const style = getComputedStyle(element);
        if (Number.parseFloat(style.fontSize) < minimum) failures.push(`${selector}: ${style.fontSize}, expected at least ${minimum}px`);
        if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) failures.push(`Clipped explanation or action: ${element.textContent}`);
      }
    }
    const link = document.querySelector(".spatial-closing-link");
    const box = link.getBoundingClientRect();
    if (box.left < -1 || box.right > document.documentElement.clientWidth + 1) failures.push("Closing CTA escapes the viewport");
    for (const span of link.children) {
      const child = span.getBoundingClientRect();
      if (child.left < box.left - 1 || child.right > box.right + 1 || child.top < box.top - 1 || child.bottom > box.bottom + 1) failures.push("Closing CTA label escapes its button");
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const glyph of range.getClientRects()) if (glyph.left < child.left - 1 || glyph.right > child.right + 1 || glyph.top < child.top - 1 || glyph.bottom > child.bottom + 1) failures.push("Closing CTA text is clipped instead of wrapping");
      }
    }
    return failures;
  }, minimums);
  expect(failures, "Explanations, units, scope choices and closing actions must keep their readable font sizes and intrinsic wrapping").toEqual([]);
  if (width <= 580) {
    await expect(page.locator(".spatial-closing-link")).toHaveCSS("flex-direction", "column");
    const children = await page.locator(".spatial-closing-link > span").evaluateAll(elements => elements.map(element => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom })));
    expect(children[1].top).toBeGreaterThanOrEqual(children[0].bottom);
  }
}

async function expectReadableLandingText(page) {
  const failures = await page.locator(".spatial-hero-title, .spatial-stage, .spatial-project-card, .spatial-demo-disclaimer, .spatial-review-panel, .spatial-proposal, .spatial-effort-number, .story-section-heading, .spatial-comparison-heading").evaluateAll(elements => elements.flatMap(element => {
    const problems = [];
    for (let ancestor = element; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if ([...style.filter.matchAll(/blur\(([-\d.]+)px\)/g)].some(match => Number(match[1]) > 0)) problems.push(`blurred text in ${ancestor.className}`);
      if (style.perspective !== "none" || (style.transform !== "none" && !new DOMMatrixReadOnly(style.transform).is2D)) problems.push(`perspective text in ${ancestor.className}`);
    }
    if (element.matches(".spatial-demo-disclaimer")) {
      const style = getComputedStyle(element);
      if (Number.parseFloat(style.fontSize) < 12 || Number.parseFloat(style.lineHeight) < 18) problems.push("Disclaimer text is too small or tightly spaced");
      if (style.whiteSpace === "nowrap") problems.push("Disclaimer cannot wrap");
    }
    return problems;
  }));
  expect([...new Set(failures)], "Functional text must stay sharp and planar while decorative glass can remain dimensional").toEqual([]);
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
  for (const width of [320, 360, 390, 430, 768, 1024, 1100, 1440, 1920]) {
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
        await expectFinalMetricCounts(page);
        await expectCapabilityStrip(page, language, width);
        await expectLowerLandingTypography(page, width);
        for (const scene of await page.locator("[data-story-metric-scene]").all()) await expect(scene).toHaveAttribute("data-story-entry-state", "complete");
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
        // The duplicate visual bar column is decorative on every viewport.
        await expect(table.getByRole("columnheader")).toHaveCount(3);
        for (const bars of await table.locator(".story-grid-effort").all()) await expect(bars).toHaveAttribute("aria-hidden", "true");
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

async function cssTravelOffset(path) {
  return path.evaluate(element => getComputedStyle(element).strokeDashoffset);
}

async function expectCssTravelMoving(path) {
  await expect(path).toHaveCSS("animation-play-state", "running");
  const first = await cssTravelOffset(path);
  await expect.poll(() => cssTravelOffset(path), { message: "Visible CSS travel must change its rendered dash offset" }).not.toBe(first);
}

async function expectCssTravelFrozen(path) {
  await expect(path).toHaveCSS("animation-play-state", "paused");
  const first = await cssTravelOffset(path);
  await path.page().waitForTimeout(350);
  expect(await cssTravelOffset(path), "Paused CSS travel must retain the rendered dash offset").toBe(first);
}

test("ambient CSS travel moves on screen and freezes for hover, offscreen, explicit pause and visibility signals", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.mouse.move(0, 0);
  const hero = page.locator(".scene-hero-light");
  const heroTravel = hero.locator(".scene-travel").first();
  const footer = page.locator(".scene-footer-light");
  const footerTravel = footer.locator(".scene-travel").first();
  await expect(hero).toHaveAttribute("data-ambient-visible", "true");
  await expectCssTravelMoving(heroTravel);
  await page.locator(".spatial-stage").first().hover();
  await expectCssTravelFrozen(heroTravel);
  await page.mouse.move(0, 0);
  await expectCssTravelMoving(heroTravel);
  await page.locator("#audience").scrollIntoViewIfNeeded();
  await expect(hero).toHaveAttribute("data-ambient-visible", "false");
  await expectCssTravelFrozen(heroTravel);
  await expect(footer).toHaveAttribute("data-ambient-visible", "true");
  await expectCssTravelMoving(footerTravel); // A different visible layer keeps moving independently.
  await page.locator(".spatial-motion-toggle").click();
  await releaseSpatialInteraction(page);
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-paused", "true");
  await page.locator("#audience").scrollIntoViewIfNeeded();
  await expect(footer).toHaveAttribute("data-ambient-visible", "true");
  await expectCssTravelFrozen(footerTravel);
  await page.locator(".spatial-motion-toggle").click();
  await releaseSpatialInteraction(page);
  await page.locator("#audience").scrollIntoViewIfNeeded();
  await expectCssTravelMoving(footerTravel);
  // Exercise the visibility listener with a controlled document signal, without depending on headless tab policy.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-paused", "true");
  await expectCssTravelFrozen(footerTravel);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectCssTravelMoving(footerTravel);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(footerTravel).toHaveCSS("display", "none");
  await expect(footerTravel).toHaveCSS("animation-name", "none");
  await expect(page.locator(".scene-fog-drift").first()).toHaveCSS("animation-name", "none");
});

for (const width of [390, 820]) {
  test(`mobile atmosphere ${width}px: travel, particles and fog animation stay disabled`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    for (const path of await page.locator(".scene-travel").all()) await expect(path).toHaveCSS("display", "none");
    await expect(page.locator(".scene-particles")).toHaveCSS("display", "none");
    for (const fog of await page.locator(".scene-fog-drift, .scene-fog-cool").all()) await expect(fog).toHaveCSS("animation-name", "none");
    await expect(page.locator(".story-prism-cap")).toHaveCount(0);
  });
}

for (const language of ["ko", "en"]) {
  for (const width of [320, 390, 768, 1440, 1920]) {
    test(`landing ${language} ${width}px: connected prisms keep real task labels, ratios and one baseline across scope changes`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await page.evaluate(() => document.fonts.ready);
      const scopes = page.getByRole("group", { name: landingCopy[language].scope });
      const chart = page.locator(".story-prism-chart");
      const allLabels = language === "ko"
        ? ["예약 화면 · 시간 선택", "관리자 예약 관리", "반응형 · 검수", "고객 예약 변경"]
        : ["Booking · time selection", "Admin booking management", "Responsive design · QA", "Customer rescheduling"];
      for (const extended of [false, true, false, true]) {
        const days = extended ? [5, 3.5, 1.5, 3] : [5, 3.5, 1.5];
        await scopes.getByRole("button", { name: new RegExp(`^${extended ? landingCopy[language].extended : landingCopy[language].essential}`) }).click();
        await page.locator(".spatial-effort").scrollIntoViewIfNeeded();
        await expect(page.locator(".spatial-effort")).toHaveAttribute("data-ambient-visible", "true");
        await expect(chart).toHaveAttribute("data-count", String(days.length));
        const columns = chart.locator(".story-prism-column");
        await expect(columns).toHaveCount(days.length);
        await expect(columns.locator(":scope > small")).toHaveText(allLabels.slice(0, days.length));
        await expect(columns.locator(".spatial-bar-label")).toHaveText(days.map(value => `${value}${language === "ko" ? "일" : " days"}`));
        await expect(page.locator(".spatial-effort-number")).toHaveText(`${extended ? 13 : 10}${language === "ko" ? "일" : " days"}`);
        await expect(chart.locator(".story-prism-cap")).toHaveCount(0);
        for (const column of await columns.all()) {
          await expect(column).toHaveCSS("opacity", "1");
          await expect(column).toHaveCSS("transform", "none");
          await expect(column).toHaveCSS("display", "contents");
          await expect(column.locator(".story-prism-stack")).toHaveCSS("grid-row-start", "1");
          await expect(column.locator(":scope > small")).toHaveCSS("grid-row-start", "2");
          await expect(column.locator(".spatial-bar-label")).toHaveCSS("font-size", width <= 480 ? "14px" : "16px");
          await expect(column.locator(":scope > small")).toHaveCSS("font-size", width <= 480 ? "12px" : "14px");
        }
        for (const prism of await chart.locator(".spatial-bar").all()) {
          await expect(prism).toHaveCSS("opacity", "1");
          await expect(prism).toHaveCSS("transform-style", "preserve-3d");
          await expect(prism.locator(":scope > i")).toHaveCount(3);
          if (extended && width <= 480) await expect(prism).toHaveCSS("width", "28px");
        }
        await expect.poll(() => chart.evaluate((element, effortDays) => {
          const failures = [];
          const panel = element.closest(".spatial-effort").getBoundingClientRect();
          const bars = [...element.querySelectorAll(".spatial-bar")];
          const bottoms = bars.map(bar => bar.getBoundingClientRect().bottom);
          if (Math.max(...bottoms) - Math.min(...bottoms) > 1) failures.push("Unequal task-label wrapping shifted the common baseline");
          const ratios = bars.map((bar, index) => Number.parseFloat(getComputedStyle(bar).height) / effortDays[index]);
          if (Math.max(...ratios) - Math.min(...ratios) > 0.05) failures.push("Bar heights are not proportional to actual task days");
          const overlaps = (a, b) => Math.min(a.right, b.right) >= Math.max(a.left, b.left) - 1 && Math.min(a.bottom, b.bottom) >= Math.max(a.top, b.top) - 1;
          const colors = new Map();
          for (const bar of bars) {
            const front = bar.querySelector(".story-prism-front").getBoundingClientRect();
            const side = bar.querySelector(".story-prism-side").getBoundingClientRect();
            const top = bar.querySelector(".story-prism-top").getBoundingClientRect();
            if (!overlaps(top, front) || !overlaps(top, side)) failures.push("A top face detached from its front or side");
            for (const face of bar.children) {
              const box = face.getBoundingClientRect();
              if (box.width <= 0.5 || box.height <= 0.5) failures.push("A prism face has flattened");
              if (box.left < panel.left - 1 || box.right > panel.right + 1 || box.top < panel.top - 1 || box.bottom > panel.bottom + 1) failures.push("A prism face escaped its panel");
              const color = getComputedStyle(face).background;
              if (colors.has(face.className) && colors.get(face.className) !== color) failures.push("Equivalent prism faces use inconsistent palettes");
              colors.set(face.className, color);
            }
          }
          for (const label of element.querySelectorAll(".spatial-bar-label, .story-prism-column > small")) {
            const box = label.getBoundingClientRect();
            const column = label.closest(".story-prism-column").querySelector(".story-prism-stack").getBoundingClientRect();
            if (label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1) failures.push(`Clipped label: ${label.textContent}`);
            const range = document.createRange(); range.selectNodeContents(label);
            for (const glyph of range.getClientRects()) if (glyph.left < column.left - 1 || glyph.right > column.right + 1 || glyph.top < box.top - 1 || glyph.bottom > box.bottom + 1) failures.push(`Escaping text: ${label.textContent}`);
          }
          if (document.documentElement.scrollWidth > document.documentElement.clientWidth) failures.push("Page overflow");
          return failures;
        }, days), { message: "Prisms must remain attached, proportionate, aligned and readable after every scope change" }).toEqual([]);
      }
    });
  }

  for (const width of [320, 430, 1440]) {
    test(`landing ${language} ${width}px: fallback fonts and longer fictional text preserve intrinsic card layout`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
      await page.route(/\.(?:woff2?|ttf|otf)(?:\?.*)?$/, route => route.abort());
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await page.addStyleTag({ content: ".spatial-world, .spatial-world * { font-family: Arial, sans-serif !important; }" });
      const requests = watchLandingApiRequests(page);
      await page.locator(".spatial-demo-disclaimer").evaluate((element, locale) => {
        element.textContent += locale === "ko"
          ? " 실제 고객의 개인정보나 저장된 프로젝트를 사용하지 않는 검토용 가상의 예시입니다."
          : " This readable fictional demonstration does not use any real client information or saved project data.";
      }, language);
      for (let stage = 0; stage < 5; stage++) {
        await page.locator(".spatial-stage").nth(stage).click();
        await page.locator(".spatial-card-detail p").evaluate((element, locale) => {
          element.textContent += locale === "ko"
            ? " 고객이 예약 시간을 확인하고 변경할 수 있도록, 확인할 정책과 상세 작업 범위를 함께 검토하는 가상의 예시입니다."
            : " This fictional example also reviews booking changes, the cancellation policy, and the detailed work needed before the client approves the proposal.";
        }, language);
        await expectSpatialLayout(page);
        await expectReadableLandingText(page);
        const geometry = await page.locator(".spatial-project-card").evaluate(element => ({ position: getComputedStyle(element).position, scroll: element.scrollHeight, client: element.clientHeight }));
        expect(geometry.position).not.toBe("absolute");
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
      }
      expect(requests).toEqual([]);
    });
  }
}

for (const language of ["ko", "en"]) {
  test(`landing ${language} desktop: animated content stays sharp and the disclaimer remains inside the glass`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".spatial-world")).toHaveCSS("font-family", /Noto Sans KR Variable/);
    for (let stage = 0; stage < 5; stage++) {
      await page.locator(".spatial-stage").nth(stage).click();
      await expectReadableLandingText(page);
      await expectSpatialLayout(page);
    }
    for (const selector of ["#evidence", "#review", "#scope-comparison"]) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      await expectReadableLandingText(page);
    }
  });
}

for (const language of ["ko", "en"]) {
  for (const width of [420, 421, 820, 821]) {
    test(`stage summary ${language} ${width}px: breakpoint labels remain large, sharp and unclipped`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await page.evaluate(() => document.fonts.ready);
      await page.locator(".spatial-capability-strip").scrollIntoViewIfNeeded();
      await expectCapabilityStrip(page, language, width);
      await expectSpatialLayout(page);
    });
  }
}

for (const width of [320, 1440]) {
  test(`landing to auth ${width}px: default mascot names localize and switch back without clipping`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "en"));
    const requests = watchLandingApiRequests(page);
    await page.goto("/");
    await page.locator(".hero-actions .primary-button").click();
    await expect(page.locator(".auth-companion strong")).toHaveText(["Calm", "Clear", "Steady"]);
    expect(await page.locator(".auth-companions").innerText()).not.toMatch(/[가-힣]/);
    await page.getByRole("combobox", { name: "Interface language" }).selectOption("ko");
    await expect(page.locator(".auth-companion strong")).toHaveText(["차근", "또렷", "든든"]);
    await page.getByRole("combobox", { name: "표시 언어" }).selectOption("en");
    await expect(page.locator(".auth-companion strong")).toHaveText(["Calm", "Clear", "Steady"]);
    for (const name of await page.locator(".auth-companion strong").all()) {
      expect(await name.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(requests).toEqual([]);
  });
}

async function scrollBrandMerge(page, progress) {
  return page.evaluate(value => {
    const stage = document.querySelector(".story-brand-stage").getBoundingClientRect();
    const target = document.querySelector("[data-story-brand-target]").getBoundingClientRect();
    // Derive the documented scroll range from current DOM geometry, including translated copy and responsive fonts.
    const start = scrollY + stage.top + stage.height / 2 - innerHeight * 0.70;
    const end = scrollY + target.top + target.height / 2 - innerHeight * 0.65;
    const destination = start + (end - start) * value + (value === 1 ? 2 : value === 0 ? -2 : 0);
    window.scrollTo({ top: destination, behavior: "instant" });
    return { start, end };
  }, progress);
}

async function expectBrandCopyClearance(page) {
  const geometry = await page.evaluate(() => {
    const copy = document.querySelector("[data-story-brand-copy]").getBoundingClientRect();
    const mark = document.querySelector("[data-story-brand-mark]").getBoundingClientRect();
    const plate = document.querySelector("[data-story-brand-plate]").getBoundingClientRect();
    return { gap: mark.top - copy.bottom, copyTop: copy.top - plate.top, copyLeft: copy.left - plate.left, copyRight: plate.right - copy.right, logoBottom: plate.bottom - mark.bottom };
  });
  // offsetTop/offsetHeight are integer layout metrics; allow only subpixel rounding.
  expect(geometry.gap + 0.75, "Brand copy needs at least 24px of clearance above the F").toBeGreaterThanOrEqual(24);
  for (const key of ["copyTop", "copyLeft", "copyRight", "logoBottom"]) expect(geometry[key], `${key} must stay inside the readable full plate`).toBeGreaterThanOrEqual(-1);
}

async function brandPlateClip(page) {
  return page.locator("[data-story-brand-plate]").evaluate(element => {
    const clipPath = getComputedStyle(element).clipPath;
    const parts = clipPath.match(/^inset\((.*?)\s+round/);
    const tokens = parts ? parts[1].trim().split(/\s+/) : ["0"];
    const [top, right = top, bottom = top, left = right] = tokens;
    const pixels = (value, size) => Number.parseFloat(value) * (value.endsWith("%") ? size / 100 : 1);
    const mark = document.querySelector("[data-story-brand-mark]");
    return {
      width: element.clientWidth - pixels(right, element.clientWidth) - pixels(left, element.clientWidth),
      height: element.clientHeight - pixels(top, element.clientHeight) - pixels(bottom, element.clientHeight),
      fullWidth: element.clientWidth, fullHeight: element.clientHeight,
      rounding: Number.parseFloat(clipPath.match(/\sround\s+([\d.]+)px/)?.[1] ?? "0"),
      sideDifference: Math.abs(pixels(left, element.clientWidth) - pixels(right, element.clientWidth)),
      markWidth: mark.offsetWidth, markHeight: mark.offsetHeight
    };
  });
}

async function brandMergeGeometry(page, progress) {
  const measured = await page.evaluate(() => {
    const mark = document.querySelector("[data-story-brand-mark]");
    const target = document.querySelector("[data-story-brand-target]");
    const stage = document.querySelector(".story-brand-stage").getBoundingClientRect();
    const from = mark.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const origin = { x: stage.left + stage.width / 2, y: stage.top + mark.offsetTop };
    const cards = [...document.querySelector("[data-story-merge-card]").parentElement.querySelectorAll(".story-benefit-card")];
    const blocks = cards.map(card => [...card.querySelectorAll(":scope > h3, :scope > p:not(.story-panel-footnote)")]);
    const left = Math.max(...blocks[0].map(block => block.getBoundingClientRect().right));
    const right = Math.min(...blocks[1].map(block => block.getBoundingClientRect().left));
    const size = Math.min(mark.offsetWidth * .64, Math.max(36, right - left - 20));
    const copyBottom = Math.max(...blocks.flatMap((items, index) => {
      const transform = getComputedStyle(cards[index]).transform;
      const revealY = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
      return items.map(block => block.getBoundingClientRect().bottom - revealY);
    }));
    const drift = innerHeight * 0.12;
    const visible = [mark, target].filter(element => {
      let opacity = 1;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Number(style.opacity);
      }
      return opacity > 0.01;
    });
    // Check the rendered F against actual text line boxes, independently of
    // the sampled path. Whole paragraphs include empty trailing whitespace.
    const copyRects = blocks.flat().flatMap(block => {
      const range = document.createRange();
      range.selectNodeContents(block);
      return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        text: block.textContent.trim(),
      }));
    });
    const copyOverlaps = visible.flatMap(element => {
      const logo = element.getBoundingClientRect();
      return copyRects.flatMap(rect => {
        const width = Math.min(logo.right, rect.right) - Math.max(logo.left, rect.left);
        const height = Math.min(logo.bottom, rect.bottom) - Math.max(logo.top, rect.top);
        return width > .75 && height > .75 ? [{ text: rect.text, width, height, logo: element === target ? "target" : "source" }] : [];
      });
    });
    return {
      scrollProgress: (innerHeight * .70 - stage.top - stage.height / 2) / (to.top + to.height / 2 - innerHeight * .65 - stage.top - stage.height / 2 + innerHeight * .70),
      origin, drift, markWidth: mark.offsetWidth,
      actual: { x: from.left + from.width / 2, y: from.top + from.height / 2, width: from.width },
      flightGeometry: {
        start: { x: 0, y: drift, scale: 1 }, corridorX: (left + right) / 2 - origin.x,
        clearY: copyBottom - origin.y + size / 2 + 20,
        destination: { x: to.left + to.width / 2 - origin.x, y: to.top + to.height / 2 - origin.y, scale: to.width / mark.offsetWidth },
        compactScale: size / mark.offsetWidth,
      },
      copyBlockCount: blocks.flat().length, copyTextRectCount: copyRects.length, copyOverlaps,
      visibleCount: visible.length,
      active: visible[0] === target ? "target" : "source",
      left: from.left,
      right: from.right,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      targetInsideCard: (() => {
        const card = document.querySelector("[data-story-merge-card]").getBoundingClientRect();
        return to.left >= card.left && to.right <= card.right && to.top >= card.top && to.bottom <= card.bottom;
      })()
    };
  });
  // The timeline eases one scalar playhead. Reuse the production sampler so
  // this test can validate DOM integration without another Bézier implementation.
  const currentProgress = progress ?? measured.scrollProgress;
  const flightProgress = Math.max(0, Math.min(1, (currentProgress - .46) / .54));
  const eased = flightProgress < .5 ? 2 * flightProgress * flightProgress : 1 - Math.pow(-2 * flightProgress + 2, 2) / 2;
  const expected = currentProgress <= .46
    ? { x: 0, y: measured.drift * Math.max(0, currentProgress) / .46, scale: 1 }
    : createBrandFlight(measured.flightGeometry).sample(eased);
  return {
    ...measured,
    error: Math.max(
      Math.abs(measured.actual.x - measured.origin.x - expected.x),
      Math.abs(measured.actual.y - measured.origin.y - expected.y),
      Math.abs(measured.actual.width - measured.markWidth * expected.scale),
    ),
  };
}

for (const language of ["ko", "en"]) {
  test(`header home ${language}: an unchanged top hash still returns a manually scrolled page to the hero`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
    await page.goto("/#top");
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.evaluate(() => document.fonts.ready);
    const home = page.locator(".nav-shell .brand");
    for (const y of [377, 720]) {
      await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), y);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
      await expect(page).toHaveURL(/#top$/);
      await home.click();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await expect(page).toHaveURL(/#top$/);
    }
  });

  for (const width of [1024, 1440]) {
    test(`brand merge ${language} ${width}px: full plate holds, folds, merges one logo, reverses and realigns after resize`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await page.evaluate(() => document.fonts.ready);
      const mark = page.locator("[data-story-brand-mark]");
      const target = page.locator("[data-story-brand-target]");
      await expect(mark).toHaveCount(1);
      await expect(target).toHaveCount(1);
      // Observe every rendered style change, not only settled scroll checkpoints.
      await page.locator("[data-story-brand-plate]").evaluate(element => {
        const samples = [];
        const capture = () => {
          const clip = getComputedStyle(element).clipPath;
          const shape = clip.match(/^inset\((.*?)\s+round\s+([\d.]+)px/);
          if (!shape) { samples.push({ clip, radius: 0, difference: Infinity }); return; }
          const values = shape[1].trim().split(/\s+/).map(Number.parseFloat);
          const [top, right = top, bottom = top, left = right] = values;
          const plate = element.getBoundingClientRect();
          const copy = document.querySelector("[data-story-brand-copy]");
          const text = copy.getBoundingClientRect();
          const visibleText = Number(getComputedStyle(copy).opacity) > .025;
          const textClear = !visibleText || (text.top >= plate.top + top - .75 && text.bottom <= plate.bottom - bottom + .75 && text.left >= plate.left + left - .75 && text.right <= plate.right - right + .75);
          samples.push({ radius: Number(shape[2]), difference: Math.abs(left - right), textClear });
        };
        const observer = new MutationObserver(capture);
        observer.observe(element, { attributes: true, attributeFilter: ["style"] });
        capture();
        window.__brandFoldObservation = { samples, stop: () => observer.disconnect() };
      });
      for (const progress of [-0.1, 0, 0.08, 0.12, 0.13, 0.2, 0.29, 0.38, 0.46, 0.6, 0.7, 0.75, 0.8, 0.9, 0.99, 1, 0.9, 0.8, 0.7, 0.46, 0.38, 0.29, 0.2, 0.13, 0.08, 0]) {
        const range = await scrollBrandMerge(page, progress);
        expect(range.end).toBeGreaterThan(range.start);
        await expect.poll(async () => (await brandMergeGeometry(page, progress)).error, { message: "The source logo must follow a continuous measured path, including reverse scrolling" }).toBeLessThanOrEqual(3);
        await expect.poll(async () => {
          const geometry = await brandMergeGeometry(page, progress);
          return `${geometry.visibleCount}:${geometry.active}`;
        }).toBe(progress === 1 ? "1:target" : "1:source");
        const geometry = await brandMergeGeometry(page, progress);
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
        expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.clientWidth);
        expect(geometry.left).toBeGreaterThanOrEqual(-1);
        expect(geometry.right).toBeLessThanOrEqual(geometry.clientWidth + 1);
        expect(geometry.targetInsideCard).toBe(true);
        if (progress >= .46) {
          expect(geometry.copyBlockCount, "Both benefit headings and both introductory paragraphs must be measured").toBe(4);
          expect(geometry.copyTextRectCount, "The overlap check must include rendered text lines").toBeGreaterThanOrEqual(4);
          expect(geometry.copyOverlaps, `The visible F must clear both cards' text at progress ${progress}, including on reverse scroll`).toEqual([]);
        }
        if (progress <= 0.13) await expectBrandCopyClearance(page);
        if (progress >= 0.12 && progress <= 0.46) {
          // Scalar CSS variables preserve symmetry even when CSSOM shortens the shape string.
          await expect.poll(async () => (await brandPlateClip(page)).rounding, { message: "Fold corners must retain their initial rounding in both scroll directions" }).toBeGreaterThanOrEqual(20);
          await expect.poll(async () => (await brandPlateClip(page)).sideDifference, { message: "Left and right clip insets must remain equal throughout the fold" }).toBeLessThanOrEqual(0.001);
        }
        if (progress <= 0.12) {
          const fullStage = await page.locator(".story-brand-stage").evaluate(element => ({ width: element.clientWidth, height: element.clientHeight, page: document.documentElement.clientWidth, left: element.getBoundingClientRect().left }));
          expect(fullStage.left).toBeCloseTo(0, 0);
          expect(fullStage.width).toBe(fullStage.page);
          expect(fullStage.width / fullStage.height).toBeCloseTo(2.6, 1);
          await expect(page.locator("[data-story-brand-copy]")).toHaveCSS("opacity", "1");
          await expect(page.locator("[data-story-brand-plate]")).toHaveCSS("opacity", "1");
          await expect.poll(async () => {
            const clip = await brandPlateClip(page);
            return Math.max(Math.abs(clip.width - clip.fullWidth), Math.abs(clip.height - clip.fullHeight));
          }, { message: "The plate must be fully open on first visibility and through the reading hold, including on reverse scroll" }).toBeLessThanOrEqual(2);
        } else if (progress === 0.29) {
          await expect.poll(async () => {
            const clip = await brandPlateClip(page);
            return clip.width > clip.markWidth * 1.7 && clip.width < clip.fullWidth - 3 && clip.height > clip.markHeight * 1.7 && clip.height < clip.fullHeight - 3;
          }, { message: "Further scroll must produce a genuine intermediate fold before the source starts flying" }).toBe(true);
        } else if (progress >= 0.46) {
          await expect(page.locator("[data-story-brand-copy]")).toHaveCSS("opacity", "0");
          await expect.poll(async () => {
            const clip = await brandPlateClip(page);
            return clip.width > 0 && clip.height > 0 && clip.width <= clip.markWidth * 1.7 && clip.height <= clip.markHeight * 1.7;
          }, { message: "The full plate must collapse to the source mark before travel begins" }).toBe(true);
        }
      }
      const frames = await page.evaluate(() => {
        window.__brandFoldObservation.stop();
        return window.__brandFoldObservation.samples;
      });
      expect(frames.length, "Both scroll directions must produce intermediate rendered fold frames").toBeGreaterThan(10);
      expect(frames.every(frame => frame.textClear), "Readable text must fade before the collapsing edge reaches it, including intermediate scrub frames").toBe(true);
      expect(frames.filter(frame => frame.radius < 20 || frame.radius > 28 || frame.difference > 0.001), "No forward or reverse frame may lose rounding or horizontal symmetry").toEqual([]);
      await page.setViewportSize({ width: width === 1440 ? 1100 : 1440, height: 820 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await scrollBrandMerge(page, .75);
      await expect.poll(async () => (await brandMergeGeometry(page, .75)).error, { message: "Resize must rebuild the intermediate corridor path, not only its endpoint" }).toBeLessThanOrEqual(3);
      expect((await brandMergeGeometry(page, .75)).copyOverlaps, "The resized flight must still clear actual benefit text").toEqual([]);
      await page.setViewportSize({ width: 390, height: 900 });
      await expect(mark).not.toHaveAttribute("style", /translate/);
      await page.setViewportSize({ width: width + 200, height: 900 });
      // Do not scroll after restoring the desktop breakpoint: a refresh must
      // repaint the numeric flight even when GSAP suppresses timeline callbacks.
      await expect.poll(async () => (await brandMergeGeometry(page)).error, { message: "Breakpoint restoration must paint the current F pose without another scroll" }).toBeLessThanOrEqual(3);
      const restoredFlight = await brandMergeGeometry(page);
      expect(restoredFlight.visibleCount).toBe(1);
      expect(restoredFlight.copyOverlaps).toEqual([]);
      await scrollBrandMerge(page, 1);
      await expect.poll(async () => (await brandMergeGeometry(page, 1)).error).toBeLessThanOrEqual(3);
      await expect(target).toHaveCSS("visibility", "visible");
      await expect(mark).toHaveCSS("visibility", "hidden");
      expect((await brandMergeGeometry(page, 1)).visibleCount).toBe(1);
      await scrollBrandMerge(page, 0);
      await expect.poll(async () => (await brandMergeGeometry(page, 0)).error).toBeLessThanOrEqual(3);
      await expectBrandCopyClearance(page);
    });
  }

  for (const [width, reducedMotion] of [[320, "no-preference"], [390, "reduce"], [820, "no-preference"], [1440, "reduce"]]) {
    test(`brand merge ${language} ${width}px ${reducedMotion}: static source and destination keep intrinsic copy clearance`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const mark = page.locator("[data-story-brand-mark]");
      const target = page.locator("[data-story-brand-target]");
      await page.evaluate(() => document.fonts.ready);
      const original = await mark.evaluate(element => {
        const box = element.getBoundingClientRect();
        return { x: box.left, y: box.top + scrollY, width: box.width };
      });
      for (const progress of [0, 0.5, 1, 0]) {
        await scrollBrandMerge(page, progress);
        await expect(page.locator("[data-story-brand-plate]")).toHaveCSS("clip-path", "none");
        await expect(page.locator("[data-story-brand-copy]")).toHaveCSS("opacity", "1");
        await expect(target).toHaveCSS("visibility", "visible");
        await expectBrandCopyClearance(page);
        const current = await mark.evaluate(element => {
          const box = element.getBoundingClientRect();
          return { x: box.left, y: box.top + scrollY, width: box.width };
        });
        expect(current.x).toBeCloseTo(original.x, 0);
        expect(current.y).toBeCloseTo(original.y, 0);
        expect(current.width).toBeCloseTo(original.width, 0);
      }
    });
  }
}

async function expectFinalMetricCounts(page, extended = false) {
  const expected = extended ? ["13", "04", "13", "3.9"] : ["10", "03", "10", "3.0"];
  await expect(page.locator("[data-story-count]")).toHaveText(expected);
  await expect(page.locator("[data-story-count] + .sr-only")).toHaveText(expected);
  for (const count of await page.locator("[data-story-count]").all()) await expect(count).toHaveAttribute("aria-hidden", "true");
  await expectTaskMarkerList(page, extended);
}

async function expectTaskMarkerList(page, extended = false) {
  const language = await page.locator("html").getAttribute("lang");
  const labels = (language === "ko"
    ? ["예약 화면 · 시간 선택", "관리자 예약 관리", "반응형 · 검수", "고객 예약 변경"]
    : ["Booking · time selection", "Admin booking management", "Responsive design · QA", "Customer rescheduling"]).slice(0, extended ? 4 : 3);
  const list = page.locator(".story-task-markers");
  await expect(list).toHaveJSProperty("tagName", "UL");
  await expect(list).toHaveAccessibleName(language === "ko" ? "작업 범위" : "Work scope");
  await expect(list.getByRole("listitem")).toHaveCount(labels.length);
  await expect(list.locator("li > span:last-child")).toHaveText(labels);
  await expect(list.locator("li > span:first-child")).toHaveText(labels.map((_, index) => String(index + 1).padStart(2, "0")));
  for (const chip of await list.locator("li > span:first-child").all()) await expect(chip).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator('.spatial-quote-table [role="rowheader"]')).toHaveText(labels);
  await expect(page.locator(".story-sample-columns [data-story-sparkline], .story-sample-columns [data-story-spark-point], .story-task-markers svg")).toHaveCount(0);
}

for (const language of ["ko", "en"]) {
  test(`metric entry ${language}: intermediate counts, ring and truthful task-list stagger settle once and follow changed scope`, async ({ page }) => {
    await openClockedLanding(page, language);
    const ringScene = page.locator(".story-dashboard-ring[data-story-metric-scene]");
    const ring = ringScene.locator("[data-story-ring]");
    const samples = page.locator(".story-sample-columns");
    await expect(ringScene).toHaveAttribute("data-story-entry-state", "waiting");
    await expectFinalMetricCounts(page); // Offscreen content is already semantically correct, without a timer.
    expect(await ring.evaluate(element => element.style.strokeDasharray)).toBe("");
    await expectTaskMarkerList(page);
    for (const marker of await samples.locator("[data-story-task-marker]").all()) {
      expect(await marker.evaluate(element => element.style.opacity)).toBe("");
      expect(await marker.evaluate(element => element.style.transform)).toBe("");
    }
    await ringScene.scrollIntoViewIfNeeded();
    await expect(ringScene).toHaveAttribute("data-story-entry-state", "running");
    await expect(ringScene.locator("[data-story-count] + .sr-only")).toHaveText("10");
    await page.clock.runFor(250);
    const halfwayCount = Number(await ringScene.locator("[data-story-count]").innerText());
    expect(halfwayCount).toBeGreaterThan(0);
    expect(halfwayCount).toBeLessThan(10);
    const ringFill = await ring.evaluate(element => Number.parseFloat(getComputedStyle(element).strokeDasharray));
    expect(ringFill).toBeGreaterThan(0);
    expect(ringFill).toBeLessThan(10 / 13 * 100);
    await expect(ringScene.locator("[data-story-count] + .sr-only")).toHaveText("10");
    // Invoke the real scope control without scrolling away, so revision cleanup is tested during an active tween.
    const choices = page.getByRole("group", { name: landingCopy[language].scope });
    await choices.getByRole("button", { name: new RegExp(`^${landingCopy[language].extended}`) }).evaluate(button => button.click());
    await expect(ringScene.locator("[data-story-count]")).toHaveText("13");
    await expect(ringScene.locator("[data-story-count] + .sr-only")).toHaveText("13");
    await page.clock.runFor(1800);
    await expect(ringScene.locator("[data-story-count]")).toHaveText("13");
    expect(Number.parseFloat(await ring.getAttribute("stroke-dasharray"))).toBe(100);
    await choices.getByRole("button", { name: new RegExp(`^${landingCopy[language].essential}`) }).evaluate(button => button.click());
    await page.clock.runFor(1800);
    await expect(ringScene).toHaveAttribute("data-story-entry-state", "complete");
    expect(await ring.evaluate(element => element.style.strokeDasharray)).toBe("");
    expect(Number.parseFloat(await ring.getAttribute("stroke-dasharray"))).toBeCloseTo(10 / 13 * 100, 6);

    await samples.scrollIntoViewIfNeeded();
    const sampleScenes = samples.locator("[data-story-metric-scene]");
    for (const scene of await sampleScenes.all()) await expect(scene).toHaveAttribute("data-story-entry-state", "running");
    await expect(samples.locator("[data-story-count] + .sr-only")).toHaveText(["03", "10", "3.0"]);
    await page.clock.runFor(250);
    const countValues = (await samples.locator("[data-story-count]").allTextContents()).map(Number);
    for (const [index, final] of [3, 10, 3].entries()) {
      expect(countValues[index]).toBeGreaterThan(0);
      expect(countValues[index]).toBeLessThan(final);
    }
    await expectTaskMarkerList(page); // Tasks remain complete and accessible while decoration staggers.
    const markerOpacity = await samples.locator("[data-story-task-marker]").evaluateAll(elements => elements.map(element => Number(getComputedStyle(element).opacity)));
    expect(markerOpacity[0]).toBeGreaterThan(markerOpacity.at(-1));
    expect(markerOpacity.at(-1)).toBeGreaterThanOrEqual(0.35);
    await page.clock.runFor(400);
    const segmentOpacity = await samples.locator("[data-story-segment]").evaluateAll(elements => elements.map(element => Number(getComputedStyle(element).opacity)));
    expect(segmentOpacity[0]).toBeGreaterThan(segmentOpacity.at(-1));
    await expect(samples.locator("[data-story-count] + .sr-only")).toHaveText(["03", "10", "3.0"]);
    await page.clock.runFor(1800);
    for (const scene of await sampleScenes.all()) await expect(scene).toHaveAttribute("data-story-entry-state", "complete");
    await expectFinalMetricCounts(page);
    await expectTaskMarkerList(page);
    for (const element of await samples.locator("[data-story-segment], [data-story-task-marker]").all()) {
      expect(await element.evaluate(node => node.style.opacity)).toBe("");
      expect(await element.evaluate(node => node.style.transform)).toBe("");
    }

    await page.locator("#workflow").scrollIntoViewIfNeeded();
    await samples.scrollIntoViewIfNeeded();
    await page.clock.runFor(100);
    for (const scene of await sampleScenes.all()) await expect(scene).toHaveAttribute("data-story-entry-state", "complete");
    await expectFinalMetricCounts(page); // Reentry cannot restart completed counts.
    for (const extended of [true, false, true]) {
      const copy = landingCopy[language];
      await page.getByRole("group", { name: copy.scope }).getByRole("button", { name: new RegExp(`^${extended ? copy.extended : copy.essential}`) }).click();
      await expectFinalMetricCounts(page, extended);
      await page.clock.runFor(2000);
      await expectFinalMetricCounts(page, extended); // A stale essential-scope tween cannot overwrite new props.
      expect(Number.parseFloat(await ring.getAttribute("stroke-dasharray"))).toBeCloseTo((extended ? 13 : 10) / 13 * 100, 6);
      await expectTaskMarkerList(page, extended);
      await expect(samples.locator("[data-story-segment].is-active")).toHaveCount(extended ? 13 : 10);
    }
  });
}

for (const width of [580, 581]) {
  test(`English closing CTA ${width}px: readable labels wrap inside the action at its stacking boundary`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "en"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".spatial-closing-link").scrollIntoViewIfNeeded();
    await expectLowerLandingTypography(page, width);
    await expectSpatialLayout(page);
  });
}

for (const interruption of ["offscreen", "visibility", "reduced-motion"]) {
  test(`metric entry ${interruption}: interrupting a count settles to its true result and does not replay`, async ({ page }) => {
    await openClockedLanding(page);
    const scene = page.locator(".story-dashboard-ring[data-story-metric-scene]");
    await scene.scrollIntoViewIfNeeded();
    await expect(scene).toHaveAttribute("data-story-entry-state", "running");
    await page.clock.runFor(200);
    if (interruption === "offscreen") await page.locator("#audience").scrollIntoViewIfNeeded();
    if (interruption === "reduced-motion") await page.emulateMedia({ reducedMotion: "reduce" });
    if (interruption === "visibility") await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(scene).toHaveAttribute("data-story-entry-state", "complete");
    await expect(scene.locator("[data-story-count]")).toHaveText("10");
    await expect(scene.locator("[data-story-count] + .sr-only")).toHaveText("10");
    if (interruption === "reduced-motion") await page.emulateMedia({ reducedMotion: "no-preference" });
    if (interruption === "visibility") await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await scene.scrollIntoViewIfNeeded();
    await page.clock.runFor(2000);
    await expect(scene).toHaveAttribute("data-story-entry-state", "complete");
    await expect(scene.locator("[data-story-count]")).toHaveText("10");
  });
}

test("desktop opening completes with a contracting centered shell and no loading or input gate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    window.__introFrames = [];
    const observer = new MutationObserver(records => {
      const intro = document.querySelector("[data-story-intro]");
      if (!intro || !records.some(record => record.target instanceof Element && (record.target === intro || intro.contains(record.target)))) return;
      if (getComputedStyle(intro).display === "none") return;
      const shellElement = intro.querySelector(".spatial-intro-shell");
      const markElement = intro.querySelector(".spatial-intro-mark");
      if (!shellElement || !markElement) return;
      const shell = shellElement.getBoundingClientRect();
      const mark = markElement.getBoundingClientRect();
      if (!shell.width || !mark.width || window.__introFrames.length >= 240) return;
      window.__introFrames.push({ shellWidth: shell.width, x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 });
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  });
  await page.clock.install();
  await page.goto("/");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1));
  await page.clock.runFor(1100);
  const intro = page.locator("[data-story-intro]");
  await expect(intro).toHaveAttribute("aria-hidden", "true");
  await expect(intro).toHaveCSS("pointer-events", "none");
  await expect(intro).toHaveCSS("display", "none");
  await expect(intro.locator('[data-story-count], [role="progressbar"], button, a, input')).toHaveCount(0);
  await expect(intro).toHaveText("");
  const frames = await page.evaluate(() => window.__introFrames);
  expect(frames.length, "The entry must render intermediate geometry before disappearing").toBeGreaterThan(2);
  expect(Math.max(...frames.map(frame => frame.shellWidth))).toBeGreaterThan(1440);
  expect(Math.min(...frames.map(frame => frame.shellWidth))).toBeLessThan(150);
  for (const frame of frames) {
    expect(frame.x).toBeCloseTo(720, 0);
    expect(frame.y).toBeCloseTo(450, 0);
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
});

for (const scenario of [
  { name: "mobile", width: 390, motion: "no-preference", url: "/" },
  { name: "reduced motion", width: 1440, motion: "reduce", url: "/" },
  { name: "deep link", width: 1440, motion: "no-preference", url: "/#review" }
]) {
  test(`opening is absent for ${scenario.name}`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.emulateMedia({ reducedMotion: scenario.motion });
    await page.clock.install();
    await page.goto(scenario.url);
    const intro = page.locator("[data-story-intro]");
    await expect(intro).toHaveCSS("display", "none");
    await expect(intro).toHaveAttribute("aria-hidden", "true");
    await page.clock.runFor(1200);
    await expect(intro).toHaveCSS("display", "none");
    if (scenario.name === "deep link") {
      await expect(page).toHaveURL(/#review$/);
      await expect(page.locator("#review")).toBeInViewport();
    }
  });
}

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
    for (const label of await page.locator('.auth-companion > span, .auth-assurance, .auth-footer').all()) {
      expect(await label.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(13);
      expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    expect(await page.locator('input[name="email"]').evaluate(element => getComputedStyle(element, '::placeholder').opacity)).toBe('1');
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
