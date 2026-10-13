import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { specificationWorkflowFixture, requestBarrier } from "./helpers/specification-workflow-fixture.mjs";
import { fullWorkflowFixture } from "./helpers/full-workflow-fixture.mjs";
import { workflowRunId } from "./helpers/analysis-workflow-fixture.mjs";

const decisionPath = "/workspace/projects/project-one/decision";
const decisionAcknowledgement = "선택 의견, 범위 차이, 중복, 근거와 미확정 가정·열린 질문을 검토했습니다. 이 내용을 결과 확정본으로 저장합니다.";
const specAcknowledgement = "명세 전체를 검토했으며 이 내용을 PDF와 이 프로젝트의 다음 분석 참고 자료로 확정합니다.";
const specPanel = page => page.getByRole("region", { name: "명세서 검토 및 PDF 출력", exact: true });

async function attachEvidence(page, testInfo, name) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function attachContracts(testInfo, { state, workflow, specifications, flow }) {
  await testInfo.attach("synthetic-workflow-request-contracts", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    evidence: "Browser UI and API protocol fixture; actual Spring/PostgreSQL/PDFBox evidence is separate",
    logins: flow?.logins, clients: flow?.clientCreates, projects: flow?.projectCreates,
    analysisStarts: state.starts, clarificationResponses: state.resumes,
    decisions: workflow.requests.filter(request => request.method !== "GET"),
    specifications: specifications.requests.filter(request => request.method !== "GET"),
    pdfRevisionIds: specifications.pdfs, pdfFailures: specifications.pdfFailures, documentReads: specifications.documentReads,
    blockedExternalRequests: state.blocked,
  }, null, 2)) });
}

