import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";
import { createQuotationDraft, quotationDraftKey } from "../../app/lib/quotation-draft.mjs";

const cursor = "fixture-older+/=";
const quoteItem = title => ({ rateCardId: null, title, description: "", quantity: 2, unit: "HOUR", unitRate: 100, discountRate: 0, basis: { type: "ASSUMPTION", content: "Reviewed scope", sourceType: null, sourceReference: null, sourceTitle: null, retrievedAt: null } });
const quote = number => ({ id: `quote-${number}`, workspaceId: "local-space", projectId: "project-one", seriesId: `series-${number}`, previousVersionId: null, versionNumber: number, scenario: "RECOMMENDED", status: "PUBLISHED", currency: "KRW", subtotal: 200, discountTotal: 0, riskBufferRate: 0, riskBufferAmount: 0, taxRate: .1, taxAmount: 20, total: 220, validUntil: null, items: [quoteItem(`Saved item ${number}`)], publishedAt: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, number)).toISOString(), version: 1 });

async function quotations(page, { restored = false, failDetail = false } = {}) {
  const state = await fixture(page);
  state.permissions.push("outcome.read", "outcome.write");
  Object.assign(state, { pageReads: [], detailReads: [], latestQuotationReads: [], quotationRevisions: [], unexpectedQuotations: [], failPage: false, failDetail, nextPage: null });
  const records = Array.from({ length: 100 }, (_, index) => quote(100 - index));
  const savedOutcome = { id: "outcome-one", workspaceId: "local-space", projectId: "project-one", approvedQuotationId: "quote-5", totalRevenue: 300, actualCost: 100, actualHours: 3, profitAmount: 200, profitMargin: .67, completedOn: null, changeReason: "Recorded", workItems: [{ title: "Recorded work", actualHours: 3, actualCost: 100, notes: "Keep work notes" }] };
  if (restored) {
    const key = quotationDraftKey("local-user", "local-space", "project-one");
    const draft = createQuotationDraft({ workspaceId: "local-space", projectId: "project-one", scenario: "RECOMMENDED", baseQuotationId: "quote-5", taxRate: .1, validUntil: "", items: [quoteItem("Restored working draft")] });
    await page.addInitScript(({ key, draft }) => sessionStorage.setItem(key, JSON.stringify(draft)), { key, draft });
  }
  await page.route("**/api/v2/workspaces/local-space/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/v2/workspaces/local-space/projects/project-one/quotations/page" && request.method() === "GET") {
      state.pageReads.push(url.search);
      expect(url.searchParams.get("limit")).toBe("50");
      if (!url.searchParams.has("cursor")) return json({ items: records.slice(0, 50), nextCursor: cursor });
      expect(url.searchParams.get("cursor")).toBe(cursor);
      const pending = state.nextPage; state.nextPage = null;
      if (pending) await pending.wait();
      return state.failPage ? json({ message: "Older quotations unavailable" }, 503) : json({ items: records.slice(50), nextCursor: null });
    }
    if (path === "/api/v2/workspaces/local-space/quotations/quote-5" && request.method() === "GET") {
      state.detailReads.push("quote-5");
      return state.failDetail ? json({ message: "Selected quotation unavailable" }, 503) : json(quote(5));
    }
    if (path === "/api/v2/workspaces/local-space/quotations/quote-5/latest" && request.method() === "GET") {
      state.latestQuotationReads.push("quote-5");
      return json({ ...quote(6), seriesId: "series-5", previousVersionId: "quote-5" });
    }
    if (path === "/api/v2/workspaces/local-space/quotations/quote-5/revisions" && request.method() === "POST") {
      state.quotationRevisions.push(request.postDataJSON());
      return json({ message: "Quotation conflict" }, 409);
    }
    if (path === "/api/v2/workspaces/local-space/projects/project-one/outcome" && request.method() === "GET") return json(savedOutcome);
    if (path.includes("/quotations")) {
      state.unexpectedQuotations.push(`${request.method()} ${path}`);
      return json({ message: "Unexpected quotation fixture request" }, 404);
    }
    return route.fallback();
  });
  return state;
}

test("older pages load only on request; a page failure and retry preserve the quote editor", async ({ page }) => {
  const state = await quotations(page);
  await page.goto("/workspace/projects/project-one/quote");
  await expect(page.locator(".quote-item-disclosure").first()).toContainText("Saved item 100");
  expect(state.pageReads).toHaveLength(1);
  await page.locator(".quote-item-disclosure").first().click();
  const title = page.getByLabel("작업 항목", { exact: true });
  await title.fill("Keep my current draft");
  await page.locator(".quote-history > summary").click();
  state.failPage = true;
  await page.getByRole("button", { name: "이전 견적 더 보기" }).click();
  await expect(page.locator(".quote-history").getByRole("alert")).toContainText("Older quotations unavailable");
  await expect(title).toHaveValue("Keep my current draft");
  state.failPage = false; const pending = requestBarrier(); state.nextPage = pending;
  await page.getByRole("button", { name: "이전 견적 더 보기" }).click();
  await pending.entered;
  await expect(page.getByRole("button", { name: "이전 견적을 불러오는 중입니다." })).toBeDisabled();
  pending.release();
  await expect(page.locator(".quote-history > button")).toHaveCount(100);
  await expect(title).toHaveValue("Keep my current draft");
  expect(state.pageReads).toHaveLength(3);
  page.once("dialog", dialog => dialog.accept());
  await page.locator(".quote-history > button").last().click();
  await expect(title).toHaveValue("Saved item 1");
  expect(state.unexpectedQuotations).toEqual([]);
  expect(state.blocked).toEqual([]);
});

