import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Vercel Preview uses the standard Next.js build without Cloudflare adapters", async () => {
  const [packageSource, lockfile, vercelSource, nextEnv, runbook] = await Promise.all([
    read("../package.json"),
    read("../package-lock.json"),
    read("../vercel.json"),
    read("../next-env.d.ts"),
    read("../VERCEL_PREVIEW.md"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const vercel = JSON.parse(vercelSource);
  assert.equal(packageJson.engines.node, "22.x");
  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.equal(packageJson.dependencies.next, "16.3.1");
  assert.equal(vercel.framework, "nextjs");
  assert.equal(vercel.installCommand, "npm ci");
  assert.equal(vercel.buildCommand, "npm run build");
  assert.equal("outputDirectory" in vercel, false);
  assert.match(nextEnv, /reference types="next"/);
  assert.doesNotMatch(packageSource, /vinext|wrangler|@cloudflare|vite|drizzle/);
  assert.doesNotMatch(lockfile, /node_modules\/vinext|node_modules\/wrangler|node_modules\/@cloudflare\/vite-plugin/);
  assert.match(runbook, /Root Directory: `frontend`/);
  assert.match(runbook, /APP_CORS_ALLOWED_ORIGINS/);
});

test("landing page follows the approved product brief without fabricated social proof", async () => {
  const source = await read("../app/page.tsx");
  assert.match(source, /모호한 고객 문의를/);
  assert.match(source, /근거 있는 견적으로/);
  assert.match(source, /AI 초안은 사용자가 검토하고 확정합니다/);
  assert.match(source, /한국 소프트웨어 개발/);
  assert.match(source, /견적이 어려운 이유는/);
  assert.match(source, /한 번의 문의가/);
  assert.match(source, /설명 가능한 결과/);
  assert.match(source, /끝난 프로젝트가/);
  assert.match(source, /aria-selected=\{index === evidenceIndex\}/);
  assert.doesNotMatch(source, /김도윤|박서연|이준호|98%|10배|무제한 AI|모든 직군|모든 국가|자동 학습합니다/);
});

test("every CSS custom property resolves except runtime font variables", async () => {
  const css = await read("../app/globals.css");
  const definitions = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((match) => match[1]));
  const uses = new Set([...css.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((match) => match[1]));
  const runtimeVariables = new Set(["--font-geist-sans", "--font-geist-mono"]);
  assert.deepEqual([...uses].filter((name) => !definitions.has(name) && !runtimeVariables.has(name)), []);
});

test("workspace calls Spring only and renders a live event-driven graph", async () => {
  const [workspace, api, graph] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/components/live-workflow.tsx"),
  ]);
  assert.match(workspace, /streamRunEvents/);
  assert.match(workspace, /LiveWorkflow/);
  assert.match(api, /NEXT_PUBLIC_API_BASE_URL/);
  assert.match(api, /\/api\/v2\/workspaces/);
  assert.doesNotMatch(api, /localhost:8000|\/internal\/v1/);
  assert.match(graph, /tool\.started/);
  assert.match(graph, /quotation\.draft\.created/);
  assert.match(graph, /run\.completed/);
});

test("responsive and reduced-motion gates cover the documented breakpoints", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /grid-auto-flow: dense/);
});

test("manual quotation, evidence, outcome, and public proposal flows use real Spring contracts", async () => {
  const [workspace, api, proposal] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/proposal/[token]/page.tsx"),
  ]);
  assert.match(workspace, /createQuotation/);
  assert.match(workspace, /basis\.content/);
  assert.match(workspace, /sourceReference: event\.target\.value/);
  assert.match(workspace, /근거는 출처 유형과 참조가 필수입니다/);
  assert.match(workspace, /evidence-inspector/);
  assert.match(workspace, /aria-label="서비스 단가표"/);
  assert.match(workspace, /rateCardId: card\.id/);
  assert.match(workspace, /aria-label="견적 시나리오 비교"/);
  assert.match(workspace, /latestByScenario/);
  assert.match(workspace, /loadQuotation\(quotation\)/);
  assert.match(workspace, /saveOutcome/);
  assert.match(workspace, /reviseQuotation/);
  assert.match(workspace, /사용자 확정 revision 저장/);
  assert.match(api, /\/quotations\/\$\{quotationId\}\/publish/);
  assert.match(api, /\/quotations\/\$\{quotationId\}\/revisions/);
  assert.match(api, /\/proposal-shares\/\$\{shareId\}/);
  assert.match(api, /\/projects\/\$\{projectId\}\/outcome/);
  assert.match(proposal, /submitProposalDecision/);
  assert.match(proposal, /CHANGES_REQUESTED/);
  assert.match(proposal, /window\.print/);
  assert.match(workspace, /링크 비활성화/);
});

test("pipeline, onboarding settings, and structured intake are API-backed", async () => {
  const [workspace, api, cache] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/lib/query-cache.ts"),
  ]);
  assert.match(workspace, /PipelineBoard/);
  assert.match(workspace, /SettingsPanel/);
  assert.match(workspace, /createRequirementVersion/);
  assert.match(workspace, /saveRateCard/);
  assert.match(workspace, /saveEstimationPolicy/);
  assert.match(workspace, /createDocument/);
  assert.match(workspace, /항목별 실제 결과/);
  assert.match(workspace, /예상 대비 오차/);
  assert.match(workspace, /revenueVariance/);
  assert.match(workspace, /hoursVariance/);
  assert.match(workspace, /refreshAuthSession/);
  assert.match(api, /method: "PATCH"/);
  assert.match(api, /\/rate-cards\/\$\{rateCardId\}/);
  assert.match(api, /\/estimation-policy/);
  assert.match(api, /\/documents/);
  assert.match(api, /\/auth\/refresh/);
  assert.match(cache, /pending/);
  assert.match(cache, /invalidateQueries/);
});