async function confirmDecision(page, testInfo, editDecision = false) {
  await page.getByRole("checkbox", { name: "핵심 범위 관점 선택", exact: true }).check();
  await page.getByRole("checkbox", { name: "확장 범위 관점 선택", exact: true }).check();
  await page.getByRole("button", { name: "선택 의견으로 정리 초안 만들기", exact: true }).click();
  const decisionBody = page.getByRole("textbox", { name: "검토한 결과 내용", exact: true });
  await expect(decisionBody).toBeVisible();
  if (editDecision) {
    const reviewedBody = `${await decisionBody.inputValue()}\n사용자 검토 결정: 중복 없이 선택한 기능 범위만 수행합니다.`;
    await decisionBody.fill(reviewedBody);
    await expect(page.getByRole("checkbox", { name: decisionAcknowledgement, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "수정 내용 새 버전 저장", exact: true }).click();
    await expect(decisionBody).toHaveValue(reviewedBody);
    await expect(page.getByRole("checkbox", { name: decisionAcknowledgement, exact: true })).toBeEnabled();
  }
  await page.getByRole("checkbox", { name: decisionAcknowledgement, exact: true }).check();
  await page.getByRole("button", { name: "검토한 결과 확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "확정 결과로 명세 만들기", exact: true })).toBeEnabled();
  if (testInfo) await attachEvidence(page, testInfo, "confirmed-analysis-decision");
  await page.getByRole("button", { name: "확정 결과로 명세 만들기", exact: true }).click();
  await expect(page).toHaveURL(/\/specification$/); await expect(specPanel(page)).toBeVisible();
}

async function generateAndEdit(page, bodySuffix = "사용자 명세 기준: 검토한 기능만 수행") {
  await page.getByRole("button", { name: "확정 결과로 명세 생성", exact: true }).click();
  const title = page.getByRole("textbox", { name: "명세 제목", exact: true }), body = page.getByRole("textbox", { name: "명세 내용", exact: true });
  await expect(body).toBeVisible();
  const text = `${await body.inputValue()}\n${bodySuffix}`;
  await title.fill("검토 완료 명세서"); await body.fill(text);
  await expect(page.getByRole("checkbox", { name: specAcknowledgement, exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "수정본 새 버전 저장", exact: true }).click();
  await expect(title).toHaveValue("검토 완료 명세서"); await expect(body).toHaveValue(text);
  await expect(page.getByRole("checkbox", { name: specAcknowledgement, exact: true })).toBeEnabled();
  return text;
}

async function confirmSpec(page) {
  await page.getByRole("checkbox", { name: specAcknowledgement, exact: true }).check();
  await page.getByRole("button", { name: "명세서 최종 확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeEnabled();
}

async function downloadBytes(page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  const file = await waiting; expect(file.suggestedFilename()).toMatch(/검토 완료 명세서-v2\.pdf$/);
  const bytes = await readFile(await file.path()); expect(bytes.subarray(0, 5).toString()).toEqual("%PDF-");
  return bytes;
}

test.use({ trace: "on" });

test("confirmed result becomes an edited specification, exact-revision PDF and final-only reusable document", async ({ page }, testInfo) => {
  const { state, workflow, specifications } = await specificationWorkflowFixture(page);
  await page.goto(decisionPath); await confirmDecision(page, testInfo);
  const finalBody = await generateAndEdit(page);
  expect(specifications.documents).toHaveLength(0);
  const previous = structuredClone(specifications.items[1]);
  await confirmSpec(page);
  const current = specifications.items[0], document = specifications.documents[0];
  expect(current.status).toEqual("CONFIRMED"); expect(current.sourceDecisionId).toEqual(workflow.decisions[0].id);
  expect(current.sourceBodyText).toEqual(workflow.decisions[0].bodyText);
  expect(document.chunks.map(chunk => chunk.content).join("")).toEqual(finalBody);
  expect(document.chunks[0].content).not.toContain("RECOMMENDED 선택 제안");
  expect(document.sourceUri).toEqual(`specification:${current.id}`); expect(document.sourceVersion).toEqual("spec-v2");
  expect(document.origin).toEqual("user"); expect(document.memoryType).toEqual("decision"); expect(document.retrievalEligible).toBe(true);
  expect(specifications.items.find(value => value.id === previous.id)).toEqual(previous);
  await attachEvidence(page, testInfo, "confirmed-specification-before-download");
  const bytes = await downloadBytes(page); expect(await downloadBytes(page)).toEqual(bytes);
  expect(specifications.pdfs).toEqual([current.id, current.id]);
  const savedSpecification = structuredClone(current), savedDocument = structuredClone(document), extraDownloads = [];
  const recordDownload = download => extraDownloads.push(download);
  page.on("download", recordDownload);
  specifications.pdfError = { status: 503, message: "PDF 출력 준비가 되어 있지 않습니다. 확정 내용은 보존되며 출력 준비 후 다시 시도할 수 있습니다." };
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  await expect(specPanel(page).getByRole("alert")).toContainText(specifications.pdfError.message);
  const confirmedContent = specPanel(page).locator(".specification-detail > pre.specification-content");
  await expect(confirmedContent).toBeVisible();
  expect(await confirmedContent.textContent()).toEqual(finalBody);
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeEnabled();
  expect(specifications.items[0]).toEqual(savedSpecification);
  expect(specifications.documents[0]).toEqual(savedDocument);
  expect(extraDownloads).toHaveLength(0);
  expect(specifications.pdfFailures).toEqual([{ id: current.id, ...specifications.pdfError }]);
  expect(specifications.pdfs).toEqual([current.id, current.id, current.id]);
  await attachEvidence(page, testInfo, "pdf-unavailable-confirmed-content-preserved");
  page.off("download", recordDownload);
  specifications.pdfError = null;
  await page.getByRole("button", { name: "근거 자료 관리", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/knowledge$/);
  await expect(page.locator(".knowledge-detail")).toContainText(finalBody);
  await expect(page.locator(".knowledge-detail")).toContainText(`specification:${current.id}`);
  expect(state.starts).toHaveLength(0); expect(state.blocked).toEqual([]);
  expect(specifications.confirms).toHaveLength(1);
  await attachEvidence(page, testInfo, "confirmed-document-reuse-screen");
  await attachContracts(testInfo, { state, workflow, specifications });
});

test("an ambiguous specification save retries the same revision and does not overwrite a newer target", async ({ page }) => {
  const { specifications } = await specificationWorkflowFixture(page);
  await page.goto(decisionPath); await confirmDecision(page);
  await page.getByRole("button", { name: "확정 결과로 명세 생성", exact: true }).click();
  const body = page.getByRole("textbox", { name: "명세 내용", exact: true }); await expect(body).toBeVisible();
  const text = `${await body.inputValue()}\n아직 저장 응답을 받지 못한 수정`; await body.fill(text);
  specifications.lostResponses.revise = 1; const barrier = requestBarrier(); specifications.barriers.revise = barrier;
  await page.getByRole("button", { name: "수정본 새 버전 저장", exact: true }).evaluate(node => { node.click(); node.click(); });
  await barrier.entered; expect(specifications.revisions).toHaveLength(1); expect(specifications.items).toHaveLength(2); barrier.release();
  await expect(specPanel(page).getByRole("alert")).toBeVisible(); await expect(body).toHaveValue(text);
  const saved = structuredClone(specifications.items[0]);
  const newer = { ...structuredClone(saved), id: "c1000000-0000-4000-8000-000000000099", supersedes: saved.id,
    revisionNumber: 3, bodyText: "다른 탭에서 먼저 저장한 최신 명세", contentHash: "d".repeat(64), downloadFileName: "newer-v3.pdf" };
  specifications.items.unshift(newer);
  await page.getByRole("button", { name: "수정본 새 버전 저장", exact: true }).click();
  await expect(body).toHaveValue(text); await expect(page.getByRole("checkbox", { name: specAcknowledgement, exact: true })).toBeEnabled();
  expect(specifications.revisions).toHaveLength(2); expect(specifications.revisions[1].requestId).toEqual(specifications.revisions[0].requestId);
  expect(specifications.items).toHaveLength(3); expect(specifications.items[0]).toEqual(newer);
  expect(specifications.items.find(value => value.id === saved.id)).toEqual(saved);
  await page.getByRole("checkbox", { name: specAcknowledgement, exact: true }).check();
  await page.getByRole("button", { name: "명세서 최종 확정", exact: true }).click();
  await expect(specPanel(page).getByRole("alert")).toContainText("a newer specification revision exists");
  await expect(body).toHaveValue(text); expect(specifications.documents).toHaveLength(0);
  expect(specifications.items[0]).toEqual(newer);
});

test("a newer confirmed result prevents first-time confirmation of an old-source specification", async ({ page }) => {
  const { workflow, specifications } = await specificationWorkflowFixture(page);
  await page.goto(decisionPath); await confirmDecision(page); await generateAndEdit(page);
  const existing = workflow.decisions[0]; workflow.decisions.unshift({ ...structuredClone(existing), id: "d1000000-0000-4000-8000-000000000099", versionNumber: 2 });
  await page.reload(); await expect(specPanel(page)).toBeVisible();
  await expect(specPanel(page)).toContainText("프로젝트 원문 또는 확정 결과가 변경되었습니다.");
  await expect(page.getByRole("checkbox", { name: specAcknowledgement, exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "명세서 최종 확정", exact: true })).toBeDisabled();
  expect(specifications.documents).toHaveLength(0); expect(specifications.confirms).toHaveLength(0);
});

test("login, customer-linked intake, pet question, full-analysis clarification and final work products stay connected", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto("/workspace/projects"); await expect(page.locator('input[name="email"]')).toBeVisible();
  const { state, workflow, specifications, flow } = await fullWorkflowFixture(page);
  await page.locator('input[name="email"]').fill("workflow@example.invalid"); await page.locator('input[name="password"]').fill("synthetic-test-password");
  await page.locator('#auth-panel-login button[type="submit"]').click();
  await expect(page.getByRole("button", { name: "고객 관리", exact: true })).toBeVisible(); expect(flow.logins).toEqual([{ email: "workflow@example.invalid" }]);
  await page.getByRole("button", { name: "고객 관리", exact: true }).click();
  await page.getByRole("textbox", { name: "담당자 이름", exact: true }).fill("합성 검증 고객");
  await page.getByRole("button", { name: "고객 등록", exact: true }).click(); await expect.poll(() => flow.clientCreates.length).toBe(1);
  await page.getByRole("button", { name: "신규 문의 등록", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.locator('input[name="title"]').fill("전체 흐름 검증 프로젝트");
  const original = "고객이 제공한 원문: 로그인과 고객 관리 기능을 검토해 주세요.";
  await dialog.locator('textarea[name="requirementText"]').fill(original); await dialog.locator(".quick-intake-options summary").click();
  await dialog.locator('select[name="clientId"]').selectOption(flow.clients[0].id);
  await dialog.getByRole("button", { name: "프로젝트 만들기", exact: true }).click(); await expect(page).toHaveURL(/\/project-one\/intake$/);
  await page.getByRole("navigation", { name: "프로젝트 진행 단계", exact: true }).getByRole("button", { name: /AI 분석/ }).click();
  await expect(page).toHaveURL(/\/project-one\/agent$/);
  expect(flow.projectCreates[0].clientId).toEqual(flow.clients[0].id); expect(state.projects[0].workspaceId).toEqual("local-space");
  await page.locator("#agent-chat-input").fill("이 프로젝트에서 먼저 확인할 점은 무엇인가요?");
  await page.getByRole("button", { name: "보내기", exact: true }).click(); await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].workflowMode).toEqual("AD_HOC"); expect(state.projects[0].requirementText).toEqual(original);
  await expect(page.getByRole("button", { name: "프로젝트 전체 분석 시작", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "프로젝트 전체 분석 시작", exact: true }).click();
  const answer = page.locator(".agent-chat .interruption-form"); await expect(answer).toBeVisible();
  await answer.locator("textarea").fill("고객 제공 이미지 사용, 결제 기능은 제외합니다."); await answer.getByRole("button", { name: "답변하고 계속", exact: true }).click();
  await expect.poll(() => state.resumes.length).toBe(1);
  expect(state.starts[1]).toMatchObject({ workflowMode: "PROJECT_ANALYSIS", requirementText: original });
  expect(state.resumes[0].answers[0].answer).toEqual("고객 제공 이미지 사용, 결제 기능은 제외합니다.");
  await page.getByRole("button", { name: "계획 의견 선택·확정", exact: true }).click(); await expect(page).toHaveURL(/\/decision$/);
  await confirmDecision(page, testInfo, true); await generateAndEdit(page);
  // Prime the knowledge cache immediately before confirmation, then return via
  // real browser history. The confirmed projection must invalidate that cache.
  await page.getByRole("button", { name: "근거 자료 관리", exact: true }).click(); await expect(page.getByText("저장된 자료가 없습니다.", { exact: true })).toBeVisible();
  await page.goBack(); await expect(specPanel(page)).toBeVisible(); await confirmSpec(page);
  await attachEvidence(page, testInfo, "confirmed-specification-before-download");
  const bytes = await downloadBytes(page); expect(await downloadBytes(page)).toEqual(bytes);
  await page.getByRole("button", { name: "근거 자료 관리", exact: true }).click();
  await expect(page.locator(".knowledge-detail")).toContainText("사용자 명세 기준: 검토한 기능만 수행");
  const final = specifications.items[0]; expect(final.sourceRunId).toEqual(workflowRunId); expect(final.sourceDecisionId).toEqual(workflow.decisions[0].id);
  expect(final.originalSources).toContainEqual(expect.objectContaining({ kind: "USER_CLARIFICATION", content: "고객 제공 이미지 사용, 결제 기능은 제외합니다." }));
  expect(state.starts).toHaveLength(2); expect(state.blocked).toEqual([]); expect(specifications.documents).toHaveLength(1);
  expect(workflow.decisions[0].sourceOpinions.map(value => value.scenario)).toEqual(["LEAN", "EXPANDED"]);
  expect(workflow.revisions).toHaveLength(1); expect(workflow.decisions[0].versionNumber).toEqual(2);
  expect(specifications.pdfs).toEqual([final.id, final.id]);
  await attachEvidence(page, testInfo, "login-to-confirmed-document-screen");
  await attachContracts(testInfo, { state, workflow, specifications, flow });
});