test("an older restored draft keeps its revision target and resolves conflicts by exact series", async ({ page }) => {
  const state = await quotations(page, { restored: true });
  await page.goto("/workspace/projects/project-one/quote");
  await expect(page.locator(".quote-item-disclosure").first()).toContainText("Restored working draft");
  expect(state.detailReads).toEqual(["quote-5"]);
  expect(state.pageReads).toHaveLength(1);
  await page.getByRole("button", { name: "검토용 초안 저장" }).click();
  await expect(page.locator(".quote-conflict")).toBeVisible();
  await expect(page.locator(".quote-item-disclosure").first()).toContainText("Restored working draft");
  expect(state.latestQuotationReads).toEqual(["quote-5"]);
  expect(state.quotationRevisions[0].items[0].title).toBe("Restored working draft");
  expect(state.pageReads).toHaveLength(1);
  expect(state.unexpectedQuotations).toEqual([]);
});

test("a missing off-page base restores the draft but cannot silently create another quotation", async ({ page }) => {
  const state = await quotations(page, { restored: true, failDetail: true });
  await page.goto("/workspace/projects/project-one/quote");
  await expect(page.locator(".quote-item-disclosure").first()).toContainText("Restored working draft");
  await expect(page.locator(".quote-builder > .inline-error[role=alert]")).toContainText("원본 견적을 불러오지 못했습니다.");
  await expect(page.getByRole("button", { name: "검토용 초안 저장" })).toBeDisabled();
  expect(state.quotationRevisions).toEqual([]);
  expect(state.unexpectedQuotations).toEqual([]);
});

test("outcome pagination retains its older approved quote and unsaved form inputs", async ({ page }) => {
  const state = await quotations(page);
  await page.goto("/workspace/projects/project-one/outcome");
  await page.locator(".outcome-editor > summary").click();
  const selected = page.getByLabel("기준 견적", { exact: true });
  await expect(selected).toHaveValue("quote-5");
  await page.locator('input[name="totalRevenue"]').fill("450");
  await selected.selectOption("quote-90");
  await page.getByRole("button", { name: "이전 견적 더 보기" }).click();
  await expect(selected.locator("option")).toHaveCount(101);
  await expect(selected).toHaveValue("quote-90");
  await expect(page.locator('input[name="totalRevenue"]')).toHaveValue("450");
  await expect(page.locator('input[value="Recorded work"]')).toHaveCount(1);
  expect(state.pageReads).toHaveLength(2);
  expect(state.unexpectedQuotations).toEqual([]);
  expect(state.blocked).toEqual([]);
});

for (const { width, locale } of [{ width: 390, locale: "ko" }, { width: 1440, locale: "en" }]) {
  test(`${width}px ${locale}: private project navigation isolates delayed pages and retains both drafts`, async ({ page }) => {
    const state = await quotations(page, { restored: true });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(locale => localStorage.setItem("freelance-ops-ui-locale-v1", locale), locale);
    await page.goto("/workspace/projects/project-one/quote");
    const expectedTitle = locale === "en" ? "Freelance Ops | Evidence-based estimates" : "Freelance Ops | 근거 있는 견적 운영";
    const expectPrivateShell = async step => {
      await expect(page.locator(".project-heading h1")).toHaveText("Original project title");
      await expect(page.locator('.workbench-steps button[aria-current="step"]')).toHaveCount(1);
      await expect(page.locator(".workbench-steps button").nth(step)).toHaveAttribute("aria-current", "step");
      await expect(page).toHaveTitle(expectedTitle);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    };
    await expectPrivateShell(2);
    await expect(page.locator(".quote-item-disclosure").first()).toContainText("Restored working draft");
    await page.locator(".quote-item-disclosure").first().click();
    const itemTitle = page.getByLabel(locale === "en" ? "Task item" : "작업 항목", { exact: true });
    const quoteDraft = `Retain quote draft ${locale}`;
    await itemTitle.fill(quoteDraft);
    const draftKey = quotationDraftKey("local-user", "local-space", "project-one");
    await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key))?.items[0]?.title, draftKey)).toBe(quoteDraft);
    await page.locator(".quote-history > summary").click();
    const pending = requestBarrier();
    state.nextPage = pending;
    await page.getByRole("button", { name: locale === "en" ? "Load older quotations" : "이전 견적 더 보기", exact: true }).click();
    await pending.entered;
    await page.locator(".workbench-steps button").nth(1).click();
    await expectPrivateShell(1);
    const chatDraft = `Retain unsent chat ${locale}`;
    await page.locator("#agent-chat-input").fill(chatDraft);
    await page.goBack();
    await expect(page).toHaveURL(/\/quote$/);
    await expectPrivateShell(2);
    await expect(page.locator(".quote-item-disclosure").first()).toContainText(quoteDraft);
    // The old page belongs to an unmounted quote view and must not append to
    // this newly restored view, reset its draft, or change its revision target.
    const stalePageResponse = page.waitForResponse(response => response.url().includes("/quotations/page?") && new URL(response.url()).searchParams.has("cursor"));
    pending.release();
    await stalePageResponse;
    await page.locator(".quote-history > summary").click();
    // First page plus the exact off-page restored base; exclude Load older.
    await expect(page.locator(".quote-history > button > strong")).toHaveCount(51);
    await expect(page.locator(".quote-item-disclosure").first()).toContainText(quoteDraft);
    await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key))?.baseQuotationId, draftKey)).toBe("quote-5");
    await page.goForward();
    await expect(page).toHaveURL(/\/agent$/);
    await expectPrivateShell(1);
    await expect(page.locator("#agent-chat-input")).toHaveValue(chatDraft);
    expect(state.starts).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.quotationRevisions).toEqual([]);
    expect(state.unexpectedQuotations).toEqual([]);
    expect(state.blocked).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}
