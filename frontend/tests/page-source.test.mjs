import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateVercelEnvironment } from "../scripts/validate-vercel-env.mjs";
import { isActiveStreamStatus, nextStreamCursor, streamReconnectDelay } from "../app/lib/stream-retry.mjs";
import { sessionRefreshDelay } from "../app/lib/session-timing.mjs";
import { buildWorkspaceSearch, parseWorkspaceLocation } from "../app/lib/workspace-navigation.mjs";
import { createQuotationDraft, parseQuotationDraft, quotationDraftFingerprint, quotationDraftKey } from "../app/lib/quotation-draft.mjs";
import { createInterruptionDraft, interruptionDraftKey, parseInterruptionDraft } from "../app/lib/interruption-draft.mjs";

test("HITL drafts remain isolated to an exact run and expire after 24 hours", () => {
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const expected = { workspaceId: "workspace / alpha", runId: "run-17", interruptionId: "interrupt-3", questions: ["납기를 확인해 주세요."] };
  const draft = createInterruptionDraft({ ...expected, answers: ["9월 30일"] }, now);
  assert.equal(interruptionDraftKey("user-1", expected.workspaceId, expected.runId, expected.interruptionId), "freelance-ops-interruption-draft-v1:user-1:workspace%20%2F%20alpha:run-17:interrupt-3");
  assert.deepEqual(parseInterruptionDraft(JSON.stringify(draft), expected, now), draft);
  assert.equal(parseInterruptionDraft(JSON.stringify(draft), { ...expected, runId: "run-18" }, now), null);
  assert.equal(parseInterruptionDraft(JSON.stringify(draft), { ...expected, questions: ["예산을 확인해 주세요."] }, now), null);
  assert.equal(parseInterruptionDraft(JSON.stringify(draft), expected, now + 25 * 60 * 60 * 1_000), null);
});

test("pipeline and HITL controls preserve the server truth and unfinished answers", async () => {
  const [workspace, css] = await Promise.all([read("../app/workspace/page.tsx"), read("../app/globals.css")]);
  assert.match(workspace, /<select value=\{project\.status\}/);
  assert.match(workspace, /ACCEPTED: "고객 승인됨"/);
  assert.match(workspace, /interruptionDraftKey\(session\.userId, session\.workspaceId/);
  assert.match(workspace, /await onSubmit\(answers\.map/);
  assert.match(workspace, /작성 중인 답변은 이 탭에 임시 저장됩니다/);
  assert.match(css, /\.interruption-actions/);
});

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
  assert.equal(packageJson.scripts.build, "node scripts/validate-vercel-env.mjs && next build");
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

test("frontend source has no legacy platform runtime shims", async () => {
  const appFiles = [
    "../app/layout.tsx",
    "../app/page.tsx",
    "../app/providers.tsx",
    "../app/workspace/page.tsx",
    "../app/proposal/[token]/page.tsx",
    "../app/lib/api.ts",
  ];
  const source = (await Promise.all(appFiles.map(read))).join("\n");
  assert.doesNotMatch(source, /oai-authenticated-user|signin-with-chatgpt|signout-with-chatgpt/);
  assert.doesNotMatch(source, /cloudflare|wrangler|D1Database|vinext/i);
});

test("Vercel public environment validation fails closed without leaking values", () => {
  assert.deepEqual(validateVercelEnvironment({}), { apiOrigin: null, siteOrigin: null });
  assert.throws(
    () => validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid" }),
    /NEXT_PUBLIC_API_BASE_URL must be configured/,
  );
  assert.throws(
    () => validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: "http://api.example.invalid" }),
    /must use HTTPS/,
  );
  assert.throws(
    () => validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: "https://api.example.invalid/v2" }),
    /must be an origin/,
  );
  assert.throws(
    () => validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: "https://user:password@api.example.invalid" }),
    /must not contain credentials/,
  );
  assert.throws(
    () => validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: "https://localhost" }),
    /must be publicly reachable/,
  );
  assert.deepEqual(
    validateVercelEnvironment({
      VERCEL: "1",
      VERCEL_URL: "preview.example.invalid",
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.invalid",
    }),
    { apiOrigin: "https://api.example.invalid", siteOrigin: null },
  );
});

