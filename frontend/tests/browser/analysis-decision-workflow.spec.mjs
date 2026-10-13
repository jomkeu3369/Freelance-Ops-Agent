import { test, expect } from "@playwright/test";
import { analysisWorkflowFixture, requestBarrier, workflowRunId } from "./helpers/analysis-workflow-fixture.mjs";

const path = "/workspace/projects/project-one/decision";
const acknowledgement = "선택 의견, 범위 차이, 중복, 근거와 미확정 가정·열린 질문을 검토했습니다. 이 내용을 결과 확정본으로 저장합니다.";
const panel = page => page.getByRole("region", { name: "의견 정리와 확정", exact: true });
const editor = page => page.getByRole("textbox", { name: "검토한 결과 내용", exact: true });
const create = page => page.getByRole("button", { name: "선택 의견으로 정리 초안 만들기", exact: true });
const confirm = page => page.getByRole("button", { name: "검토한 결과 확정", exact: true });

async function selectTwo(page) {
  await page.getByRole("checkbox", { name: "핵심 범위 관점 선택", exact: true }).check();
  await page.getByRole("checkbox", { name: "확장 범위 관점 선택", exact: true }).check();
}

async function createTwo(page) {
  await selectTwo(page); await create(page).click(); await expect(editor(page)).toBeVisible();
}

function expectNoProviderWork(state) {
  expect(state.starts).toEqual([]);
  expect(state.blocked).toEqual([]);
  expect(state.writes.filter(value => /raptor|index|embedding|agent-runs/.test(value.path))).toEqual([]);
}

test.use({ trace: "on" });

test("recorded perspectives become a selected draft, edited revision, explicit confirmation and durable reload", async ({ page }) => {
  const { state, workflow } = await analysisWorkflowFixture(page), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(path); await expect(panel(page)).toBeVisible();
  await expect(create(page)).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "권장 범위 관점 선택", exact: true })).not.toBeChecked();
  await createTwo(page);
  const original = structuredClone(workflow.decisions[0]);
  expect(original.selectedOpinionIds).toEqual([`${workflowRunId}:LEAN`, `${workflowRunId}:EXPANDED`]);
  expect(original.sourceOpinions.map(value => value.scenario)).toEqual(["LEAN", "EXPANDED"]);
  await expect(editor(page)).toHaveValue(/LEAN 선택 제안/);
  expect(await editor(page).inputValue()).toContain("EXPANDED 선택 제안");
  expect(await editor(page).inputValue()).not.toContain("RECOMMENDED 선택 제안");
  expect(Object.keys(workflow.creates[0]).sort()).toEqual(["expectedProjectVersion", "requestId", "selectedOpinionIds", "sourceRunId"]);
  await expect(confirm(page)).toBeDisabled();
  const edited = `${original.bodyText}\n사용자 결정: 중복 없이 검토한 범위만 수행합니다.`;
  await editor(page).fill(edited);
  await expect(page.getByRole("checkbox", { name: acknowledgement, exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "수정 내용 새 버전 저장", exact: true }).click();
  await expect(editor(page)).toHaveValue(edited);
  await expect(page.getByRole("checkbox", { name: acknowledgement, exact: true })).toBeEnabled();
  const revision = workflow.decisions[0];
  expect(revision.id).not.toEqual(original.id); expect(revision.previousId).toEqual(original.id);
  expect(revision.versionNumber).toEqual(2); expect(revision.originalBodyText).toEqual(original.bodyText);
  expect(workflow.decisions.find(value => value.id === original.id)).toEqual(original);
  await page.getByRole("checkbox", { name: acknowledgement, exact: true }).check(); await confirm(page).click();
  await expect(page.getByRole("button", { name: "확정 결과로 명세 만들기", exact: true })).toBeEnabled();
  expect(workflow.confirms).toHaveLength(1);
  expect(workflow.confirms[0]).toMatchObject({ id: revision.id, expectedContentHash: revision.contentHash, confirmation: "CONFIRM_ANALYSIS_DECISION" });
  await page.reload(); await expect(editor(page)).toHaveValue(edited);
  await expect(panel(page).getByText("사용자 확정본", { exact: true }).first()).toBeVisible();
  expectNoProviderWork(state); expect(errors).toEqual([]);
  await page.screenshot({ path: "outputs/ui-ux/analysis-decision-confirmed.png", fullPage: true });
});

test("double-click composition and ambiguous saved-response retry preserve one immutable target", async ({ page }) => {
  const { state, workflow } = await analysisWorkflowFixture(page);
  workflow.lostResponses.create = 1;
  await page.goto(path); await expect(panel(page)).toBeVisible(); await selectTwo(page);
  const gate = requestBarrier(); workflow.barriers.create = gate;
  await create(page).evaluate(node => { node.click(); node.click(); });
  await gate.entered;
  expect(workflow.creates).toHaveLength(1); expect(workflow.decisions).toHaveLength(1);
  const savedId = workflow.decisions[0].id; gate.release();
  await expect(panel(page).getByRole("alert")).toBeVisible(); await expect(create(page)).toBeEnabled();
  await create(page).click(); await expect(editor(page)).toBeVisible();
  expect(workflow.creates).toHaveLength(2);
  expect(workflow.creates[1].requestId).toEqual(workflow.creates[0].requestId);
  expect(workflow.decisions).toHaveLength(1); expect(workflow.decisions[0].id).toEqual(savedId);
  expectNoProviderWork(state);
});

