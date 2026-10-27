import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { validateVercelEnvironment } from "../scripts/validate-vercel-env.mjs";
import { isActiveStreamStatus, nextStreamCursor, streamReconnectDelay } from "../app/lib/stream-retry.mjs";
import { sessionRefreshDelay } from "../app/lib/session-timing.mjs";
import { buildWorkspacePath, parseWorkspaceLocation } from "../app/lib/workspace-navigation.mjs";
import { createQuotationAIDraftDismissals, createQuotationDraft, parseQuotationAIDraftDismissals, parseQuotationDraft, quotationAIDraftDismissalKey, quotationAIDraftFingerprint, quotationDraftFingerprint, quotationDraftKey } from "../app/lib/quotation-draft.mjs";
import { hydrateMissingDraftRates, selectRateCardForDraftItem } from "../app/lib/rate-card-match.mjs";
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
  assert.match(workspace, /<select\s*value=\{project\.status\}/);
  assert.match(workspace, /ACCEPTED:\s*"고객\s*승인됨"/);
  assert.match(workspace, /interruptionDraftKey\(session\.userId,\s*session\.workspaceId/);
  assert.match(workspace, /await\s*onSubmit\(answers\)/);
  assert.match(workspace, /작성\s*중인\s*답변은\s*이\s*탭에\s*임시\s*저장됩니다/);
  assert.match(css, /\.interruption-actions/);
});

// 경로 파일 하나가 아닌 기능 폴더 전체의 소스를 검사한다.
async function readFeatureTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(entries.map(async (entry) => {
    const location = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return readFeatureTree(location);
    if (!/\.(tsx?|mjs)$/.test(entry.name)) return "";
    return readFile(location, "utf8");
  }));
  return sources.join("\n");
}

async function read(path) {
  const normalizeInterfaceCalls = source => source
    .replace(/=\{t\(("(?:[^"\\]|\\.)*")\)\}/g, '=$1')
    .replace(/\{t\(("(?:[^"\\]|\\.)*")\)\}/g, (_, literal) => JSON.parse(literal))
    .replace(/\bt\(("(?:[^"\\]|\\.)*")\)/g, '$1')
    .replace(/\bt\(([a-zA-Z]+Labels\[[^\]]+\])\)/g, '$1');
  const features = {
    "../app/page.tsx": "../features/home/",
    "../app/lib/api.ts": "../app/lib/api/",
    "../app/workspace/page.tsx": "../features/workspace/",
    "../app/proposal/[token]/page.tsx": "../features/proposal/"
  };
  if (!features[path]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    if (path === "../app/layout.tsx") return source + await readFile(new URL('../app/lib/ui-language.tsx', import.meta.url), 'utf8');
    return normalizeInterfaceCalls(source);
  }
  const source = normalizeInterfaceCalls(await readFeatureTree(new URL(features[path], import.meta.url)));
  // JSX의 배치용 줄바꿈만 무시하고 내용 검사는 유지한다.
  return source.replace(/\r?\n\s*/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/>\s+</g, "><").replace(/>\s+(?=[가-힣])/g, ">").replace(/\s+(?=<)/g, "");
}

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
  assert.equal(packageJson.dependencies.next, "16.3.8");
  assert.equal(packageJson.devDependencies["@next/eslint-plugin-next"], packageJson.dependencies.next);
  const lockedPackages = JSON.parse(lockfile).packages;
  assert.equal(lockedPackages["node_modules/next"].version, packageJson.dependencies.next);
  assert.equal(lockedPackages["node_modules/sharp"].version, "0.35.5");
  assert.equal(lockedPackages["node_modules/source-map-js"].version, "1.2.2");
  assert.equal(vercel.framework, "nextjs");
  assert.equal(vercel.installCommand, "npm ci");
  assert.equal(vercel.buildCommand, "npm run build");
  assert.equal("outputDirectory" in vercel, false);
  assert.match(nextEnv, /reference\s*types="next"/);
  assert.doesNotMatch(packageSource, /vinext|wrangler|@cloudflare|vite|drizzle/);
  assert.doesNotMatch(lockfile, /node_modules\/vinext|node_modules\/wrangler|node_modules\/@cloudflare\/vite-plugin/);
  assert.match(runbook, /Root\s*Directory:\s*`frontend`/);
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
    /NEXT_PUBLIC_API_BASE_URL\s*must\s*be\s*configured/,
  );
  assert.throws(
    () => validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: "http://api.example.invalid" }),
    /must\s*use\s*HTTPS/,
  );
  assert.throws(
    () => validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: "https://api.example.invalid/v2" }),
    /must\s*be\s*an\s*origin/,
  );
  assert.throws(
    () => validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: "https://user:password@api.example.invalid" }),
    /must\s*not\s*contain\s*credentials/,
  );
  assert.throws(
    () => validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: "https://localhost" }),
    /must\s*be\s*publicly\s*reachable/,
  );
  assert.deepEqual(
    validateVercelEnvironment({
      VERCEL: "1",
      VERCEL_URL: "preview.example.invalid",
      NEXT_PUBLIC_API_BASE_URL: "https://api.example.invalid",
    }),
    { apiOrigin: "https://api.example.invalid", siteOrigin: "https://www.freelance-ops.site" },
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
  assert.match(errorBoundary, /오류\s*참조/);
  assert.match(notFound, /Workspace\s*열기/);
  assert.match(proposal, /다시\s*시도/);
  assert.match(proposal, /aria-pressed=/);
  assert.match(workspace, /copyToClipboard/);
  assert.match(workspace, /자동\s*복사가\s*차단되었습니다/);
  assert.match(workspace, /링크\s*복사/);
  assert.match(workspace, /role="tabpanel"/);
  assert.match(workspace, /aria-controls="auth-panel-login"/);
  assert.match(workspace, /event\.key\s*===\s*"ArrowLeft"/);
  assert.match(workspace, /useDialogFocusTrap/);
  assert.match(workspace, /document\.body\.style\.overflow\s*=\s*"hidden"/);
  assert.match(workspace, /previouslyFocused\?\.focus\(\)/);
  assert.match(workspace, /aria-current=/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.skip-link:focus/);
});

test("landing page follows the approved product brief without fabricated social proof", async () => {
  const source = await read("../app/page.tsx");
  assert.match(source, /문의는\s*한마디/);
  assert.match(source, /제안은\s*명확하게/);
  assert.match(source, /AI\s*초안은\s*사용자가\s*검토하고\s*확정합니다/);
  assert.match(source, /하나의\s*흐름으로\s*이어집니다/);
  assert.match(source, /예시\s*일단가/);
  assert.match(source, /사용자\s*검토\s*필요/);
  assert.doesNotMatch(source, /김도윤|박서연|이준호|98%|10배|무제한\s*AI|모든\s*직군|모든\s*국가|자동\s*학습합니다/);
});

