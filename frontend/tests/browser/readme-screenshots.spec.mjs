import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture } from "./helpers/chat-fixture.mjs";

const workspacePath = "/workspace/projects/project-one/agent";
const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const apiOrigin = "http://localhost:8080";
const outputDirectory = "outputs/ui-ux/readme";

// Capture the real built application. Workspace responses are synthetic fixtures;
// there are no live accounts, keys, backend writes, or paid provider requests.
async function auditRequests(page, allowFixtureApi = false) {
  const audit = { blockedRequests: [], attemptedWrites: [], apiReads: [], pageErrors: [] };
  page.on("pageerror", error => audit.pageErrors.push(error.message));
  await page.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      audit.attemptedWrites.push({ method: request.method(), url: url.href });
      return route.abort();
    }
    if (allowFixtureApi && url.origin === apiOrigin && url.pathname.startsWith("/api/v2/")) {
      audit.apiReads.push(url.pathname);
      return route.fallback();
    }
    if (url.origin === localOrigin && !url.pathname.startsWith("/api/")) return route.fallback();
    audit.blockedRequests.push(url.href);
    return route.abort();
  });
  return audit;
}

async function capture(page, name, audit, state = null) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(audit.pageErrors).toEqual([]);
  expect(audit.blockedRequests).toEqual([]);
  expect(audit.attemptedWrites).toEqual([]);
  if (state) {
    expect(state.starts).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.blocked).toEqual([]);
  }
  await mkdir(outputDirectory, { recursive: true });
  await page.screenshot({ path: `${outputDirectory}/${name}.png`, animations: "disabled" });
  await writeFile(`${outputDirectory}/${name}.json`, JSON.stringify({
    source: "Actual application rendered by Chromium against an ephemeral local production build",
    commit: process.env.GITHUB_SHA ?? null,
    syntheticWorkspaceData: Boolean(state),
    realAccountOrProviderAccess: false,
    viewport: page.viewportSize(),
    path: new URL(page.url()).pathname,
    ...audit
  }, null, 2));
}

async function workspaceFixture(page) {
  const state = await fixture(page);
  state.projects[0].title = "예약 웹사이트 제작";
  state.projects[0].requirementText = "예약 페이지와 관리자 화면을 만들고 싶어요. 모바일에서도 편하게 사용할 수 있게 해 주세요.";
  await page.route("**/api/v2/me", route => route.fulfill({ json: {
    id: "local-user", email: "demo@example.invalid", displayName: "프리랜서", status: "ACTIVE",
    workspaces: [{ workspaceId: "local-space", name: "나의 작업 공간", effectivePermissions: state.permissions }]
  } }));
  await page.route("**/api/v2/workspaces/local-space/agent-pets", route => route.fulfill({ json: {
    pets: [{ id: "readme-companion", archived: false, revision: 1, profile: {
      petId: "readme-companion", slot: "RECOMMENDED", name: "루미", animal: "cat", color: "sky", accessory: "scarf",
      tone: "WARM", valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED", duty: "GENERAL"
    } }], selectedPetId: "readme-companion", maxActivePets: 8, maxStoredPets: 24,
    maxPromptLength: 500, maxPreferenceRequests: 6, generationMode: "RULE_BASED_PREVIEW", aiGenerationAvailable: false
  } }));
  const audit = await auditRequests(page, true);
  await page.addInitScript(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("freelance-ops-ui-locale-v1", "ko");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  return { state, audit };
}

function seedCompletedAnalysis(state) {
  state.run = {
    runId: "readme-analysis", status: "COMPLETED", activeDepartment: null, interruption: null,
    result: {
      projectSummary: [
        "## 예약 웹사이트 제작 범위를 정리했어요", "",
        "고객이 예약 가능한 시간을 확인하고 신청할 수 있는 웹사이트입니다. 관리자 화면에서 예약 현황을 관리합니다.", "",
        "### 우선 포함할 작업", "- 날짜·시간 선택과 예약 신청", "- 관리자 예약 목록과 상태 관리", "- 모바일 화면 대응", "",
        "### 견적 전에 확인할 내용", "온라인 결제와 예약 변경·취소 기능이 필요한지 확인해 주세요. 답변을 바탕으로 범위와 공수를 나눠 검토할 수 있어요."
      ].join("\n"),
      openQuestions: [], departmentResults: [], quotationDraft: null, quotationDrafts: []
    }, errorCode: null, metadata: null, usage: null, updatedAt: "2026-10-09T00:00:00Z"
  };
  state.history = [{ runId: state.run.runId, requirementText: state.projects[0].requirementText, status: "COMPLETED", createdAt: state.run.updatedAt }];
}

test("README main image uses the current rendered landing", async ({ page }) => {
  const audit = await auditRequests(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("freelance-ops-ui-locale-v1", "ko");
  });
  await page.goto("/");
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-ready", "true");
  await expect(page.locator(".spatial-flow")).toHaveAttribute("data-workflow-state", "ready", { timeout: 30_000 });
  await expect(page.locator('[data-webgl-kind="hero"]')).toHaveAttribute("data-webgl-state", "ready", { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("제안은 명확하게.");
  await expect(page.getByRole("button", { name: "제안", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await capture(page, "landing-overview", audit);
});

test("README chat image shows current analysis, composer and companion", async ({ page }) => {
  const { state, audit } = await workspaceFixture(page);
  seedCompletedAnalysis(state);
  await page.goto(workspacePath);
  await expect(page.locator(".workspace-companion")).toHaveAttribute("aria-label", "함께하는 동료: 루미");
  await expect(page.locator(".agent-chat-result .chat-markdown h2")).toHaveText("예약 웹사이트 제작 범위를 정리했어요");
  await page.locator("#agent-chat-input").fill("온라인 결제는 제외하고, 예약 변경 기능은 선택 항목으로 비교해 주세요.");
  await page.locator("#agent-chat-input").blur();
  await page.getByRole("log").evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByRole("button", { name: "파일 첨부", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 설정 열기", exact: true })).toBeVisible();
  await capture(page, "chat-analysis", audit, state);
});

test("README personal-key image shows the full cost notice before any execution", async ({ page }) => {
  const { state, audit } = await workspaceFixture(page);
  seedCompletedAnalysis(state);
  state.aiUsage.spendingEnabled = false;
  state.aiUsage.models = state.aiUsage.models.map(model => ({ ...model, available: false, unavailableReason: "SPENDING_DISABLED" }));
  state.connections = [{ id: "readme-personal-key", provider: "OPENAI", model: "gpt-6-luna", maskedKey: "synthetic-only", updatedAt: "2026-10-09T00:00:00Z" }];
  await page.goto(workspacePath);
  await expect(page.locator(".workspace-companion")).toBeVisible();
  await page.locator("#agent-chat-input").fill("확인한 범위로 견적 초안을 준비해 주세요.");
  await page.locator(".chat-model-trigger").click();
  await page.getByRole("dialog", { name: "AI 모델 선택", exact: true }).getByLabel("AI 연결", { exact: true }).selectOption("readme-personal-key");
  await page.keyboard.press("Escape");
  await page.locator(".chat-model-trigger").blur();
  const notice = page.locator(".agent-chat-composer .byok-cost-notice");
  await expect(notice).toContainText("$0.04275");
  await expect(notice).toContainText("입력 15만·출력 4.8만");
  await expect(notice).toContainText("요금 변경·계정 조건·세금·환율");
  await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeEnabled();
  const bounds = await notice.boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.getByRole("log").evaluate(element => { element.scrollTop = 0; });
  await capture(page, "personal-key-cost-notice", audit, state);
});
