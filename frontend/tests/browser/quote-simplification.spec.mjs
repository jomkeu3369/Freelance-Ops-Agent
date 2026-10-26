import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";
import { quotationPreview } from "./helpers/quotation-preview.mjs";
import { createQuotationDraft, quotationDraftKey } from "../../app/lib/quotation-draft.mjs";

const path = "/workspace/projects/project-one/quote";
const draftKey = quotationDraftKey("local-user", "local-space", "project-one");
const item = (title, content = "Reviewed scope") => ({ rateCardId: null, title, description: "Keep description", quantity: 2, unit: "HOUR", unitRate: 50000, discountRate: 0, basis: { type: "ASSUMPTION", content, sourceType: null, sourceReference: null, sourceTitle: null, retrievedAt: null } });
const evidence = { type: "EVIDENCE", content: "Approved scope", sourceType: "USER_TEMPLATE", sourceReference: "scope-v2", sourceTitle: "Approved brief", retrievedAt: "2026-10-01T03:00:00Z" };
const rates = [
  { id: "rate-hour", workspaceId: "local-space", name: "API implementation", currency: "KRW", unit: "HOUR", rate: 60000, minimumAmount: 0, active: true, version: 1 },
  { id: "rate-day", workspaceId: "local-space", name: "Design review", currency: "KRW", unit: "DAY", rate: 80000, minimumAmount: 0, active: true, version: 1 },
  { id: "rate-fixed", workspaceId: "local-space", name: "Deployment", currency: "KRW", unit: "FIXED", rate: 120000, minimumAmount: 0, active: true, version: 1 },
  { id: "rate-usd", workspaceId: "local-space", name: "Foreign rate", currency: "USD", unit: "HOUR", rate: 50, minimumAmount: 0, active: true, version: 1 },
  { id: "rate-inactive", workspaceId: "local-space", name: "Archived rate", currency: "KRW", unit: "HOUR", rate: 1, minimumAmount: 0, active: false, version: 1 },
];

async function quoteFixture(page, { items = [item("", "")], readOnly = false } = {}) {
  const state = await fixture(page);
  Object.assign(state, { creates: [], previews: [], records: [], errors: [] });
  page.on("pageerror", error => state.errors.push(error.message));
  const record = input => {
    const pricing = quotationPreview(input, state.policy);
    return { ...input, ...pricing, items: input.items.map((item, index) => ({ ...item, ...pricing.items[index] })), id: "quote-one", workspaceId: "local-space", projectId: "project-one", seriesId: "series-one", previousVersionId: null, versionNumber: 1, status: "DRAFT", currency: "KRW", publishedAt: null, createdAt: "2026-10-01T00:00:00Z", version: 1 };
  };
  if (readOnly) {
    state.permissions = state.permissions.filter(permission => permission !== "quotation.write");
    state.records = [record({ scenario: "RECOMMENDED", items, taxRate: .1, validUntil: null, applyDefaultRiskBuffer: true })];
  } else {
    const draft = createQuotationDraft({ workspaceId: "local-space", projectId: "project-one", scenario: "RECOMMENDED", baseQuotationId: null, taxRate: .1, validUntil: "", items });
    await page.addInitScript(({ key, draft }) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(draft));
    }, { key: draftKey, draft });
  }
  await page.route("**/api/v2/workspaces/local-space/**", route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/rate-cards") && request.method() === "GET") return route.fulfill({ json: rates });
    if (pathname.endsWith("/quotations/page") && request.method() === "GET") return route.fulfill({ json: { items: state.records, nextCursor: null } });
    if (pathname.endsWith("/quotations/preview") && request.method() === "POST") {
      state.previews.push(request.postDataJSON());
      return route.fulfill({ json: quotationPreview(request.postDataJSON(), state.policy) });
    }
    if (pathname.endsWith("/quotations") && request.method() === "POST") {
      state.creates.push(request.postDataJSON());
      const saved = record(request.postDataJSON());
      state.records = [saved];
      return route.fulfill({ status: 201, json: saved });
    }
    return route.fallback();
  });
  return state;
}

const storedItems = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key))?.items, draftKey);
const expectIsolated = state => {
  expect(state.starts).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.blocked).toEqual([]);
  expect(state.errors).toEqual([]);
};

