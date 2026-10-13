import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const profile = { petId: "recorded-pet", slot: "RECOMMENDED", name: "기록된 나만의 펫", animal: "cat", color: "sky", accessory: "scarf", tone: "WARM", valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED", duty: "RESEARCH" };
const item = title => ({ title, description: "Synthetic source description", quantity: 1, unit: "HOUR", rateCardHint: "Synthetic rate", basis: { type: "ASSUMPTION", content: "Synthetic source assumption", sourceReference: null, sourceTitle: null } });
const drafts = [
  { scenario: "LEAN", items: [item("기록된 핵심 작업")], petPerspective: null },
  { scenario: "RECOMMENDED", items: [item("기록된 권장 작업")], petPerspective: { proposal: "기록된 권장 제안", rationale: "원본 의견의 이유", tradeoff: "원본 의견의 고려 사항" } },
  { scenario: "EXPANDED", items: [item("기록된 확장 작업")], petPerspective: null }
];

async function perspectiveFixture(page, status = "COMPLETED") {
  const state = await fixture(page), previews = [], errors = [];
  state.run = { runId: "run-one", status, activeDepartment: null, interruption: null, errorCode: status === "FAILED" ? "SYNTHETIC_LATER_FAILURE" : null, updatedAt: "2026-10-01T00:01:00Z", usage: null,
    result: { projectSummary: "Synthetic recorded result", openQuestions: [], departmentResults: [{ department: "REQUIREMENTS", status: "COMPLETED", summary: "실제 기록된 요구사항 결과", evidenceIds: [], assumptionIds: [], sources: [], errorCode: null }], quotationDraft: drafts[1], quotationDrafts: structuredClone(drafts) },
    metadata: { petProfiles: [profile], provider: "OPENAI", model: "fixture-model", promptVersion: "fixture", toolSchemaVersion: "fixture", traceId: "fixture-trace" }
  };
  // The server explicitly identifies this recorded PROJECT_ANALYSIS source;
  // unrelated completed chat turns cannot implicitly seed a quotation.
  await page.route("**/api/v2/workspaces/local-space/projects/project-one/analysis-decisions/sources/latest", route => route.fulfill({
    json: { runId: state.run.runId, sourceProjectVersion: state.projects[0].version, view: state.run },
  }));
  await page.route("**/api/v2/workspaces/local-space/rate-cards", route => route.fulfill({ json: [{ id: "rate-one", workspaceId: "local-space", name: "Synthetic rate", unit: "HOUR", rate: 1000, minimumAmount: 0, currency: "KRW", active: true, version: 1 }] }));
  await page.route("**/api/v2/workspaces/local-space/projects/project-one/quotations/preview", route => {
    const input = route.request().postDataJSON(); previews.push(input);
    return route.fulfill({ json: { subtotal: input.items.length * 1000, discountTotal: 0, riskBufferRate: 0, riskBufferAmount: 0, taxRate: 0, taxAmount: 0, total: input.items.length * 1000, items: input.items.map(() => ({ subtotal: 1000, discountAmount: 0, total: 1000 })) } });
  });
  page.on("pageerror", error => errors.push(error.message));
  return { state, previews, errors };
}

for (const [locale, labels] of [["ko", ["차근", profile.name, "든든"]], ["en", ["Calm", profile.name, "Steady"]]]) {
  test(`${locale}: recorded slot attribution and missing opinions stay honest in scope cards`, async ({ page }) => {
    const { state, previews, errors } = await perspectiveFixture(page);
    await page.addInitScript(locale => localStorage.setItem("freelance-ops-ui-locale-v1", locale), locale);
    await page.goto("/workspace/projects/project-one/quote");
    const council = page.locator(".pet-council"); await council.locator("summary").first().click();
    await expect(council.locator(".pet-proposal-title strong")).toHaveText(labels);
    await expect(council.locator(".pet-proposal h4")).toHaveText("기록된 권장 제안");
    await expect(council.locator(".pet-legacy-note")).toHaveCount(2);
    await expect(council.locator("header")).toContainText(locale === "ko" ? "하나의 분석에서 나온 범위별 제안" : "These scope proposals come from one analysis");
    await page.screenshot({ path: `outputs/ui-ux/pet-perspectives-${locale}.png`, fullPage: true });
    expect(previews).toEqual([]); expect(state.starts).toEqual([]); expect(state.writes).toEqual([]); expect(state.blocked).toEqual([]); expect(errors).toEqual([]);
  });
}

test("quotation task selection and amount preview do not save or issue work", async ({ page }) => {
  const { state, previews, errors } = await perspectiveFixture(page);
  await page.goto("/workspace/projects/project-one/quote");
  const council = page.locator(".pet-council"); await council.locator("summary").first().click();
  await council.getByRole("checkbox").nth(0).check(); await council.getByRole("checkbox").nth(2).check();
  await council.getByRole("button", { name: "변경 미리보기", exact: true }).click();
  const comparison = council.getByRole("region", { name: "견적 변경 미리보기" }); await expect(comparison).toBeVisible();
  expect(previews.length).toBe(2); expect(state.writes).toEqual([]); expect(state.starts).toEqual([]);
  await council.getByRole("button", { name: "확인한 작업으로 편집 초안 변경", exact: true }).click();
  await expect.poll(() => page.locator(".quote-title-field input").evaluateAll(inputs => inputs.map(input => input.value))).toEqual(["기록된 핵심 작업", "기록된 확장 작업"]);
  await expect(council.getByRole("status")).toContainText("검토용 초안 저장");
  expect(state.writes).toEqual([]); expect(state.starts).toEqual([]); expect(state.blocked).toEqual([]); expect(errors).toEqual([]);
});

for (const status of ["COMPLETED", "FAILED"]) {
  test(`${status}: personal pet and source departments reflect their own recorded outcomes`, async ({ page }) => {
    const { state, previews, errors } = await perspectiveFixture(page, status);
    await page.goto("/workspace/projects/project-one/agent");
    await page.getByRole("button", { name: "작업 자세히 보기", exact: true }).click();
    const workspace = page.locator(".pet-workspace"); await expect(workspace.locator(".pet-station")).toHaveCount(1);
    await expect(workspace.locator(".pet-status")).toHaveText(status === "COMPLETED" ? "검토 결과 준비됨" : "실행을 완료하지 못했어요");
    await workspace.locator(".pet-station").click();
    await expect(workspace.locator(".pet-detail")).toContainText("요구사항 정리 · 검토 결과 준비됨");
    await expect(workspace.locator(".pet-detail")).toContainText("실제 기록된 요구사항 결과");
    expect(previews).toEqual([]); expect(state.starts).toEqual([]); expect(state.writes).toEqual([]); expect(state.blocked).toEqual([]); expect(errors).toEqual([]);
  });
}