test("landing typography keeps Korean display copy within the measured line budget", async () => {
  const [layout, source, css] = await Promise.all([
    read("../app/layout.tsx"),
    read("../app/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(layout, /pretendardvariable-dynamic-subset\.css/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(source, /spatial-hero-title/);
  assert.match(source, /spatial-graph-wires/);
  assert.match(css, /font-synthesis:\s*none/);
  assert.match(css, /word-break:\s*keep-all/);
  assert.match(css, /\.hero-title\s*\{[^}]*clamp\(4\.25rem,\s*4\.7vw,\s*5\.65rem\)/);
  assert.match(css, /\.evidence-copy\s*h2,\s*\.outcome-copy\s*h2\s*\{\s*font-size:\s*clamp\(3\.1rem,\s*3\.6vw,\s*4\.3rem\)/);
  assert.match(css, /\.audience-section\s*\.section-heading\s*h2\s*\{\s*font-size:\s*clamp\(1\.9rem,\s*7\.6vw,\s*2\.2rem\)/);
  assert.match(css, /\.final-cta\s*h2\s*\{\s*font-size:\s*clamp\(2rem,\s*8\.5vw,\s*3\.5rem\)/);
  assert.match(css, /\.accordion-content\s*strong\s*\{[^}]*white-space:\s*normal;\s*word-break:\s*keep-all/);
  assert.doesNotMatch(css, /writing-mode:\s*vertical-rl/);
  assert.match(css, /\.step-visual\s*\{[^}]*grid-template-rows:\s*auto\s*minmax\(82px,\s*1fr\)\s*auto/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /preference\.addEventListener\("change"/);
  assert.match(css, /@keyframes\s*workflowCardPulse/);
  assert.match(css, /@keyframes\s*workflowCoreScan/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?workflow-auto-sequence::after/);
  assert.doesNotMatch(source, /outcome-orbit|cta-light|step-visual-packet|className="orbit"/);
  assert.match(css, /workflowSheen|workflowPulse|workflowSignal/);
});

test("authentication layout keeps the form visible and Korean words intact", async () => {
  const css = await read("../features/workspace/auth/auth.css");
  assert.match(css, /\.auth-layout\s*\{[^}]*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.auth-message\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.auth-message\s*h2\s*\{[^}]*word-break:\s*keep-all/);
  assert.match(css, /@media\s*\(max-width:\s*800px\)[\s\S]*?\.auth-panel\s*\{[^}]*grid-row:\s*1/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\[data-theme="dark"\]\s*\.auth-page/);
});
test("workspace settings and requirement controls remain readable at desktop widths", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(css, /\.pipeline-heading\s*>\s*div\s*\{[^}]*max-width:\s*1050px/);
  assert.match(css, /\.pipeline-heading\s*h1,[\s\S]*?font-size:\s*clamp\(2\.15rem,\s*3\.1vw,\s*3\.55rem\)/);
  assert.match(css, /\.pipeline-heading\s*h1\s*\{[^}]*word-break:\s*keep-all/);
  assert.match(css, /\.pipeline-heading\s*h1\s*\{[^}]*text-wrap:\s*balance/);
  assert.match(css, /\.settings-heading\s*h1,[\s\S]*?font-size:\s*clamp\(2\.15rem,\s*3\.1vw,\s*3\.55rem\)/);
  assert.match(css, /\.settings-heading\s*h1\s*\{[^}]*word-break:\s*keep-all/);
  assert.match(css, /\.settings-heading\s*h1\s*\{[^}]*text-wrap:\s*balance/);
  assert.match(workspace, /aria-label="작업\s*공간\s*설정\s*목차"/);
  assert.match(workspace, /<span>02<\/span>\s*<strong>서비스\s*단가<\/strong>\s*<small>시간·일·고정\s*금액<\/small>/);
  assert.match(workspace, /자주\s*쓰는\s*단가와\s*계산\s*기준을\s*저장해\s*두면\s*새\s*견적을\s*만들\s*때\s*바로\s*불러올\s*수\s*있습니다/);
  assert.doesNotMatch(workspace, /Spring이\s*소유|결정적으로\s*적용|workspace\.update\s*권한이|quotation\.read\s*권한|outcome\.read\s*권한|Java\s*계산\s*도구|서버\s*계산\s*완료|새\s*revision/);
  assert.match(css, /\.settings-grid\s*\{[^}]*grid-template-columns:\s*230px\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.settings-form\s*input,\s*\.settings-form\s*select\s*\{[^}]*min-height:\s*50px/);
  assert.match(css, /\.settings-form\s*input,\s*\.settings-form\s*select\s*\{[^}]*background:\s*var\(--surface-solid\)/);
  assert.match(css, /\.settings-form\s*input:focus,\s*\.settings-form\s*select:focus\s*\{[^}]*border-color:\s*var\(--accent\)/);
  assert.match(css, /\.rate-card-form\s*\.form-row:first-of-type\s*\{[^}]*minmax\(220px,\s*1\.5fr\)/);
  assert.match(css, /\.requirement-editor\s*\.form-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.5fr\)\s*minmax\(180px,\s*0?\.5fr\)/);
  assert.match(css, /\.requirement-editor\s*input,\s*\.requirement-editor\s*select,\s*\.requirement-editor\s*textarea\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.requirement-editor\s*input,\s*\.requirement-editor\s*select\s*\{[^}]*min-height:\s*46px/);
  assert.match(css, /\.requirement-editor\s*textarea\s*\{[^}]*min-height:\s*92px/);
  assert.match(workspace, /const\s*configuredModelOptions:\s*Record<Provider,\s*string\[]>/);
  assert.match(workspace, /<label[^>]*>\s*AI\s*모델<select[^>]*value=\{model\}/);
  assert.doesNotMatch(workspace, /<label>Model<input/);
  assert.match(workspace, /name="currency"\s*value=\{draft.currency\}/);
  assert.match(css, /--workspace-radius-lg:\s*22px/);
  assert.match(css, /\.settings-content\s*>\s*section\s*\{[^}]*border:\s*0;[^}]*background:\s*color-mix/);
  assert.match(css, /\.run-controls\s*\{[^}]*border-radius:\s*var\(--workspace-radius-md\)/);
  assert.match(css, /\.budget-range\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto\s*minmax\(0,\s*1fr\)/);
});

test("workspace interaction states use neutral focus and selection without neon halos", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /색상은 상태 구분에 사용/);
  assert.match(css, /input:focus-visible[\s\S]*outline:\s*2px\s*solid\s*color-mix\(in\s*srgb,\s*var\(--ink\)/);
  assert.match(css, /\.settings-content\s*>\s*section:target\s*\{[^}]*outline:\s*1px\s*solid[^}]*box-shadow:\s*var\(--shadow\)/);
  assert.match(css, /\.rate-card-list\s*>\s*button\.active,[\s\S]*\.quote-item-block\.selected,[\s\S]*box-shadow:\s*none/);
  assert.match(css, /\.graph-panel\s*\.workflow-node\.active\s*\.workflow-node-icon,[\s\S]*box-shadow:\s*none/);
  assert.match(css, /\.accordion-slice\.active\s*\{[^}]*background:\s*var\(--surface-2\);[^}]*box-shadow:\s*none/);
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
  assert.match(workspace, /PetConversationMessages/);
  assert.match(graph, /role="progressbar"/);
  assert.match(graph, /statusCopy\[snapshot\.status\]/);
  assert.match(graph, /workflow-track-progress/);
  assert.match(graph, /확인\s*필요/);
  assert.match(graph, /routeNodes/);
  assert.match(graph, /skippedNodes/);
  assert.match(graph, /해당\s*없음/);
  assert.match(css, /\.workflow-node\.skipped/);
  assert.match(css, /\.workflow-track\.moving\s*\.workflow-track-progress::after/);
  assert.match(css, /@keyframes\s*workflowTrackSignal/);
  assert.doesNotMatch(graph, /workflow-link/);
  assert.doesNotMatch(graph, /node-orbit|signal-bars/);
  assert.match(workspace, /route\.selected/);
  assert.match(workspace, /Tool\s*사용/);
  assert.match(workspace, /reasonCodes/);
  assert.match(workspace, /decisionSource/);
  assert.match(workspace, /PROJECT_ANALYSIS_FULL_WORKFLOW/);
  assert.match(workspace, /evaluatorSuggestedRoute/);
  assert.match(api, /maxDepartments:\s*4/);
  assert.match(workspace, /toolName/);
  assert.match(css, /\.event-activity-route/);
  assert.match(css, /\.event-activity-tool/);
  assert.match(api, /NEXT_PUBLIC_API_BASE_URL/);
  assert.match(api, /\/api\/v2\/workspaces/);
  assert.doesNotMatch(api, /localhost:8000|\/internal\/v1/);
  assert.match(graph, /tool\.started/);
  assert.match(graph, /quotation\.draft\.created/);
  assert.match(graph, /run\.completed/);
  assert.match(graph, /function\s*recordedCompletedNodes\(events:\s*WorkflowEvent\[\]\)/);
  assert.match(graph, /expectedNodes\.find\(\(node\)\s*=>\s*!eventCompletedNodes\.includes\(node\)\)/);
  assert.match(workspace, /REACT_TOOL_CALL_INVALID:\s*"AI\s*응답\s*형식을\s*자동으로\s*다시\s*확인했지만/);
  assert.match(workspace, /runFailureMessage\(view\?\.errorCode\s*\?\?\s*null\)/);
});

test("Agent SSE reconnects from the last durable event with bounded backoff", async () => {
  const [workspace, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(api, /headers\.set\("Last-Event-ID",\s*String\(lastEventId\)\)/);
  assert.match(api, /contentType\.includes\("text\/event-stream"\)/);
  assert.match(api, /onConnected\?\.\(\)/);
  assert.match(workspace, /lastEventIdRef\.current\s*=\s*nextStreamCursor/);
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
  assert.match(workspace, /재연결\s*중/);
  assert.match(css, /workspace-live-status\s*span\.reconnecting/);
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
  assert.equal(buildWorkspacePath({ view: "pipeline" }), "/workspace/projects");
  assert.equal(
    buildWorkspacePath({ view: "project", projectId: "project-17", step: "quote" }),
    "/workspace/projects/project-17/quote",
  );
  assert.match(workspace, /\[pathname,\s*loadedWorkspaceId,\s*activePermissions,\s*applyWorkspaceLocation,\s*projects,\s*session\]/);
  assert.match(workspace, /router\.replace\(/);
  assert.match(workspace, /permissions\.has\("client\.read"\)/);
  assert.match(workspace, /permissions\.has\("document\.read"\)/);
  assert.match(workspace, /projectResult\.find\(\(item\)\s*=>\s*item\.id\s*===\s*location\.projectId\)/);
  assert.match(workspace, /selectedProjectIdRef\.current\s*!==\s*project\.id/);
  assert.doesNotMatch(workspace, /aria-label="프로젝트\s*바로가기"/);
  assert.doesNotMatch(workspace, /aria-label="프로젝트\s*목록"/);
  assert.match(workspace, /className="pipeline-list-open"\s*onClick=\{\(\)\s*=>\s*onSelect\(project\)\}/);
  assert.match(workspace, /aria-label="프로젝트\s*검색"/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.workspace-sidebar\s*nav\s*\{\s*display:\s*none;\s*\}/);
});

test("responsive and reduced-motion gates cover the documented breakpoints", async () => {
  const [page, css] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(css, /@media\s*\(min-width:\s*1181px\)\s*and\s*\(max-width:\s*1440px\)/);
  assert.match(css, /\.hero-title\s*\{\s*font-size:\s*clamp\(3\.4rem,\s*5\.1vw,\s*5rem\);\s*\}/);
  assert.match(css, /@media\s*\(max-width:\s*1180px\)/);
  assert.match(css, /@media\s*\(max-width:\s*820px\)/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /grid-auto-flow:\s*dense/);
  assert.match(css, /\.hero-title\s*\{\s*font-size:\s*clamp\(2\.8rem,\s*12vw,\s*4\.2rem\);\s*\}/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.accordion-content\s*strong\s*\{[^}]*word-break:\s*keep-all/);
  assert.doesNotMatch(css, /writing-mode:\s*vertical-rl/);
  assert.match(css, /scroll-padding-top:\s*112px/);
  assert.match(page, /제품\s*예시\s*단계\s*선택/);
  assert.match(page, /aria-controls="workflow-example"/);
});

test("landing color tokens and section grids keep light and dark hierarchy consistent", async () => {
  const css = await read("../app/globals.css");
  assert.match(css, /--accent-card-bg:\s*#242426/);
  assert.match(css, /--bg:\s*#0b0f17/);
  assert.match(css, /--surface-solid:\s*#141a26/);
  assert.match(css, /--muted:\s*#b7c0ce/);
  assert.match(css, /--accent-card-bg:\s*#151b2b/);
  assert.match(css, /\.deliverables-section,[\s\S]*?grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.deliverable-card\.featured\s*\{[^}]*background:\s*var\(--accent-card-bg\)/);
  assert.match(css, /\.outcome-card\s*\{[^}]*background:\s*var\(--accent-card-bg\)/);
  assert.match(css, /\.final-cta\s*\{[^}]*background:\s*var\(--cta-bg\)/);
  assert.doesNotMatch(css, /\[data-theme="dark"\]\s*\.deliverable-card\.featured/);
});

test("manual quotation, evidence, outcome, and public proposal flows use real Spring contracts", async () => {
  const [workspace, api, proposal, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/proposal/[token]/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /createQuotation/);
  assert.match(workspace, /basis\.content/);
  assert.match(workspace, /sourceReference:\s*event\.target\.value/);
  assert.match(workspace, /근거는\s*출처\s*유형과\s*참조가\s*필수입니다/);
  assert.match(workspace, /evidence-inspector/);
  assert.match(workspace, /aria-label="서비스\s*단가표"/);
  assert.match(workspace, /rateCardId:\s*card\.id/);
  assert.match(workspace, /aria-label="견적\s*시나리오\s*비교"/);
  assert.match(workspace, /className="quote-field-label">수량/);
  assert.match(workspace, /className="quote-field-label">단위/);
  assert.match(workspace, /className="quote-field-label">단가/);
  assert.match(workspace, /formatMoney\(preview\.items\[index\]\.total, project\.currency\)/);
  assert.match(workspace, /latestByScenario/);
  assert.match(workspace, /loadQuotation\(quotation\)/);
  assert.match(workspace, /saveOutcome/);
  assert.match(workspace, /reviseQuotation/);
  assert.match(workspace, /사용자\s*확정\s*revision\s*저장/);
  assert.match(api, /\/quotations\/\$\{quotationId\}\/publish/);
  assert.match(api, /\/quotations\/\$\{quotationId\}\/revisions/);
  assert.match(api, /\/proposal-shares\/\$\{shareId\}/);
  assert.match(api, /\/projects\/\$\{projectId\}\/outcome/);
  assert.match(proposal, /submitProposalDecision/);
  assert.match(proposal, /CHANGES_REQUESTED/);
  assert.match(proposal, /window\.print/);
  assert.match(workspace, /링크\s*비활성화/);
  assert.match(css, /\.quote-item-block\s*\{[^}]*border-radius:\s*12px/);
  assert.match(css, /\.quote-row\s*input,[\s\S]*?background:\s*var\(--surface-2\)/);
  assert.match(css, /\.quote-row\s*\{[^}]*grid-template-columns:\s*minmax\(220px,\s*1\.8fr\)/);
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
  assert.match(workspace, /항목별\s*실제\s*결과/);
  assert.match(workspace, /예상\s*대비\s*오차/);
  assert.match(workspace, /revenueVariance/);
  assert.match(workspace, /hoursVariance/);
  assert.match(workspace, /refreshAuthSession/);
  assert.match(api, /method:\s*"PATCH"/);
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
  assert.match(workspace, /기존\s*프로젝트\s*연결은\s*유지됩니다/);
  assert.match(api, /clients:\$\{session\.workspaceId\}/);
  assert.match(api, /\/clients\/\$\{clientId\}/);
  assert.match(api, /clientId:\s*string\s*\|\s*null/);
  assert.match(workspace, /function\s*projectClientLabel\(project:\s*Project,\s*clients:\s*Client\[\],\s*translate:/);
  assert.match(workspace, /client\.companyName\s*\?\s*`\$\{client\.companyName\}\s*·\s*\$\{client\.name\}`\s*:\s*client\.name/);
  assert.match(workspace, /className="pipeline-card-client"/);
  assert.doesNotMatch(workspace, /className="sidebar-project-client"/);
  assert.match(workspace, /className="project-client"/);
  assert.match(workspace, /projectClientLabel\(project,\s*clients,\s*t\)/);
});

test("workspace switching and agent cancellation preserve recoverable operator control", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /profile\.workspaces\.length\s*>\s*1/);
  assert.match(workspace, /onSwitchWorkspace\(event\.target\.value\)/);
  assert.match(workspace, /permissions\.has\("project\.read"\)/);
  assert.match(workspace, /activePermissions\.has\("client\.read"\)/);
  assert.match(workspace, /permissions\.has\("document\.delete"\)/);
  assert.match(workspace, /cancelAgentRun/);
  assert.match(workspace, /새\s*분석\s*준비/);
  assert.match(workspace, /저장된\s*프로젝트와\s*이전\s*결과는\s*변경되지\s*않습니다/);
  assert.match(api, /\/agent-runs\/\$\{runId\}\/cancel/);
});

test("expired access tokens use one coordinated refresh and retry the original Spring request", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(api, /let\s*refreshPromise:\s*Promise<AuthSession>\s*\|\s*null\s*=\s*null/);
  assert.match(api, /response\.status\s*===\s*401\s*&&\s*token\s*&&\s*allowSessionRecovery/);
  assert.match(api, /return\s*request<T>\(path,\s*init,\s*recovered\.accessToken,\s*false\)/);
  assert.match(api, /refreshTokenExpiresAt/);
  assert.match(api, /SESSION_RECOVERY_EVENT/);
  assert.match(workspace, /subscribeToSessionRecovery/);
  assert.match(workspace, /로그인\s*시간이\s*만료되었습니다\.\s*다시\s*로그인해\s*주세요/);
});

test("session refresh scheduling stays inside the browser timer range", async () => {
  const workspace = await read("../app/workspace/page.tsx");
  const now = Date.parse("2026-08-14T00:00:00Z");
  assert.equal(sessionRefreshDelay("2026-08-14T00:10:00Z", now), 540_000);
  assert.equal(sessionRefreshDelay("2026-08-14T00:00:10Z", now), 1_000);
  assert.equal(sessionRefreshDelay("2099-01-01T00:00:00Z", now), 2_147_000_000);
  assert.equal(sessionRefreshDelay("not-a-date", now), 1_000);
  assert.match(workspace, /sessionRefreshDelay\(session\.accessTokenExpiresAt\)/);
  assert.doesNotMatch(workspace, /Math\.max\(1_000,\s*refreshAt\)/);
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
  assert.match(workspace, /quotationDraftKey\(session\.userId,\s*project\.workspaceId,\s*project\.id\)/);
  assert.match(workspace, /parseQuotationDraft\(rawDraft/);
  assert.match(workspace, /window\.sessionStorage\.setItem\(draftStorageKey,\s*JSON\.stringify\(draft\)\)/);
  assert.match(workspace, /window\.sessionStorage\.removeItem\(draftStorageKey\)/);
  assert.match(workspace, /window\.addEventListener\("beforeunload",\s*warnBeforeUnload\)/);
  assert.match(workspace, /작성\s*중인\s*내용을\s*버리고\s*선택한\s*견적안을\s*불러올까요/);
  assert.match(workspace, /작성\s*중이던\s*견적을\s*불러왔습니다/);
  assert.match(workspace, /다른\s*브라우저에서는\s*이어서\s*볼\s*수\s*없습니다/);
  assert.match(css, /\.quote-draft-state/);
  assert.match(css, /\.quote-draft-state\.unavailable/);
});

test("a discarded AI quotation scenario stays hidden only for the same generated content", async () => {
  const draft = {
    scenario: "RECOMMENDED",
    items: [{ title: "API 구현", description: "", quantity: 2, unit: "DAY", rateCardHint: "백엔드 개발", basis: { type: "ASSUMPTION", content: "범위 확정" } }],
  };
  const fingerprint = quotationAIDraftFingerprint(draft);
  const stored = createQuotationAIDraftDismissals([fingerprint, fingerprint]);

  assert.equal(quotationAIDraftDismissalKey("user-1", "workspace / alpha", "project-17"), "freelance-ops-quotation-ai-draft-dismissals-v1:user-1:workspace%20%2F%20alpha:project-17");
  assert.deepEqual(parseQuotationAIDraftDismissals(JSON.stringify(stored)), [fingerprint]);
  assert.notEqual(quotationAIDraftFingerprint({ ...draft, items: [{ ...draft.items[0], quantity: 3 }] }), fingerprint);
  assert.deepEqual(parseQuotationAIDraftDismissals("not-json"), []);

  const workspace = await read("../app/workspace/page.tsx");
  assert.match(workspace, /AI\s*\{quotationScenarioLabels\[scenario\]\}\s*버리기/);
  assert.match(workspace, /저장된\s*견적과\s*다른\s*견적안은\s*그대로\s*유지됩니다/);
  assert.match(workspace, /초안\s*폐기됨/);
  assert.match(workspace, /새\s*분석에서\s*다시\s*생성됩니다/);
});

test("workspace presents operational AI metadata in human-readable labels", async () => {
  const workspace = await read("../app/workspace/page.tsx");
  assert.match(workspace, /const\s*eventActivityLabels/);
  assert.match(workspace, /"run\.completed":\s*"분석\s*완료"/);
  assert.match(workspace, /eventActivityLabels\[event\.type\]\s*\?\?\s*"분석\s*진행"/);
  assert.match(workspace, /departmentLabels\[result\.department\]\s*\?\?\s*"분석\s*단계"/);
  assert.match(workspace, /<summary>실행\s*정보<\/summary>/);
  assert.match(workspace, /costStatusLabels\[costUsage\.costStatus\]/);
  assert.doesNotMatch(workspace, /<span>\s*\{event\.type\}\s*<\/span>/);
});

test("completed AI analysis prices its editable draft from active server rate cards", async () => {
  const [workspace, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(api, /quotationDraft:\s*AgentQuotationDraft\s*\|\s*null/);
  assert.match(api, /quotationDrafts:\s*AgentQuotationDraft\[\]/);
  assert.match(workspace, /quotationDrafts=\{conversation.view\?\.settings.acceptedDraft/);
  assert.match(workspace, /function\s*quotationDraftItems\(draft:\s*AgentQuotationDraft,\s*rateCards:\s*RateCard\[\],\s*currency:\s*string\)/);
  assert.match(workspace, /핵심·권장·확장\s*3개\s*견적안을\s*준비했습니다/);
  assert.match(workspace, /aiDraftByScenario/);
  assert.match(workspace, /AI\s*초안\s*·\s*\{generated\.items\.length\}\s*개\s*작업/);
  assert.match(workspace, /selectRateCardForDraftItem\(item,\s*rateCards,\s*currency\)/);
  assert.match(workspace, /hydrateMissingDraftRates\(restored\.items,\s*restoredGeneratedItems\)/);
  assert.match(workspace, /const\s*activeRateCards\s*=\s*nextRateCards\.filter\(\(card\)\s*=>\s*card\.active\)/);
  assert.match(workspace, /const\s*defaultItems\s*=\s*generatedItems\s*\?\?\s*\(latest\s*\?\s*quotationItemsAsInput\(latest\)/);
  assert.match(workspace, /item\.unitRate\s*>\s*0/);
  assert.match(workspace, /AI가\s*견적\s*초안을\s*채웠습니다/);
  assert.match(workspace, /견적\s*초안\s*검토/);
  assert.match(css, /\.ai-quote-ready/);
  assert.match(css, /\.quote-draft-state\.generated/);
  assert.match(css, /\.quote-select-control\s*select/);
  assert.match(css, /\.basis-copy\s*textarea/);
});

test("rate-card matching deterministically fills generated and restored zero-price items", () => {
  const cards = [
    { id: "day-general", name: "일반 개발", unit: "DAY", rate: 400000, currency: "KRW", active: true },
    { id: "day-backend", name: "백엔드 개발", unit: "DAY", rate: 550000, currency: "KRW", active: true },
    { id: "hour-backend", name: "백엔드 개발", unit: "HOUR", rate: 80000, currency: "KRW", active: true },
  ];
  const item = { title: "API 구현", description: "인증 API를 개발합니다.", quantity: 2, unit: "DAY", rateCardHint: "백엔드 개발" };
  assert.equal(selectRateCardForDraftItem(item, cards, "KRW")?.id, "day-backend");
  assert.equal(selectRateCardForDraftItem({ ...item, rateCardHint: null, title: "기타 작업", description: "" }, cards, "KRW")?.id, "day-general");
  assert.equal(selectRateCardForDraftItem(item, cards, "USD"), null);

  const restored = [{ rateCardId: null, title: "API 구현", description: "", quantity: 2, unit: "DAY", unitRate: 0, discountRate: 0, basis: { type: "ASSUMPTION", content: "사양 확정", sourceType: null, sourceReference: null, sourceTitle: null, retrievedAt: null } }];
  const generated = [{ ...restored[0], rateCardId: "day-backend", unitRate: 550000 }];
  assert.deepEqual(hydrateMissingDraftRates(restored, generated), generated);
});

test("workspace evidence library exposes the complete document lifecycle", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /KnowledgePanel/);
  assert.match(workspace, /prepareDocumentUpload/);
  assert.match(workspace, /sourceTypeLabel/);
  assert.match(workspace, /다음\s*AI\s*분석부터\s*참고\s*대상에서\s*제외됩니다/);
  assert.match(workspace, /detail\.chunks\.map/);
  assert.match(workspace, /detail\.sourceMessages\.map/);
  assert.match(workspace, /disabled=\{busy\s*\|\|\s*!reviewed\}/);
  assert.match(api, /function\s*confirmDocument/);
  assert.match(api, /function\s*getDocument/);
  assert.match(api, /function\s*archiveDocument/);
  assert.match(api, /method:\s*"DELETE"/);
});

test("project details remain editable after intake without mutating quotation revisions", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /ProjectEditDialog/);
  assert.match(workspace, /프로젝트\s*정보\s*수정/);
  assert.match(workspace, /최소\s*예산은\s*최대\s*예산보다\s*클\s*수\s*없습니다/);
  assert.match(workspace, /이미\s*고객에게\s*보낸\s*견적은\s*그대로\s*유지됩니다/);
  assert.match(workspace, /structuredOutdated/);
  assert.match(workspace, /요구사항을\s*다시\s*확인한\s*뒤\s*견적을\s*작성해\s*주세요/);
  assert.match(workspace, /setFeatures\(latest\?\.features\.map/);
  assert.match(workspace, /updateProjectDetails/);
  assert.match(api, /interface\s*ProjectInput/);
  assert.match(api, /status:\s*project\.status/);
});

test("transactional forms prevent duplicate submission and keep validation errors in context", async () => {
  const [workspace, proposal, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/proposal/[token]/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /function\s*ProjectDialog/);
  assert.match(workspace, /await\s*onCreate\(/);
  assert.match(workspace, /프로젝트를\s*만들고\s*있습니다/);
  assert.match(workspace, /최소\s*예산은\s*최대\s*예산보다\s*클\s*수\s*없습니다/);
  assert.match(workspace, /<fieldset\s*className="dialog-fields"\s*disabled=\{busy\}>/);
  assert.match(workspace, /if\s*\(!canWrite\s*\|\|\s*busy\s*\|\|\s*draftConflict\)\s*return/);
  assert.match(workspace, /const\s*pending\s*=\s*busy\s*\|\|\s*submitting/);
  assert.match(workspace, /if\s*\(pending\s*\|\|\s*submitLock\.current\s*\|\|\s*!canRespond/);
  const policyForm = await read("../features/workspace/settings/estimation-policy-form.tsx");
  assert.match(policyForm, /if\s*\(busy\s*\|\|\s*pending\.current\)\s*return;/);
  assert.match(policyForm, /<fieldset\s*className="settings-fields"\s*disabled=\{busy\}>/);
  assert.match(workspace, /<fieldset\s*className="client-fields"\s*disabled=\{busy\s*\|\|\s*!draftsReady\}>/);
  assert.match(workspace, /<fieldset\s*className="outcome-fields"\s*disabled=\{busy\}>/);
  assert.match(workspace, /password\s*!==\s*String\(data\.get\("passwordConfirm"\)\)/);
  assert.match(workspace, /비밀번호\s*확인이\s*일치하지\s*않습니다/);
  assert.match(workspace, /aria-label=\{showPassword\s*\?\s*"비밀번호\s*숨기기"\s*:\s*"비밀번호\s*표시"\}/);
  assert.match(workspace, /<fieldset\s*className="auth-fields"\s*disabled=\{busy\}>/);
  assert.match(workspace, /const\s*selectMode\s*=\s*\(nextMode:\s*AuthMode\)/);
  assert.match(workspace, /<form\s*className="outcome-form"\s*aria-busy=\{busy\}/);
  assert.match(proposal, /<fieldset\s*className="proposal-response-fields"\s*disabled=\{busy\s*\|\|\s*responseRecorded\}>/);
  assert.match(proposal, /응답을\s*기록하고\s*있습니다/);
  assert.match(api, /서버에\s*연결할\s*수\s*없습니다\.\s*네트워크\s*상태를\s*확인한\s*뒤\s*다시\s*시도해\s*주세요/);
  assert.match(css, /\.dialog-fields:disabled/);
  assert.match(css, /\.proposal-response-fields:disabled/);
  assert.match(css, /\.settings-fields/);
  assert.match(css, /\.client-fields,\s*\.outcome-fields/);
  assert.match(await read("../features/workspace/auth/auth.css"), /\.auth-page\s*:focus-visible/);
});

test("agent results expose reviewable questions and safe source provenance", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /run\.result\.openQuestions/);
  assert.match(workspace, /아직\s*확인할\s*질문/);
  assert.match(workspace, /result\.sources\.length/);
  assert.match(workspace, /검토\s*가능한\s*출처/);
  assert.match(workspace, /externalHttpUrl\(source\.url\)/);
  assert.match(workspace, /url\.protocol\s*===\s*"https:"\s*\|\|\s*url\.protocol\s*===\s*"http:"/);
  assert.match(workspace, /rel="noopener\s*noreferrer"/);
  assert.match(workspace, /run\.metadata\.promptVersion/);
  assert.match(workspace, /<details\s*className="department-results">/);
  assert.match(workspace, /분석\s*단계별\s*상세/);
  assert.match(css, /\.department-results\s*>\s*summary/);
});

test("quotation revision conflicts preserve the draft and expose explicit recovery choices", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /cause\s*instanceof\s*ApiError\s*&&\s*cause\.status\s*===\s*409/);
  assert.match(workspace, /getLatestQuotation\(session,\s*saved\.id\)/);
  assert.match(workspace, /작성\s*중인\s*내용은\s*그대로\s*남아\s*있습니다/);
  assert.match(workspace, /최신\s*견적안\s*불러오기/);
  assert.match(workspace, /현재\s*내용으로\s*계속/);
  assert.match(api, /function\s*getLatestQuotation/);
});

test("terminal agent runs expose server-accounted cost only to audit readers", async () => {
  const [workspace, api] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
  ]);
  assert.match(workspace, /permissions\.has\("audit\.read"\)/);
  assert.match(workspace, /getAgentRunUsage/);
  assert.match(workspace, /예상\s*AI\s*비용/);
  assert.match(workspace, /billableOutcome/);
  assert.match(api, /interface\s*AgentRunUsage/);
  assert.match(api, /\/agent-runs\/\$\{runId\}\/usage/);
});

test("settings offer personal AI connections without obsolete model-price editing", async () => {
  const [workspace, api, ledger] = await Promise.all([
    read("../features/workspace/settings/settings-panel.tsx"),
    read("../app/lib/api.ts"),
    read("../app/lib/admin-members-api.ts"),
  ]);
  assert.match(workspace, /AI\s*연결/);
  assert.match(workspace, /canConnectAI\s*=\s*permissions\.has\("agent\.run"\)/);
  assert.doesNotMatch(workspace, /ModelPricingForm|listModelPricing|AI\s*사용\s*비용/);
  assert.doesNotMatch(api, /interface\s*ModelPricing/);
  assert.doesNotMatch(api, /\/model-pricing/);
  assert.match(ledger, /platformCostUsd/);
  assert.match(ledger, /\/ai-usage\/history/);
});

test("rate cards support the complete server-owned edit and activation lifecycle", async () => {
  const [workspace, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /function\s*RateCardManager/);
  assert.match(workspace, /aria-pressed=\{editorId\s*===\s*card\.id\}/);
  assert.match(workspace, /saveRateCard\(session,\s*selected\.id/);
  assert.match(workspace, /active:\s*!selected\.active/);
  assert.match(workspace, /새\s*견적에서\s*이\s*단가를\s*숨길까요/);
  assert.match(workspace, /기존\s*견적에는\s*유지/);
  assert.match(workspace, /다시\s*사용/);
  assert.match(workspace, /<fieldset\s*disabled=\{busy\}>/);
  assert.match(workspace, /Number\.isFinite\(rate\)/);
  assert.match(api, /method:\s*"PUT"/);
  assert.match(api, /rate-cards\/\$\{rateCardId\}/);
  assert.match(css, /\.rate-card-list\s*>\s*button\.active/);
  assert.match(css, /\.rate-card-list\s*>\s*button\.inactive/);
});

test("new workspaces enter a server-backed guided setup before the first inquiry", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /onAuthenticated\(session,\s*mode\s*===\s*"register"\)/);
  assert.match(workspace, /if\s*\(isNewWorkspace\)\s*navigateWorkspace\("settings"/);
  assert.match(workspace, /const\s*setupStates\s*=\s*\[Boolean\(workspace\),\s*hasActiveRateCard,\s*Boolean\(policy\),\s*projectCount\s*>\s*0\]/);
  assert.match(workspace, /role="progressbar"/);
  assert.match(workspace, /서비스\s*단가\s*등록/);
  assert.match(workspace, /계산\s*기준\s*확인/);
  assert.match(workspace, /첫\s*문의\s*등록/);
  assert.match(workspace, /onClick=\{onCreateProject\}/);
  assert.match(workspace, /useGSAP/);
  assert.match(css, /\.onboarding-steps\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*?\.onboarding-steps\s*\{\s*grid-template-columns:\s*1fr/);
});

test("settings hides raw RBAC diagnostics and keeps supporting text readable", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.doesNotMatch(workspace, /내\s*접근\s*범위/);
  assert.doesNotMatch(workspace, /formatPermissionLabel/);
  assert.match(css, /\.workspace-sidebar\s*nav\s*small,[\s\S]*?font-size:\s*0?\.82rem/);
  assert.match(css, /\.onboarding-step\s*p\s*\{\s*font-size:\s*0?\.84rem/);
  assert.match(css, /\.settings-index\s*a\s*>\s*small\s*\{\s*font-size:\s*0?\.82rem/);
  assert.match(css, /\.settings-content\s*dt\s*\{\s*font-size:\s*0?\.82rem/);
  assert.match(css, /\.settings-form\s*input,[\s\S]*?font-size:\s*1rem/);
});

test("project intake compares the current source with the last confirmed revision", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /function\s*requirementTextDelta/);
  assert.match(workspace, /latest\.sourceText\.trim\(\),\s*project\.requirementText\.trim\(\)/);
  assert.match(workspace, /원문과\s*구조화\s*결과\s*비교/);
  assert.match(workspace, /원문\s*동기화됨/);
  assert.match(workspace, /재검토\s*필요/);
  assert.match(workspace, /이전\s*원문에서\s*빠진\s*부분/);
  assert.match(workspace, /현재\s*원문에\s*추가된\s*부분/);
  assert.match(workspace, /자동\s*의미\s*추정은\s*검토\s*완료로\s*표시하지\s*않습니다/);
  assert.match(workspace, /<del>\s*\{textDelta\.removed/);
  assert.match(workspace, /<ins>\s*\{textDelta\.added/);
  assert.match(css, /\.requirement-diff-summary\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  assert.match(css, /\.requirement-source-delta\s*del/);
  assert.match(css, /\.requirement-source-delta\s*ins/);
  assert.match(css, /@media\s*\(max-width:\s*820px\)[\s\S]*?\.requirement-diff-summary,\s*\.requirement-diff-map/);
});

test("agent runs request enough model calls and output tokens for the four-department ReAct route", async () => {
  const [api, workspace, workflow] = await Promise.all([
    read("../app/lib/api.ts"),
    read("../app/workspace/page.tsx"),
    read("../app/components/live-workflow.tsx"),
  ]);
  assert.match(api, /maxModelCalls:\s*50/);
  assert.match(api, /maxOutputTokens:\s*48000/);
  assert.match(api, /\|\s*"PARTIAL"/);
  assert.match(workspace, /일부\s*분석\s*결과를\s*먼저\s*제공합니다/);
  assert.match(workspace, /run\.status\s*===\s*"PARTIAL"/);
  assert.match(workflow, /"run\.partial":\s*"review"/);
  assert.match(workflow, /PARTIAL:\s*"부분\s*결과\s*제공"/);
});

test("waiting agent runs prioritize inline questions and fold execution history", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /status\s*===\s*"WAITING_FOR_USER"\s*&&\s*item\.runId\s*===\s*runId\s*\?\s*\(?\s*clarification/);
  assert.match(workspace, /clarification=\{\s*run\?\.interruption\s*\?\s*\(?\s*<InterruptionForm/);
  assert.match(workspace, /<details className="pet-conversation-history">/);
  assert.doesNotMatch(workspace, /showWorkDetails/);
  assert.match(workspace, /onOpenResult=\{openResult\}/);
  assert.doesNotMatch(css, /\.graph-restore/);
  assert.match(css, /\.interruption-form\s*label\s*\{[^}]*font-size:\s*1rem/);
  assert.match(css, /\.interruption-form\s*textarea\s*\{[^}]*min-height:\s*132px/);
});

test("workspace supports persistent theme switching and guarded project deletion", async () => {
  const [workspace, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /useTheme/);
  assert.match(workspace, /setTheme\(isDarkTheme\s*\?\s*"light"\s*:\s*"dark"\)/);
  assert.match(workspace, /role="switch"\s*aria-checked=\{isDarkTheme\}\s*aria-label="다크\s*모드"/);
  assert.match(workspace, /permissions\.has\("project\.delete"\)/);
  assert.match(workspace, /deleteConfirmation\s*!==\s*project\.title/);
  assert.doesNotMatch(workspace, /AI\s*분석을\s*중단한\s*뒤\s*삭제할\s*수\s*있습니다/);
  assert.match(
    workspace,
    /진행\s*중이거나\s*확인\s*대기\s*중인\s*AI\s*분석은\s*먼저\s*안전하게\s*중단합니다/
  );
  assert.match(workspace, /projectDeletionBlockingStatuses\s*=\s*new\s*Set\(\["QUEUED",\s*"RUNNING",\s*"WAITING_FOR_USER"\]\)/);
  assert.match(workspace, /getLatestProjectAgentRun\(session,\s*projectId\)/);
  assert.match(workspace, /await\s*deleteProject\(session,\s*selectedProject\.id\)/);
  assert.doesNotMatch(workspace, /disabled=\{runLookupPending\s*\|\|\s*deleteBlockedByRun\}/);
  assert.match(workspace, /진행\s*중이거나\s*확인을\s*기다리는\s*AI\s*분석이\s*있습니다/);
  assert.match(workspace, /className="project-delete-backdrop"/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /정리된\s*요구사항/);
  assert.match(workspace, /AI\s*분석\s*기록/);
  assert.match(workspace, /견적과\s*결과\s*기록/);
  assert.match(api, /export\s*function\s*deleteProject/);
  assert.doesNotMatch(api, /deleteProjectWithBestEffortRunCleanup/);
  assert.doesNotMatch(api, /Project\s*deletion\s*must\s*not\s*depend\s*on\s*Agent\s*availability/);
  assert.match(api, /export\s*function\s*getLatestProjectAgentRun/);
  assert.doesNotMatch(api, /cancelActiveProjectAgentRuns/);
  assert.match(api, /projects\/\$\{projectId\}\/agent-runs\/latest/);
  assert.doesNotMatch(api, /projects\/\$\{projectId\}\/agent-runs\/cancel-active/);
  assert.match(api, /method:\s*"DELETE"/);
  assert.match(css, /\.project-delete-confirmation/);
  assert.match(css, /@keyframes\s*deleteDialogIn/);
  assert.match(css, /@keyframes\s*workspacePanelIn/);
  assert.match(css, /\.workbench-steps\s*button\.active\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /\.workspace-theme-toggle/);
});

test("quotation review preserves calculated amounts while standalone AI drafting stays disabled", async () => {
  const [workspace, api, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/lib/api.ts"),
    read("../app/globals.css"),
  ]);
  assert.doesNotMatch(workspace, /AI로\s*제안받기|AI로\s*다듬기/);
  assert.doesNotMatch(await read("../features/workspace/project/quotation/quote-item-basis.tsx"), /ai-assumption-note|providerLabels/);
  assert.match(workspace, /경로\s*판정/);
  assert.match(workspace, /자동\s*전환/);
  assert.doesNotMatch(api, /export\s*function\s*suggestQuotationAssumption/);
  assert.doesNotMatch(api, /quotations\/assumption-suggestions/);
  assert.match(css, /\.quote-amount-field/);
  assert.match(css, /\.quote-amount\s*\{[^}]*height:\s*46px/);
  assert.match(css, /\.quote-summary-controls/);
  assert.match(workspace, /id="quote-calculation-settings">계산\s*조건/);
  assert.match(workspace, /aria-label="세율"/);
  assert.match(workspace, /aria-label="견적\s*유효\s*기간"/);
  assert.match(css, /\.quote-tax-control/);
  assert.match(css, /\.quote-summary-controls\s*>\s*label\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*132px/);
  assert.match(css, /\.ai-assumption-button/);
  assert.match(css, /\.run-model-routing/);
});

test("outcome review presents deliberate line breaks and complete result inputs", async () => {
  const [workspace, css] = await Promise.all([
    read("../app/workspace/page.tsx"),
    read("../app/globals.css"),
  ]);
  assert.match(workspace, /끝난\s*프로젝트를\s*다음<br\s*\/>견적의\s*근거로\s*남기세요/);
  assert.match(workspace, /문의\s*내용을<br\s*\/>먼저\s*확인합니다/);
  assert.match(workspace, /className="outcome-basics"/);
  assert.match(workspace, /className="outcome-metrics-grid"/);
  assert.match(workspace, /className="outcome-input-shell"/);
  assert.match(workspace, /name="totalRevenue"\s*type="number"\s*min="0"\s*step="0\.01"/);
  assert.match(workspace, /name="actualCost"\s*type="number"\s*min="0"\s*step="0\.01"/);
  assert.doesNotMatch(workspace, /name="(?:totalRevenue|actualCost)"[^>]*step="1000"/);
  assert.match(workspace, /className="outcome-date-shell"/);
  assert.match(workspace, /className="outcome-select-shell"/);
  assert.match(workspace, /className="actual-work-heading"/);
  assert.match(workspace, /첫\s*항목\s*추가/);
  assert.match(workspace, /처음\s*예상과\s*달라진\s*점/);
  assert.match(workspace, /추가된\s*범위/);
  assert.match(workspace, /제외된\s*작업/);
  assert.match(workspace, /일정·비용\s*변화/);
  assert.match(workspace, /확인된\s*사실을\s*중심으로\s*작성하세요/);
  assert.match(css, /\.outcome-control\s*input,\s*\.outcome-control\s*select/);
  assert.match(css, /\.outcome-change-card\s*textarea\s*\{[^}]*min-height:\s*156px/);
  assert.match(css, /\.actual-work-empty/);
  assert.match(css, /\.outcome-form\s*\.outcome-input-shell/);
  assert.match(css, /\.outcome-change-prompts\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  assert.match(css, /\.workbench-steps\s*\{[^}]*border-radius:\s*0/);
  assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*?\.outcome-metrics-grid\s*\{\s*grid-template-columns:\s*1fr/);
});
