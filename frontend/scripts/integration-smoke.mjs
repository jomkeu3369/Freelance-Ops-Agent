import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Use the application's API client against a real, disposable local workspace.
const baseUrl = process.env.INTEGRATION_API_BASE_URL || "http://localhost:8080";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) throw new Error("Integration fixtures require a loopback API origin.");
process.env.NEXT_PUBLIC_API_BASE_URL = baseUrl;
const temporaryRoot = await mkdtemp(join(tmpdir(), "freelance-ops-integration-"));
const statePath = process.env.INTEGRATION_STATE_PATH;
let api;
let session;
let project;
let share;
let keepFixtures = false;
try {
  for (const moduleName of ["api", "query-cache"]) {
    const source = await readFile(new URL(`../app/lib/${moduleName}.ts`, import.meta.url), "utf8");
    const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } });
    await writeFile(join(temporaryRoot, `${moduleName}.mjs`), result.outputText.replace('"./query-cache"', '"./query-cache.mjs"'));
  }
  api = await import(pathToFileURL(join(temporaryRoot, "api.mjs")));
  const nonce = randomUUID();
  const email = `integration-${nonce}@example.invalid`;
  const password = `Integration-${nonce}!`;
  const marker = `Integration-${nonce.slice(0, 8)}`;
  session = await api.register({ email, password, displayName: "통합 검수", workspaceName: marker });
  assert.equal((await api.getMe(session)).id, session.userId);
  console.log("PASS registration and authenticated workspace");

  const client = await api.createClient(session, { name: "통합 검수 고객", companyName: marker, email: null, phone: null, notes: "Synthetic integration data" });
  const input = { clientId: client.id, title: `${marker} 반응형 페이지`, requirementText: "카페 소개용 반응형 웹 페이지 1개. 메뉴와 위치 안내만 포함합니다. 로그인, 결제, 관리자 기능은 제외합니다. 제공된 문구와 사진을 사용하고 검토는 1회입니다. 기본 구현 공수는 8시간으로 가정합니다.", currency: "KRW", deadline: null, budgetMin: null, budgetMax: null };
  project = await api.createProject(session, input);
  assert.equal(project.currency, "KRW");
  assert.equal(project.budgetMin, null);
  assert.equal((await api.listProjects(session, marker))[0].id, project.id);
  console.log("PASS project intake, optional defaults and search");

  const staleProject = project;
  project = await api.updateProjectDetails(session, project, { ...input, title: `${marker} 수정된 제목` });
  project = await api.updateProject(session, staleProject, "QUOTING");
  assert.equal(project.title, `${marker} 수정된 제목`);
  assert.equal(project.status, "QUOTING");
  console.log("PASS stage-only update preserves newer project details");

  const requirements = await api.createRequirementVersion(session, project.id, { sourceText: input.requirementText, features: [{ title: "반응형 소개 페이지", description: "메뉴와 위치 안내", priority: "MUST", acceptanceCriteria: "모바일과 데스크톱에서 메뉴와 위치 표시" }], assumptions: ["사진과 문구는 고객 제공"], questions: [] });
  assert.equal((await api.listRequirements(session, project.id))[0].id, requirements.id);
  const rate = await api.saveRateCard(session, randomUUID(), { name: "통합 검수 시간 단가", unit: "HOUR", rate: 50000, minimumAmount: 0, currency: "KRW", active: true });
  await api.saveEstimationPolicy(session, { defaultTaxRate: 0.1, defaultRiskBufferRate: 0, maximumDiscountRate: 0.2 });
  const quotation = await api.createQuotation(session, project.id, { scenario: "RECOMMENDED", currency: "KRW", taxRate: 0.1, applyDefaultRiskBuffer: false, validUntil: null, items: [{ rateCardId: rate.id, title: "소개 페이지 구현", description: "통합 검수용 작업", quantity: 8, unit: "HOUR", unitRate: 50000, discountRate: 0, basis: { type: "ASSUMPTION", content: "제공된 사진과 문구로 8시간 작업을 가정", sourceType: null, sourceReference: null, sourceTitle: null, retrievedAt: null } }] });
  assert.equal(quotation.total, 440000);
  assert.equal((await api.publishQuotation(session, quotation.id)).status, "PUBLISHED");
  console.log("PASS requirements, rate card, deterministic quotation and publication");

  share = await api.createProposalShare(session, quotation.id, 1);
  const publicProposal = await api.getSharedProposal(share.token);
  assert.equal(publicProposal.total, quotation.total);
  const decision = await api.submitProposalDecision(share.token, { decision: "APPROVED", clientName: "통합 검수 고객", clientEmail: "synthetic@example.invalid", comment: "실거래가 아닌 로컬 통합 검수입니다." });
  assert.equal(decision.decision, "APPROVED");
  await assert.rejects(() => api.submitProposalDecision(share.token, { decision: "APPROVED", clientName: "통합 검수 고객", clientEmail: "synthetic@example.invalid", comment: "중복 응답 검수" }), error => error.status === 409);
  console.log("PASS public proposal, approval recording and duplicate decision rejection");

  const outcome = await api.saveOutcome(session, project.id, { approvedQuotationId: quotation.id, totalRevenue: 440000, actualCost: 300000, actualHours: 8, completedOn: new Date().toISOString().slice(0, 10), changeReason: "로컬 통합 검수", workItems: [] });
  assert.equal((await api.getOutcome(session, project.id)).actualHours, outcome.actualHours);
  console.log("PASS outcome persistence");
  if (statePath) {
    await writeFile(resolve(statePath), JSON.stringify({ email, password, marker, projectId: project.id, workspaceId: session.workspaceId, shareId: share.shareId, publicPath: share.publicPath }, null, 2));
    keepFixtures = true;
    console.log("Synthetic fixture retained for browser verification; credentials are only in the requested state file.");
  }
} finally {
  try {
    if (session && !keepFixtures) {
      if (share) await api.revokeProposalShare(session, share.shareId);
      if (project) await api.deleteProject(session, project.id);
      await api.revokeAuthSession(session);
    }
  } finally {
    if (resolve(temporaryRoot).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/"))) await rm(temporaryRoot, { recursive: true, force: true });
  }
}