test("changed selections require a fresh acknowledgement before a recorded draft can be confirmed", async ({ page }) => {
  const { state, workflow } = await analysisWorkflowFixture(page);
  await page.goto(path); await createTwo(page);
  await page.getByRole("checkbox", { name: acknowledgement, exact: true }).check();
  await expect(confirm(page)).toBeEnabled();
  await page.getByRole("checkbox", { name: "확장 범위 관점 선택", exact: true }).uncheck();
  await expect(page.getByRole("checkbox", { name: acknowledgement, exact: true })).not.toBeChecked();
  await expect(confirm(page)).toBeDisabled();
  expect(workflow.confirms).toHaveLength(0); expectNoProviderWork(state);
});

test("a concurrent revision conflict preserves the user's unsaved edit and prevents stale confirmation", async ({ page }) => {
  const { state, workflow } = await analysisWorkflowFixture(page);
  await page.goto(path); await createTwo(page);
  const base = structuredClone(workflow.decisions[0]);
  const unsaved = `${base.bodyText}\n현재 탭의 아직 저장하지 않은 판단`;
  await editor(page).fill(unsaved);
  const other = { ...structuredClone(base), id: "d1000000-0000-4000-8000-000000000099", previousId: base.id, versionNumber: 2,
    bodyText: "다른 탭에서 먼저 저장한 변경", contentHash: "b".repeat(64), bodyOrigin: "USER_EDITED" };
  workflow.decisions.unshift(other);
  await page.getByRole("button", { name: "수정 내용 새 버전 저장", exact: true }).click();
  await expect(panel(page).getByRole("alert").filter({ hasText: "새 정리 버전" }).first()).toBeVisible();
  await expect(editor(page)).toHaveValue(unsaved);
  await expect(page.getByRole("button", { name: "수정 내용 새 버전 저장", exact: true })).toBeDisabled();
  await expect(confirm(page)).toBeDisabled();
  expect(workflow.decisions).toHaveLength(2); expect(workflow.confirms).toHaveLength(0); expectNoProviderWork(state);
});

for (const status of ["PARTIAL", "FAILED", "CANCELLED", "WAITING_FOR_USER"]) {
  test(`${status} partial text cannot become a confirmable analysis source`, async ({ page }) => {
    const { state, workflow } = await analysisWorkflowFixture(page);
    state.run.status = status;
    await page.goto(path); await expect(panel(page)).toBeVisible();
    await expect(page.getByText("프로젝트 전체 분석이 아직 완료되지 않았습니다. 부분·실패·취소 결과는 확정할 수 없습니다.", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "계획 의견 선택", exact: true })).toHaveCount(0);
    await expect(create(page)).toHaveCount(0); await expect(confirm(page)).toHaveCount(0);
    expect(workflow.creates).toHaveLength(0); expectNoProviderWork(state);
  });
}

test("semantic source changes with the same project version fail closed before confirmation", async ({ page }) => {
  const { state, workflow } = await analysisWorkflowFixture(page);
  await page.goto(path); await createTwo(page);
  workflow.sourceStale = true;
  await page.getByRole("checkbox", { name: acknowledgement, exact: true }).check(); await confirm(page).click();
  await expect(panel(page).getByRole("alert").filter({ hasText: "원문·요구사항 확정·추가 답변" })).toBeVisible();
  expect(workflow.decisions[0].status).toEqual("DRAFT"); expect(state.projects[0].version).toEqual(0); expectNoProviderWork(state);
});

test("an unsaved decision edit survives immediate internal navigation, back and reload", async ({ page }, testInfo) => {
  const { state, workflow } = await analysisWorkflowFixture(page);
  await page.goto(path); await createTwo(page);
  const unsaved = `${await editor(page).inputValue()}\n즉시 이동 전에 작성한 사용자 검토 초안`;
  await editor(page).fill(unsaved);
  await page.getByRole("button", { name: "프로젝트 전체 분석으로", exact: true }).evaluate(node => node.click());
  await expect(page).toHaveURL(/\/agent$/);
  await page.goBack(); await expect(page).toHaveURL(/\/decision$/);
  await expect(editor(page)).toHaveValue(unsaved);
  await page.reload(); await expect(editor(page)).toHaveValue(unsaved);
  await expect(confirm(page)).toBeDisabled();
  expect(workflow.revisions).toHaveLength(0); expect(workflow.confirms).toHaveLength(0);
  expectNoProviderWork(state);
  await testInfo.attach("unsaved-decision-draft-restored", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
