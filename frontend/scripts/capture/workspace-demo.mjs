import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { captureOrigin, installNetworkGuard } from "./network-guard.mjs";

const origin = captureOrigin(process.env.PLAYWRIGHT_BASE_URL);
process.env.PLAYWRIGHT_BASE_URL = origin;
const { fixture } = await import("../../tests/browser/helpers/chat-fixture.mjs");
const hold = process.argv.includes("--hold");
const outputs = resolve("outputs/workspace-capture");
await mkdir(outputs, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: !hold });
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
    colorScheme: "light", reducedMotion: "no-preference", serviceWorkers: "block",
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const state = await fixture(page);
  state.projects[0].title = "가상 데모 · 예약 웹사이트";
  state.projects[0].requirementText = "고객이 가능한 날짜를 고르고 관리자가 예약을 확인하는 웹사이트입니다.";
  const prompts = [
    "모바일에서 날짜와 시간을 선택할 수 있게 해 주세요.",
    "관리자 예약 목록에 상태와 메모가 필요합니다.",
    "예약 취소 기한과 안내 문구를 정리해 주세요.",
    "회원 가입 없이 예약하는 기본 범위를 먼저 확인해 주세요.",
    "알림은 이번 기본 범위에서 제외하고 견적을 정리해 주세요.",
    "확정한 범위와 아직 답변이 필요한 항목을 구분해 주세요.",
    "고객 검토용 제안서에 포함할 작업 목록을 정리해 주세요.",
    "모바일 화면의 입력 순서와 검토 단계를 확인해 주세요.",
    "운영자가 확인할 예약 상태를 세 가지로 정리해 주세요.",
    "기본 범위의 완료 기준과 제외 범위를 확인해 주세요.",
    "작업별 공수와 검토 시점을 정리해 주세요.",
    "이번 가상 프로젝트의 요구사항 정리를 마무리해 주세요.",
  ];
  const result = {
    projectSummary: "예약 웹사이트의 기본 범위와 고객 검토 항목을 정리했습니다. 모든 화면 데이터는 가상 fixture입니다.",
    openQuestions: [], departmentResults: [], quotationDraft: null, quotationDrafts: [],
  };
  state.history = prompts.map((requirementText, index) => {
    const runId = index === prompts.length - 1 ? "run-one" : `demo-history-${index}`;
    const createdAt = `2026-10-01T00:${String(index).padStart(2, "0")}:00Z`;
    state.pastRuns[runId] = { runId, status: "COMPLETED", activeDepartment: null,
      interruption: null, result, errorCode: null, metadata: null, usage: null, updatedAt: createdAt };
    return { runId, requirementText, status: "COMPLETED", createdAt };
  });
  state.run = state.pastRuns["run-one"];
  await page.addInitScript(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("freelance-ops-ui-locale-v1", "ko");
  });
  await page.route("**/api/v2/usage/free", route => route.fulfill({ json: {
    limit: 5, used: 1, reserved: 0, remaining: 4, resetAt: "2026-10-31T15:00:00Z",
    period: "2026-10", timezone: "Asia/Seoul", epoch: 1, canManage: false,
  } }));
  await page.route("**/api/v2/notices**", route => route.fulfill({ json: [] }));
  const network = await installNetworkGuard(page, origin);
  await page.goto(`${origin}/workspace/projects/project-one/agent`, { waitUntil: "networkidle" });
  await page.locator(".agent-chat").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.fonts.status === "loaded");
  const appearance = await page.locator(".figma-workspace").evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    theme: document.documentElement.getAttribute("data-theme"),
  }));
  assert.equal(appearance.theme, "light");
  assert.equal(appearance.background, "rgb(255, 255, 255)");
  const log = page.getByRole("log");
  await log.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: resolve(outputs, "workspace-white-preview.png") });
  // Ordinary application test scroll, measured in wall-clock time. Not a video capture.
  const scroll = await log.evaluate(element => new Promise(resolveResult => {
    const maxScroll = Math.min(1500, element.scrollHeight - element.clientHeight);
    const duration = 3000;
    let start, previous;
    const deltas = [];
    function frame(now) {
      start ??= now;
      if (previous !== undefined) deltas.push(now - previous);
      previous = now;
      const progress = Math.min(1, (now - start) / duration);
      element.scrollTop = maxScroll * (progress * progress * (3 - 2 * progress));
      if (progress < 1) requestAnimationFrame(frame);
      else resolveResult({ elapsedMs: now - start, frames: deltas.length + 1,
        gapsOver34ms: deltas.filter(value => value > 34).length,
        maximumGapMs: Math.max(0, ...deltas), pixels: maxScroll });
    }
    requestAnimationFrame(frame);
  }));
  assert(scroll.pixels > 0, "Synthetic chat must have enough content to scroll");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(network.blocked, []);
  assert.equal(network.websocketAttempts, 0);
  assert.equal(state.starts.length, 0);
  assert.equal(state.writes.length, 0);
  const evidence = { kind: "UI_QA_NOT_VIDEO_CAPTURE", sourceRevision: "6bfe089af8f5f25c5c15d7e9f7b6a68962112f28",
    appearance, network, scroll, pageErrors, realBackendCalls: 0, agentStarts: 0,
    audioCapture: false, obsRecording: "NOT_EXECUTED", captureFps: "UNVERIFIED", missedFrames: "UNVERIFIED" };
  await writeFile(resolve(outputs, "workspace-preview-verification.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ kind: evidence.kind, previewReady: true, origin, captureFps: "UNVERIFIED" }));
  if (hold) {
    // User-operated OBS or an available supported UI tool can select this disposable browser later.
    // No recording or audio/camera permission is started by this script.
    await log.evaluate(element => { element.scrollTop = 0; });
    await new Promise(resolveClosed => page.once("close", resolveClosed));
  }
} finally {
  await browser.close();
}