test("opening another ledger row preserves edited effort and evidence in the saved draft", async ({ page }) => {
  const state = await quoteFixture(page, { items: [item("API"), item("Review")] });
  await page.goto(path);
  const rows = page.locator(".quote-item-block");
  await rows.nth(0).locator("summary").first().click();
  await rows.nth(0).getByRole("spinbutton", { name: "수량", exact: true }).fill("3");
  await rows.nth(0).getByLabel("가정 내용", { exact: true }).fill("Approved three-hour scope");
  await rows.nth(1).locator("summary").first().click();
  await expect(rows.nth(0)).not.toHaveAttribute("open", "");
  await expect(rows.nth(1)).toHaveAttribute("open", "");
  await rows.nth(0).locator("summary").first().focus();
  await page.keyboard.press("Enter");
  await expect(rows.nth(1)).not.toHaveAttribute("open", "");
  await expect(rows.nth(0).getByRole("spinbutton", { name: "수량", exact: true })).toHaveValue("3");
  await expect(rows.nth(0).getByLabel("가정 내용", { exact: true })).toHaveValue("Approved three-hour scope");
  await expect(page.getByRole("button", { name: "검토용 초안 저장", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "검토용 초안 저장", exact: true }).click();
  await expect.poll(() => state.creates.length).toBe(1);
  expect(state.creates[0].items[0]).toMatchObject({ quantity: 3, unitRate: 50000, basis: { content: "Approved three-hour scope" } });
  expect(state.records[0].total).toBe(302500);
  expectIsolated(state);
});

test("rate selection fills blank names, preserves custom names and unlocks manual rates without losing values", async ({ page }) => {
  const state = await quoteFixture(page);
  await page.goto(path);
  await page.locator(".quote-item-disclosure").click();
  const row = page.locator(".quote-item-block");
  const rate = row.getByRole("combobox", { name: "서비스 단가표", exact: true });
  await expect(rate.locator("option")).toHaveCount(4);
  await rate.selectOption("rate-hour");
  await expect(row.getByLabel("작업 항목", { exact: true })).toHaveValue("API implementation");
  await expect(row.locator(".quote-applied-rate")).toContainText("₩60,000 / 시간");
  await expect(row.getByRole("spinbutton", { name: "단가", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "검토용 초안 저장", exact: true })).toBeDisabled();
  await row.getByLabel("작업 항목", { exact: true }).fill("Customer-specific API");
  await rate.selectOption("rate-day");
  await expect(row.getByLabel("작업 항목", { exact: true })).toHaveValue("Customer-specific API");
  await expect(row.locator(".quote-applied-rate")).toContainText("₩80,000 / 작업일");
  await rate.selectOption("");
  await expect(row.getByRole("combobox", { name: "단위", exact: true })).toHaveValue("DAY");
  await expect(row.getByRole("spinbutton", { name: "단가", exact: true })).toHaveValue("80000");
  await row.getByRole("spinbutton", { name: "수량", exact: true }).fill("3");
  await row.getByRole("spinbutton", { name: "단가", exact: true }).fill("120000");
  await row.getByLabel("가정 내용", { exact: true }).fill("Three reviewed working days");
  await expect(row.getByRole("spinbutton", { name: "할인율 (%)", exact: true })).not.toBeVisible();
  const save = page.getByRole("button", { name: "검토용 초안 저장", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => state.creates.length).toBe(1);
  expect(state.creates[0]).toMatchObject({ taxRate: .1, applyDefaultRiskBuffer: true, items: [{ rateCardId: null, title: "Customer-specific API", description: "Keep description", quantity: 3, unit: "DAY", unitRate: 120000, discountRate: 0, basis: { type: "ASSUMPTION", content: "Three reviewed working days", sourceReference: null } }] });
  expect(state.records[0].total).toBe(435600);
  expectIsolated(state);
});

test("explicit assumption reuse fills only empty assumptions and survives refresh without rewriting evidence", async ({ page }) => {
  const items = [item("Source", "Shared reviewed scope"), item("Empty", "  "), item("Custom", "Keep custom note"), { ...item("Empty evidence"), basis: { ...evidence, content: "" } }, { ...item("Evidence"), basis: evidence }];
  const state = await quoteFixture(page, { items });
  await page.goto(path);
  await page.locator(".quote-item-disclosure").first().click();
  await page.getByRole("button", { name: "1개 빈 항목에 같은 가정 적용", exact: true }).click();
  const expected = items.map((value, index) => index === 1 ? { ...value, basis: { ...value.basis, content: "Shared reviewed scope" } } : value);
  await expect.poll(() => storedItems(page)).toEqual(expected);
  await expect(page.getByRole("button", { name: /빈 항목에 같은 가정 적용/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "검토용 초안 저장", exact: true })).toBeDisabled();
  await page.reload();
  await page.locator(".quote-item-disclosure").nth(1).click();
  await expect(page.locator(".quote-item-block").nth(1).getByLabel("가정 내용", { exact: true })).toHaveValue("Shared reviewed scope");
  expect(await storedItems(page)).toEqual(expected);
  expectIsolated(state);
});

test("collapsed advanced settings preserve discounts and source metadata, and missing sources still block saving", async ({ page }) => {
  const state = await quoteFixture(page, { items: [item("Review")] });
  await page.goto(path);
  await page.locator(".quote-item-disclosure").click();
  const row = page.locator(".quote-item-block");
  const summary = row.locator(".quote-item-options > summary");
  await summary.click();
  await row.getByRole("spinbutton", { name: "할인율 (%)", exact: true }).fill("5");
  await row.getByRole("combobox", { name: "근거 유형", exact: true }).selectOption("EVIDENCE");
  await summary.click();
  await expect(summary).toContainText("출처 확인 필요");
  await expect(summary).toContainText("할인 5%");
  const save = page.getByRole("button", { name: "검토용 초안 저장", exact: true });
  await expect(save).toBeDisabled();
  await summary.click();
  await row.getByRole("combobox", { name: "출처 유형", exact: true }).selectOption("USER_TEMPLATE");
  await row.getByLabel("출처 참조", { exact: true }).fill(evidence.sourceReference);
  await row.getByLabel("출처 제목", { exact: true }).fill(evidence.sourceTitle);
  await row.getByLabel("조회 시점", { exact: true }).fill("2026-10-01T12:00");
  await summary.click();
  await expect.poll(async () => (await storedItems(page))?.[0]?.basis?.sourceTitle).toBe(evidence.sourceTitle);
  const before = await storedItems(page);
  expect(before[0].basis.retrievedAt).toBeTruthy();
  await page.reload();
  await page.locator(".quote-item-disclosure").click();
  await expect(summary).toContainText("검증된 근거");
  await expect(summary).toContainText("할인 5%");
  await expect(row.getByLabel("출처 참조", { exact: true })).not.toBeVisible();
  await summary.click();
  await expect(row.getByLabel("출처 참조", { exact: true })).toHaveValue(evidence.sourceReference);
  await expect(row.getByRole("spinbutton", { name: "할인율 (%)", exact: true })).toHaveValue("5");
  await summary.click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => state.creates.length).toBe(1);
  expect(state.creates[0].items).toEqual(before);
  expect(state.records[0].total).toBe(114950);
  expectIsolated(state);
});

test("read-only quotations show saved rates even when unavailable and expose no bulk or editing actions", async ({ page }) => {
  const state = await quoteFixture(page, { readOnly: true, items: [{ ...item("Archived service"), rateCardId: "removed-rate" }, item("Empty", "")] });
  await page.goto(path);
  await page.locator(".quote-item-disclosure").first().click();
  const row = page.locator(".quote-item-block").first();
  await expect(row.getByRole("combobox", { name: "서비스 단가표", exact: true })).toBeDisabled();
  await expect(row.getByRole("combobox", { name: "서비스 단가표", exact: true }).locator("option:checked")).toHaveText("저장된 단가");
  await expect(row.getByLabel("작업 항목", { exact: true })).toHaveAttribute("readonly", "");
  await expect(row.getByLabel("가정 내용", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: /빈 항목에 같은 가정 적용/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "작업 항목 추가", exact: true })).toHaveCount(0);
  await row.locator(".quote-item-options > summary").click();
  await expect(row.getByRole("combobox", { name: "근거 유형", exact: true })).toBeDisabled();
  await expect(row.getByRole("spinbutton", { name: "할인율 (%)", exact: true })).toHaveAttribute("readonly", "");
  expect(state.creates).toEqual([]);
  expectIsolated(state);
});