test("App Router recovery states and keyboard navigation remain product-safe", async () => {
  const [layout, errorBoundary, notFound, proposal, workspace, css] = await Promise.all([
    read("../app/layout.tsx"),
    read("../app/error.tsx"),
    read("../app/not-found.tsx"),
    read("../app/proposal/[token]/page.tsx"),
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(layout, /href="#main-content"/);
  assert.match(errorBoundary, /reset/);
  assert.match(errorBoundary, /오류 참조/);
  assert.match(notFound, /Workspace 열기/);
  assert.match(proposal, /다시 시도/);
  assert.match(proposal, /aria-pressed=/);
  assert.match(workspace, /copyToClipboard/);
  assert.match(workspace, /자동 복사가 차단되었습니다/);
  assert.match(workspace, /링크 복사/);
  assert.match(workspace, /role="tabpanel"/);
  assert.match(workspace, /aria-controls="auth-panel-login"/);
  assert.match(workspace, /event\.key === "ArrowLeft"/);
  assert.match(workspace, /useDialogFocusTrap/);
  assert.match(workspace, /document\.body\.style\.overflow = "hidden"/);
  assert.match(workspace, /previouslyFocused\?\.focus\(\)/);
  assert.match(workspace, /aria-current=/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.skip-link:focus/);
});

test("landing page follows the approved product brief without fabricated social proof", async () => {
  const source = await read("../app/page.tsx");
  assert.match(source, /모호한 고객 문의를/);
  assert.match(source, /근거 있는 견적으로/);
  assert.match(source, /AI 초안은 사용자가 검토하고 확정합니다/);
  assert.match(source, /한국 소프트웨어 개발/);
  assert.match(source, /견적이 어려운 이유는/);
  assert.match(source, /한 번의 문의가/);
  assert.match(source, /function WorkflowStepVisual/);
  assert.match(source, /고객 메시지/);
  assert.match(source, /금액 자동 계산/);
  assert.match(source, /activeStep === index && <WorkflowStepVisual index=\{index\} \/>/);
  assert.match(source, /설명 가능한 결과/);
  assert.match(source, /끝난 프로젝트가/);
  assert.match(source, /aria-selected=\{index === evidenceIndex\}/);
  assert.doesNotMatch(source, /김도윤|박서연|이준호|98%|10배|무제한 AI|모든 직군|모든 국가|자동 학습합니다/);
});

test("landing typography keeps Korean display copy within the measured line budget", async () => {
  const [layout, source, css] = await Promise.all([
    read("../app/layout.tsx"),
    read("../app/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(layout, /pretendardvariable-dynamic-subset\.css/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(source, /모호한 고객 문의를,<br \/><span>근거 있는 견적으로\.<\/span>/);
  assert.match(css, /font-synthesis: none/);
  assert.match(css, /word-break: keep-all/);
  assert.match(css, /\.hero-title \{[^}]*clamp\(4\.25rem, 4\.7vw, 5\.65rem\)/);
  assert.match(css, /\.evidence-copy h2, \.outcome-copy h2 \{ font-size: clamp\(3\.1rem, 3\.6vw, 4\.3rem\)/);
  assert.match(css, /\.audience-section \.section-heading h2 \{ font-size: clamp\(1\.9rem, 7\.6vw, 2\.2rem\)/);
  assert.match(css, /\.final-cta h2 \{ font-size: clamp\(2rem, 8\.5vw, 3\.5rem\)/);
  assert.match(css, /\.accordion-content strong \{[^}]*writing-mode: vertical-rl; text-orientation: upright/);
  assert.doesNotMatch(css, /\.accordion-content strong \{[^}]*rotate\(180deg\)/);
  assert.match(css, /\.step-visual \{[^}]*grid-template-columns: minmax\(86px, 1fr\) 132px minmax\(90px, 1fr\)/);
  assert.doesNotMatch(source, /ambient|outcome-orbit|cta-light|step-visual-packet|className="orbit"/);
  assert.doesNotMatch(css, /stepPacketFlow|orbitPulse|graphSheen|nodeSpin|signalFlow|signalBar/);
  assert.match(source, /\["프론트엔드", "백엔드", "풀스택", "모바일", "업무 자동화"\]/);
});

test("authentication layout keeps the form visible and Korean words intact", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /\.auth-page \{[^}]*grid-template-columns: minmax\(0, 1\.05fr\) minmax\(360px, \.95fr\)/);
  assert.match(css, /\.auth-page \{[^}]*overflow-x: clip/);
  assert.match(css, /\.auth-message \{[^}]*min-width: 0/);
  assert.match(css, /\.auth-message h1 \{[^}]*word-break: keep-all/);
  assert.match(css, /\.auth-message h1 \{[^}]*text-wrap: balance/);
  assert.match(css, /\.auth-panel \{[^}]*width: min\(calc\(100% - 80px\), 520px\)/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.auth-message h1 \{[^}]*clamp\(3rem, 10vw, 4\.8rem\)/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.auth-message h1 \{[^}]*clamp\(2\.65rem, 11vw, 3\.8rem\)/);
});

test("workspace settings and requirement controls remain readable at desktop widths", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(css, /\.pipeline-heading > div \{[^}]*max-width: 1050px/);
  assert.match(css, /\.pipeline-heading h1,[\s\S]*?font-size: clamp\(2\.15rem, 3\.1vw, 3\.55rem\)/);
  assert.match(css, /\.pipeline-heading h1 \{[^}]*word-break: keep-all/);
  assert.match(css, /\.pipeline-heading h1 \{[^}]*text-wrap: balance/);
  assert.match(css, /\.settings-heading h1,[\s\S]*?font-size: clamp\(2\.15rem, 3\.1vw, 3\.55rem\)/);
  assert.match(css, /\.settings-heading h1 \{[^}]*word-break: keep-all/);
  assert.match(css, /\.settings-heading h1 \{[^}]*text-wrap: balance/);
  assert.match(workspace, /aria-label="작업 공간 설정 목차"/);
  assert.match(workspace, /<span>02<\/span><strong>서비스 단가<\/strong><small>시간·일·고정 금액<\/small>/);
  assert.match(workspace, /자주 쓰는 단가와 계산 기준을 저장해 두면 새 견적을 만들 때 바로 불러올 수 있습니다/);
  assert.doesNotMatch(workspace, /Spring이 소유|결정적으로 적용|workspace\.update 권한이|quotation\.read 권한|outcome\.read 권한|Java 계산 도구|서버 계산 완료|새 revision/);
  assert.match(css, /\.settings-grid \{[^}]*grid-template-columns: 230px minmax\(0, 1fr\)/);
  assert.match(css, /\.settings-form input, \.settings-form select \{[^}]*min-height: 50px/);
  assert.match(css, /\.settings-form input, \.settings-form select \{[^}]*background: var\(--surface-solid\)/);
  assert.match(css, /\.settings-form input:focus, \.settings-form select:focus \{[^}]*border-color: var\(--accent\)/);
  assert.match(css, /\.rate-card-form \.form-row:first-of-type \{[^}]*minmax\(220px, 1\.5fr\)/);
  assert.match(css, /\.requirement-editor \.form-row \{[^}]*grid-template-columns: minmax\(0, 1\.5fr\) minmax\(180px, \.5fr\)/);
  assert.match(css, /\.requirement-editor input, \.requirement-editor select, \.requirement-editor textarea \{[^}]*width: 100%/);
  assert.match(css, /\.requirement-editor input, \.requirement-editor select \{[^}]*min-height: 46px/);
  assert.match(css, /\.requirement-editor textarea \{[^}]*min-height: 92px/);
  assert.match(workspace, /const configuredModelOptions: Record<Provider, string\[]>/);
  assert.match(workspace, /<label>AI 모델<select value=\{model\}/);
  assert.doesNotMatch(workspace, /<label>Model<input/);
  assert.match(workspace, /name="currency" defaultValue="KRW"/);
  assert.match(workspace, /list="suggested-models"/);
  assert.match(css, /--workspace-radius-lg: 22px/);
  assert.match(css, /\.settings-content > section \{[^}]*border: 0;[^}]*background: color-mix/);
  assert.match(css, /\.run-controls \{[^}]*border-radius: var\(--workspace-radius-md\)/);
  assert.match(css, /\.budget-range \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
});

test("every CSS custom property resolves except runtime font variables", async () => {
  const css = await read("../app/globals.css");
  const definitions = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((match) => match[1]));
  const uses = new Set([...css.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((match) => match[1]));
  const runtimeVariables = new Set(["--font-geist-sans", "--font-geist-mono"]);
  assert.deepEqual([...uses].filter((name) => !definitions.has(name) && !runtimeVariables.has(name)), []);
});

test("workspace calls Spring only and renders a live event-driven graph", async () => {
  const [workspace, api, graph, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/components/live-workflow.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /streamRunEvents/);
  assert.match(workspace, /LiveWorkflow/);
  assert.match(graph, /role="progressbar"/);
  assert.match(graph, /statusCopy\[snapshot\.status\]/);
  assert.match(graph, /isMoving && index === activeIndex - 1/);
  assert.match(css, /\.workflow-link\.active/);
  assert.doesNotMatch(graph, /node-orbit|signal-bars/);
  assert.match(api, /NEXT_PUBLIC_API_BASE_URL/);
  assert.match(api, /\/api\/v2\/workspaces/);
  assert.doesNotMatch(api, /localhost:8000|\/internal\/v1/);
  assert.match(graph, /tool\.started/);
  assert.match(graph, /quotation\.draft\.created/);
  assert.match(graph, /run\.completed/);
});

test("Agent SSE reconnects from the last durable event with bounded backoff", async () => {
  const [workspace, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(api, /headers\.set\("Last-Event-ID", String\(lastEventId\)\)/);
  assert.match(api, /contentType\.includes\("text\/event-stream"\)/);
  assert.match(api, /onConnected\?\.\(\)/);
  assert.match(workspace, /lastEventIdRef\.current = nextStreamCursor/);
  assert.match(workspace, /streamReconnectDelay/);
  assert.deepEqual([1, 2, 3, 4, 5, 8].map(streamReconnectDelay), [1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
  assert.equal(nextStreamCursor(8, 9), 9);
  assert.equal(nextStreamCursor(9, 9), 9);
  assert.equal(nextStreamCursor(9, 7), 9);
  assert.equal(isActiveStreamStatus(undefined), true);
  assert.equal(isActiveStreamStatus("RUNNING"), true);
  assert.equal(isActiveStreamStatus("WAITING_FOR_USER"), false);
  assert.match(workspace, /!isActiveStreamStatus\(runStatus\)/);
  assert.match(workspace, /window\.clearTimeout\(retryTimer\)/);
  assert.match(workspace, /aria-live="polite"/);
  assert.match(workspace, /재연결 중/);
  assert.match(css, /workspace-live-status span\.reconnecting/);
});

test("workspace navigation survives refresh and rejects malformed deep links", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.deepEqual(parseWorkspaceLocation(""), { view: "pipeline" });
  assert.deepEqual(parseWorkspaceLocation("?view=clients"), { view: "clients" });
  assert.deepEqual(parseWorkspaceLocation("?view=project&project=project-17&step=quote"), {
    view: "project",
    projectId: "project-17",
    step: "quote",
  });
  assert.deepEqual(parseWorkspaceLocation("?view=project&project=&step=unsafe"), {
    view: "project",
    projectId: null,
    step: "intake",
  });
  assert.deepEqual(parseWorkspaceLocation("?view=javascript%3Aalert%281%29"), { view: "pipeline" });
  assert.equal(buildWorkspaceSearch({ view: "pipeline" }), "");
  assert.equal(
    buildWorkspaceSearch({ view: "project", projectId: "project-17", step: "quote" }),
    "?view=project&project=project-17&step=quote",
  );
  assert.match(workspace, /window\.addEventListener\("popstate", restoreLocation\)/);
  assert.match(workspace, /window\.history\.replaceState/);
  assert.match(workspace, /permissions\.has\("client\.read"\)/);
  assert.match(workspace, /permissions\.has\("document\.read"\)/);
  assert.match(workspace, /projectResult\.find\(\(item\) => item\.id === location\.projectId\)/);
  assert.match(workspace, /selectedProjectIdRef\.current !== project\.id/);
  assert.match(workspace, /aria-label="프로젝트 바로가기"/);
  assert.match(workspace, /projects\.find\(\(item\) => item\.id === event\.target\.value\)/);
  assert.match(css, /\.mobile-project-switcher \{ display: none; \}/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.workspace-sidebar nav \{ display: none; \}/);
});

test("responsive and reduced-motion gates cover the documented breakpoints", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /@media \(min-width: 1181px\) and \(max-width: 1440px\)/);
  assert.match(css, /\.hero-title \{ font-size: clamp\(3\.4rem, 5\.1vw, 5rem\); \}/);
  assert.match(css, /@media \(max-width: 1180px\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /grid-auto-flow: dense/);
  assert.match(css, /\.hero-title \{ font-size: clamp\(2\.8rem, 12vw, 4\.2rem\); \}/);
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

test("session refresh scheduling stays inside the browser timer range", async () => {
  const workspace = await read("../app/workspace/page.tsx");
  const now = Date.parse("2026-08-14T00:00:00Z");
  assert.equal(sessionRefreshDelay("2026-08-14T00:10:00Z", now), 540_000);
  assert.equal(sessionRefreshDelay("2026-08-14T00:00:10Z", now), 1_000);
  assert.equal(sessionRefreshDelay("2099-01-01T00:00:00Z", now), 2_147_000_000);
  assert.equal(sessionRefreshDelay("not-a-date", now), 1_000);
  assert.match(workspace, /sessionRefreshDelay\(session\.accessTokenExpiresAt\)/);
  assert.doesNotMatch(workspace, /Math\.max\(1_000, refreshAt\)/);
});

test("quotation drafts are scoped, validated, expiring, and recoverable", async () => {
  const now = Date.parse("2026-08-14T06:00:00Z");
  const input = {
    workspaceId: "workspace / alpha",
    projectId: "project-17",
    scenario: "RECOMMENDED",
    baseQuotationId: "quotation-3",
    taxRate: 0.1,
    validUntil: "2026-09-01",
    items: [{ rateCardId: null, title: "검수", description: "", quantity: 2, unit: "DAY", unitRate: 500000, discountRate: 0, basis: { type: "ASSUMPTION", content: "화면 3종", sourceType: null, sourceReference: null, sourceTitle: null, retrievedAt: null } }],
  };
  const draft = createQuotationDraft(input, now);
  assert.equal(quotationDraftKey("user-1", input.workspaceId, input.projectId), "freelance-ops-quotation-draft-v1:user-1:workspace%20%2F%20alpha:project-17");
  assert.deepEqual(parseQuotationDraft(JSON.stringify(draft), { workspaceId: input.workspaceId, projectId: input.projectId }, now), draft);
  assert.equal(parseQuotationDraft(JSON.stringify(draft), { workspaceId: "workspace-2", projectId: input.projectId }, now), null);
  assert.equal(parseQuotationDraft("not-json", { workspaceId: input.workspaceId, projectId: input.projectId }, now), null);
  assert.equal(parseQuotationDraft(JSON.stringify(draft), { workspaceId: input.workspaceId, projectId: input.projectId }, now + 8 * 24 * 60 * 60 * 1000), null);
  assert.equal(quotationDraftFingerprint(draft), quotationDraftFingerprint({ ...draft, updatedAt: new Date(now + 1000).toISOString() }));
});

test("Quote Builder preserves unsaved work in the current browser tab", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /quotationDraftKey\(session\.userId, project\.workspaceId, project\.id\)/);
  assert.match(workspace, /parseQuotationDraft\(rawDraft/);
  assert.match(workspace, /window\.sessionStorage\.setItem\(draftStorageKey, JSON\.stringify\(draft\)\)/);
  assert.match(workspace, /window\.sessionStorage\.removeItem\(draftStorageKey\)/);
  assert.match(workspace, /window\.addEventListener\("beforeunload", warnBeforeUnload\)/);
  assert.match(workspace, /작성 중인 내용을 버리고 선택한 견적안을 불러올까요/);
  assert.match(workspace, /작성 중이던 견적을 불러왔습니다/);
  assert.match(workspace, /다른 브라우저에서는 이어서 볼 수 없습니다/);
  assert.match(css, /\.quote-draft-state/);
  assert.match(css, /\.quote-draft-state\.unavailable/);
});

test("workspace presents operational AI metadata in human-readable labels", async () => {
  const workspace = await read("../app/workspace/page.tsx");
  assert.match(workspace, /const eventActivityLabels/);
  assert.match(workspace, /"run\.completed": "분석 완료"/);
  assert.match(workspace, /eventActivityLabels\[event\.type\] \?\? "분석 진행"/);
  assert.match(workspace, /departmentLabels\[result\.department\] \?\? "분석 단계"/);
  assert.match(workspace, /<summary>실행 정보<\/summary>/);
  assert.match(workspace, /costStatusLabels\[costUsage\.costStatus\]/);
  assert.doesNotMatch(workspace, /<span>\{event\.type\}<\/span>/);
});

test("completed AI analysis prepares an editable quotation draft without inventing prices", async () => {
  const [workspace, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(api, /quotationDraft: AgentQuotationDraft \| null/);
  assert.match(workspace, /quotationDraft=\{run\?\.result\?\.quotationDraft \?\? null\}/);
  assert.match(workspace, /function quotationDraftItems\(draft: AgentQuotationDraft, rateCards: RateCard\[\]\)/);
  assert.match(workspace, /unitRate: card\?\.rate \?\? 0/);
  assert.match(workspace, /const activeRateCards = nextRateCards\.filter\(\(card\) => card\.active\)/);
  assert.match(workspace, /const defaultItems = generatedItems \?\? \(latest \? quotationItemsAsInput\(latest\)/);
  assert.match(workspace, /item\.unitRate > 0/);
  assert.match(workspace, /AI가 견적 초안을 채웠습니다/);
  assert.match(workspace, /AI가 정리한 작업과 공수를 확인하세요/);
  assert.match(css, /\.ai-quote-ready/);
  assert.match(css, /\.quote-draft-state\.generated/);
});

test("workspace evidence library exposes the complete document lifecycle", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /KnowledgePanel/);
  assert.match(workspace, /prepareDocumentUpload/);
  assert.match(workspace, /sourceTypeLabel/);
  assert.match(workspace, /다음 AI 분석부터 참고 대상에서 제외됩니다/);
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
  assert.match(workspace, /이미 고객에게 보낸 견적은 그대로 유지됩니다/);
  assert.match(workspace, /structuredOutdated/);
  assert.match(workspace, /요구사항을 다시 확인한 뒤 견적을 작성해 주세요/);
  assert.match(workspace, /setFeatures\(latest\?\.features\.map/);
  assert.match(workspace, /updateProjectDetails/);
  assert.match(api, /interface ProjectInput/);
  assert.match(api, /status: project\.status/);
});

test("transactional forms prevent duplicate submission and keep validation errors in context", async () => {
  const [workspace, proposal, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/proposal/[token]/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /function ProjectDialog/);
  assert.match(workspace, /await onCreate\(/);
  assert.match(workspace, /프로젝트를 만들고 있습니다/);
  assert.match(workspace, /최소 예산은 최대 예산보다 클 수 없습니다/);
  assert.match(workspace, /<fieldset className="dialog-fields" disabled=\{busy\}>/);
  assert.match(workspace, /if \(!canWrite \|\| busy\) return/);
  assert.match(workspace, /const pending = busy \|\| submitting/);
  assert.match(workspace, /if \(pending\) return/);
  assert.match(workspace, /function EstimationPolicyForm[\s\S]*?if \(busy\) return;/);
  assert.match(workspace, /function ModelPricingForm[\s\S]*?if \(busy\) return;/);
  assert.equal([...workspace.matchAll(/<fieldset className="settings-fields" disabled=\{busy\}>/g)].length, 2);
  assert.match(workspace, /<fieldset className="client-fields" disabled=\{busy\}>/);
  assert.match(workspace, /<fieldset className="outcome-fields" disabled=\{busy\}>/);
  assert.match(workspace, /password !== String\(data\.get\("passwordConfirm"\)\)/);
  assert.match(workspace, /비밀번호 확인이 일치하지 않습니다/);
  assert.match(workspace, /aria-label=\{showPassword \? "비밀번호 숨기기" : "비밀번호 표시"\}/);
  assert.match(workspace, /<fieldset className="auth-fields" disabled=\{busy\}>/);
  assert.match(workspace, /const selectMode = \(nextMode: AuthMode\)/);
  assert.match(workspace, /<form className="outcome-form" aria-busy=\{busy\}/);
  assert.match(proposal, /<fieldset className="proposal-response-fields" disabled=\{busy\}>/);
  assert.match(proposal, /응답을 기록하고 있습니다/);
  assert.match(api, /서버에 연결할 수 없습니다\. 네트워크 상태를 확인한 뒤 다시 시도해 주세요/);
  assert.match(css, /\.dialog-fields:disabled/);
  assert.match(css, /\.proposal-response-fields:disabled/);
  assert.match(css, /\.settings-fields/);
  assert.match(css, /\.client-fields, \.outcome-fields/);
  assert.match(css, /\.password-field button:hover, \.password-field button:focus-visible/);
});

test("agent results expose reviewable questions and safe source provenance", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /run\.result\.openQuestions/);
  assert.match(workspace, /아직 확인할 질문/);
  assert.match(workspace, /result\.sources\.length/);
  assert.match(workspace, /검토 가능한 출처/);
  assert.match(workspace, /externalHttpUrl\(source\.url\)/);
  assert.match(workspace, /url\.protocol === "https:" \|\| url\.protocol === "http:"/);
  assert.match(workspace, /rel="noopener noreferrer"/);
  assert.match(workspace, /run\.metadata\.promptVersion/);
  assert.match(workspace, /<details className="department-results">/);
  assert.match(workspace, /분석 단계별 상세/);
  assert.match(css, /\.department-results > summary/);
});

test("quotation revision conflicts preserve the draft and expose explicit recovery choices", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /cause instanceof ApiError && cause\.status === 409/);
  assert.match(workspace, /reloadQuotations\(session, project\.id\)/);
  assert.match(workspace, /작성 중인 내용은 그대로 남아 있습니다/);
  assert.match(workspace, /최신 견적안 불러오기/);
  assert.match(workspace, /현재 내용으로 계속/);
  assert.match(api, /function reloadQuotations/);
});

test("terminal agent runs expose server-accounted cost only to audit readers", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /permissions\.has\("audit\.read"\)/);
  assert.match(workspace, /getAgentRunUsage/);
  assert.match(workspace, /AI 사용 비용/);
  assert.match(workspace, /billableOutcome/);
  assert.match(api, /interface AgentRunUsage/);
  assert.match(api, /\/agent-runs\/\$\{runId\}\/usage/);
});

test("workspace administrators can version the server-owned model price catalog", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /AI 사용 비용/);
  assert.match(workspace, /canReadPricing = permissions\.has\("audit\.read"\)/);
  assert.match(workspace, /canManagePricing = permissions\.has\("workspace\.update"\)/);
  assert.match(workspace, /가격 유효 종료 시점은 시작 시점보다 늦어야 합니다/);
  assert.match(workspace, /createModelPricing/);
  assert.match(api, /interface ModelPricing/);
  assert.match(api, /\/model-pricing/);
});

test("rate cards support the complete server-owned edit and activation lifecycle", async () => {
  const [workspace, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /function RateCardManager/);
  assert.match(workspace, /aria-pressed=\{editorId === card\.id\}/);
  assert.match(workspace, /saveRateCard\(session, selected\.id/);
  assert.match(workspace, /active: !selected\.active/);
  assert.match(workspace, /새 견적에서 이 단가를 숨길까요/);
  assert.match(workspace, /기존 견적에는 유지/);
  assert.match(workspace, /다시 사용/);
  assert.match(workspace, /<fieldset disabled=\{busy\}>/);
  assert.match(workspace, /Number\.isFinite\(rate\)/);
  assert.match(api, /method: "PUT"/);
  assert.match(api, /rate-cards\/\$\{rateCardId\}/);
  assert.match(css, /\.rate-card-list > button\.active/);
  assert.match(css, /\.rate-card-list > button\.inactive/);
});

test("new workspaces enter a server-backed guided setup before the first inquiry", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /onAuthenticated\(session, mode === "register"\)/);
  assert.match(workspace, /if \(isNewWorkspace\) navigateWorkspace\("settings"/);
  assert.match(workspace, /const setupStates = \[Boolean\(workspace\), hasActiveRateCard, Boolean\(policy\), projectCount > 0\]/);
  assert.match(workspace, /role="progressbar"/);
  assert.match(workspace, /서비스 단가 등록/);
  assert.match(workspace, /계산 기준 확인/);
  assert.match(workspace, /첫 문의 등록/);
  assert.match(workspace, /onClick=\{onCreateProject\}/);
  assert.match(workspace, /useGSAP/);
  assert.match(css, /\.onboarding-steps \{[^}]*grid-template-columns: repeat\(4/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.onboarding-steps \{ grid-template-columns: 1fr/);
});

test("project intake compares the current source with the last confirmed revision", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /function requirementTextDelta/);
  assert.match(workspace, /latest\.sourceText\.trim\(\), project\.requirementText\.trim\(\)/);
  assert.match(workspace, /원문과 구조화 결과 비교/);
  assert.match(workspace, /원문 동기화됨/);
  assert.match(workspace, /재검토 필요/);
  assert.match(workspace, /이전 원문에서 빠진 부분/);
  assert.match(workspace, /현재 원문에 추가된 부분/);
  assert.match(workspace, /자동 의미 추정은 검토 완료로 표시하지 않습니다/);
  assert.match(workspace, /<del>\{textDelta\.removed/);
  assert.match(workspace, /<ins>\{textDelta\.added/);
  assert.match(css, /\.requirement-diff-summary \{[^}]*grid-template-columns: repeat\(3/);
  assert.match(css, /\.requirement-source-delta del/);
  assert.match(css, /\.requirement-source-delta ins/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.requirement-diff-summary, \.requirement-diff-map/);
});

test("agent runs request enough model calls for the four-department ReAct route", async () => {
  const api = await read("../app/lib/api.ts");
  assert.match(api, /maxModelCalls: 12/);
});

test("waiting agent runs prioritize a readable collapsible review panel", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /setReviewFocused\(run\?\.status === "WAITING_FOR_USER"\)/);
  assert.match(workspace, /aria-controls="run-execution-graph"/);
  assert.match(workspace, /aria-expanded=\{!reviewFocused\}/);
  assert.match(workspace, /className="graph-panel" hidden=\{reviewFocused\}/);
  assert.match(workspace, /진행 상황 보기/);
  assert.match(css, /\.workbench-grid\.review-focused \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.workbench-grid\.review-focused \.graph-panel \{ display: none/);
  assert.doesNotMatch(css, /\.graph-restore/);
  assert.match(css, /\.interruption-form label \{[^}]*font-size: 1rem/);
  assert.match(css, /\.interruption-form textarea \{[^}]*min-height: 132px/);
});