test("CRM lifecycle and project-to-client linking use the Spring client contract", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /ClientsPanel/);
  assert.match(workspace, /createClient/);
  assert.match(workspace, /updateClient/);
  assert.match(workspace, /archiveClient/);
  assert.match(workspace, /name="clientId"/);
  assert.match(workspace, /기존 프로젝트 연결은 유지됩니다/);
  assert.match(api, /clients:\$\{session\.workspaceId\}/);
  assert.match(api, /\/clients\/\$\{clientId\}/);
  assert.match(api, /clientId: string \| null/);
});

test("workspace switching and agent cancellation preserve recoverable operator control", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /profile\.workspaces\.length > 1/);
  assert.match(workspace, /workspaceId: event\.target\.value/);
  assert.match(workspace, /permissions\.has\("project\.read"\)/);
  assert.match(workspace, /activePermissions\.has\("client\.read"\)/);
  assert.match(workspace, /permissions\.has\("document\.delete"\)/);
  assert.match(workspace, /cancelAgentRun/);
  assert.match(workspace, /새 분석 준비/);
  assert.match(workspace, /저장된 프로젝트와 이전 결과는 변경되지 않습니다/);
  assert.match(api, /\/agent-runs\/\$\{runId\}\/cancel/);
});

test("expired access tokens use one coordinated refresh and retry the original Spring request", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(api, /let refreshPromise: Promise<AuthSession> \| null = null/);
  assert.match(api, /response\.status === 401 && token && allowSessionRecovery/);
  assert.match(api, /return request<T>\(path, init, recovered\.accessToken, false\)/);
  assert.match(api, /refreshTokenExpiresAt/);
  assert.match(api, /SESSION_RECOVERY_EVENT/);
  assert.match(workspace, /subscribeToSessionRecovery/);
  assert.match(workspace, /로그인 시간이 만료되었습니다\. 다시 로그인해 주세요/);
});

test("workspace evidence library exposes the complete document lifecycle", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /KnowledgePanel/);
  assert.match(workspace, /prepareDocumentUpload/);
  assert.match(workspace, /sourceTypeLabel/);
  assert.match(workspace, /Agent 검색에서는 제외됩니다/);
  assert.match(workspace, /detail\.chunks\.slice\(0, 4\)/);
  assert.match(api, /function getDocument/);
  assert.match(api, /function archiveDocument/);
  assert.match(api, /method: "DELETE"/);
});

test("project details remain editable after intake without mutating quotation revisions", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /ProjectEditDialog/);
  assert.match(workspace, /프로젝트 정보 수정/);
  assert.match(workspace, /최소 예산은 최대 예산보다 클 수 없습니다/);
  assert.match(workspace, /이미 발행한 견적 revision은 변경되지 않습니다/);
  assert.match(workspace, /structuredOutdated/);
  assert.match(workspace, /새 revision을 확정한 뒤 견적을 검토하세요/);
  assert.match(workspace, /setFeatures\(latest\?\.features\.map/);
  assert.match(workspace, /updateProjectDetails/);
  assert.match(api, /interface ProjectInput/);
  assert.match(api, /status: project\.status/);
});

test("agent results expose reviewable questions and safe source provenance", async () => {
  const workspace = await read("../app/workspace/page.tsx");
  assert.match(workspace, /run\.result\.openQuestions/);
  assert.match(workspace, /아직 확인할 질문/);
  assert.match(workspace, /result\.sources\.length/);
  assert.match(workspace, /검토 가능한 출처/);
  assert.match(workspace, /externalHttpUrl\(source\.url\)/);
  assert.match(workspace, /url\.protocol === "https:" \|\| url\.protocol === "http:"/);
  assert.match(workspace, /rel="noopener noreferrer"/);
  assert.match(workspace, /run\.metadata\.promptVersion/);
});

test("quotation revision conflicts preserve the draft and expose explicit recovery choices", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /cause instanceof ApiError && cause\.status === 409/);
  assert.match(workspace, /reloadQuotations\(session, project\.id\)/);
  assert.match(workspace, /현재 입력은 그대로 보존했습니다/);
  assert.match(workspace, /최신 revision 불러오기/);
  assert.match(workspace, /현재 입력을 새 시리즈로 계속/);
  assert.match(api, /function reloadQuotations/);
});

test("terminal agent runs expose server-accounted cost only to audit readers", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /permissions\.has\("audit\.read"\)/);
  assert.match(workspace, /getAgentRunUsage/);
  assert.match(workspace, /서버 원가 기록/);
  assert.match(workspace, /billableOutcome/);
  assert.match(api, /interface AgentRunUsage/);
  assert.match(api, /\/agent-runs\/\$\{runId\}\/usage/);
});

test("workspace administrators can version the server-owned model price catalog", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /AI 모델 원가표/);
  assert.match(workspace, /canReadPricing = permissions\.has\("audit\.read"\)/);
  assert.match(workspace, /canManagePricing = permissions\.has\("workspace\.update"\)/);
  assert.match(workspace, /가격 유효 종료 시점은 시작 시점보다 늦어야 합니다/);
  assert.match(workspace, /createModelPricing/);
  assert.match(api, /interface ModelPricing/);
  assert.match(api, /\/model-pricing/);
});