for (const { width, locale } of [{ width: 320, locale: "ko" }, { width: 390, locale: "en" }, { width: 820, locale: "en" }, { width: 1440, locale: "ko" }]) {
  test(`${width}px ${locale}: basic and advanced quote inputs fit without clipping`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(locale => localStorage.setItem("freelance-ops-ui-locale-v1", locale), locale);
    const state = await quoteFixture(page, { items: [{ ...item("긴 작업 이름과 고객별 범위를 유지하는 API implementation and deployment"), rateCardId: "rate-fixed", unit: "FIXED", unitRate: 120000, basis: evidence }] });
    await page.goto(path);
    await page.locator(".quote-item-disclosure").click();
    const row = page.locator(".quote-item-block");
    await expect(row.locator(".quote-applied-rate")).toContainText(locale === "en" ? "/ Fixed" : "/ 고정");
    await expect(row.locator(".quote-item-options")).not.toHaveAttribute("open", "");
    const assertFits = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const bounds = await row.boundingBox();
      const controls = await row.locator("input:visible, select:visible, textarea:visible, button:visible").evaluateAll(nodes => nodes.map(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width })));
      expect(controls.length).toBeGreaterThan(3);
      for (const control of controls) {
        expect(control.left).toBeGreaterThanOrEqual(bounds.x - 1);
        expect(control.right).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
        expect(control.width).toBeGreaterThan(30);
      }
    };
    await assertFits();
    if (width === 1440 || width === 390) await page.screenshot({ path: `outputs/ui-ux/quote-simple-${width}-${locale}.png`, fullPage: true });
    const summary = row.locator(".quote-item-options > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(row.getByRole("combobox", { name: locale === "en" ? "Source type" : "출처 유형", exact: true })).toBeVisible();
    await assertFits();
    // 직접 입력으로 돌아와도 작은 화면에서 단위·단가를 편집할 수 있어야 한다.
    await row.getByRole("combobox", { name: locale === "en" ? "Service rate card" : "서비스 단가표", exact: true }).selectOption("");
    await expect(row.getByRole("spinbutton", { name: locale === "en" ? "Rate" : "단가", exact: true })).toBeVisible();
    await assertFits();
    expectIsolated(state);
  });
}
