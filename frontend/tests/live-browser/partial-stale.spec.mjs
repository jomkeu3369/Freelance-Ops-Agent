import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { api, account, login, collectTraffic, seedSyntheticConnection, latestStatus, installLiveGuards } from "./helpers/real-server.mjs";

installLiveGuards();

test("real partial execution and changed original requirements cannot be confirmed", async ({ page, request }, testInfo) => {
  const browserEvidence = collectTraffic(page);
  const { email, session } = await account(request);
  await login(page, email);
  const headers = { Authorization: `Bearer ${session.accessToken}` }, root = `${api}/api/v2/workspaces/${session.workspaceId}`;
  const credentialId = seedSyntheticConnection(session), evidence = [];
  const clientResponse = await request.post(`${root}/clients`, { headers, data: { name: "불완전 결과 검증 고객", companyName: null, email: null, phone: null, notes: "Synthetic only" } });
  expect(clientResponse.status()).toBe(201); const client = await clientResponse.json();
  const startBody = requirementText => ({
    requirementText, locale: "ko-KR", workflowMode: "PROJECT_ANALYSIS",
    modelSelection: { provider: "OPENAI", model: "gpt-6-luna", reasoningEffort: "LOW", credentialId },
    budget: {
      maxDurationSeconds: 180, maxModelCalls: 50, maxToolCalls: 12,
      maxInputTokens: 150000, maxOutputTokens: 48000, maxDepartments: 4,
      maxHierarchyDepth: 2, maxSearchCredits: 0, maxRetries: 2, maxHandoffs: 3,
    },
    safetyContext: {
      externalSideEffect: false, sensitiveData: false,
      financialAuthorityRequired: false, legalAuthorityRequired: false,
      irreversibleAction: false, approvalRequired: false, authorityVerified: false,
    },
    byokCostNoticeVersion: "byok-standard-150k-48k-2026-10-05-v1",
  });
  for (const partial of [true, false]) {
    const input = { clientId: client.id, title: partial ? "부분 실패" : "오래된 분석", requirementText: partial ? "LIVE_PARTIAL_FAILURE 합성 부서 실패를 검증합니다." : "LIVE 고객 제공 자료를 사용합니다.", currency: "KRW", deadline: null, budgetMin: null, budgetMax: null };
    const created = await request.post(`${root}/projects`, { headers, data: input }); expect(created.status()).toBe(201); const project = await created.json();
    const base = `${root}/projects/${project.id}`, key = `live-start-${randomUUID()}`, body = startBody(input.requirementText);
    const accepted = await request.post(`${base}/agent-runs`, { headers: { ...headers, "Idempotency-Key": key }, data: body });
    expect(accepted.status()).toBe(202); const run = await accepted.json();
    if (!partial) {
      await expect.poll(() => latestStatus(request, base, headers)).toBe("WAITING_FOR_USER");
      const waiting = await (await request.get(`${base}/agent-runs/latest`, { headers })).json();
      const resumed = await request.post(`${root}/agent-runs/${run.runId}/responses`, { headers, data: { interruptionId: waiting.interruption.interruptionId, idempotencyKey: `resume-${randomUUID()}`, answers: [{ questionIndex: 0, answer: "고객 제공 자료, 결제 제외" }] } });
      expect(resumed.status()).toBe(202);
    }
    await expect.poll(() => latestStatus(request, base, headers)).toBe(partial ? "PARTIAL" : "COMPLETED");
    const sourceResponse = await request.get(`${base}/analysis-decisions/sources/latest`, { headers }); expect(sourceResponse.status()).toBe(200); const source = await sourceResponse.json();
    const choice = { requestId: randomUUID(), sourceRunId: source.runId, expectedProjectVersion: project.version, selectedOpinionIds: [`${source.runId}:LEAN`] };
    const draftResponse = await request.post(`${base}/analysis-decisions`, { headers, data: choice });
    if (partial) {
      expect(source.sourceCurrent).toBe(false); expect(draftResponse.status()).toBe(409);
      const saved = source.view.result.departmentResults;
      const preserved = saved.filter(value => ["PARTIAL", "COMPLETED"].includes(value.status));
      expect(preserved.map(value => value.department)).toEqual(["REQUIREMENTS", "RESEARCH"]);
      expect(preserved.every(value => value.summary.includes("LIVE"))).toBe(true);
      expect(saved.find(value => value.department === "DEAL_DESIGN").status).toBe("FAILED");
      expect(saved.find(value => value.department === "VERIFICATION").status).toBe("SKIPPED");
      await page.goto(`/workspace/projects/${project.id}/agent`);
      await expect(page.locator(".agent-chat-result")).toContainText("LIVE");
      await page.locator(".agent-chat-result button").click();
      const panel = page.locator(".agent-chat-result-panel");
      await expect(panel.locator(".result-state.partial")).toBeVisible();
      await expect(panel).toContainText("최종 확정에는 사용할 수 없습니다");
      await expect(panel.getByRole("button", { name: "견적 비교하기", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      evidence.push({ runId: source.runId, status: source.view.status, savedDepartments: saved.map(value => ({ department: value.department, status: value.status })), compositionStatus: draftResponse.status() });
    } else {
      expect(draftResponse.status()).toBe(200); const draft = await draftResponse.json();
      const replay = await request.post(`${base}/agent-runs`, { headers: { ...headers, "Idempotency-Key": key }, data: body });
      expect(replay.status()).toBe(202); expect((await replay.json()).runId).toBe(run.runId);
      expect((await (await request.get(`${base}/agent-runs/history`, { headers })).json())).toHaveLength(1);
      const changed = await request.patch(`${root}/projects/${project.id}`, { headers, data: { ...input, status: project.status, requirementText: `${input.requirementText} 변경: 결제 기능을 추가합니다.` } }); expect(changed.status()).toBe(200);
      const confirmation = await request.post(`${base}/analysis-decisions/${draft.id}/confirm`, { headers, data: { expectedContentHash: draft.contentHash, confirmation: "CONFIRM_ANALYSIS_DECISION" } });
      expect(confirmation.status()).toBe(409);
      const preserved = await (await request.get(`${base}/analysis-decisions/${draft.id}`, { headers })).json(); expect(preserved.status).toBe("DRAFT");
      evidence.push({ runId: source.runId, replayRunId: run.runId, status: source.view.status, staleConfirmationStatus: confirmation.status(), preservedStatus: preserved.status });
    }
  }
  expect(browserEvidence.errors).toEqual([]);
  expect(browserEvidence.traffic.filter(value => value.status >= 500)).toEqual([]);
  const file = testInfo.outputPath("partial-stale-http-evidence.json");
  await writeFile(file, JSON.stringify({ boundary: "Real Spring/FastAPI/PostgreSQL transitions; only one synthetic model department fails", evidence }, null, 2));
  await testInfo.attach("real-partial-stale-http-evidence", { contentType: "application/json", path: file });
});

