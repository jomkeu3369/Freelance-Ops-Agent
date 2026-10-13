import { createHash } from "node:crypto";
import { fixture, requestBarrier } from "./chat-fixture.mjs";

export { requestBarrier };
export const workflowPath = "/workspace/projects/project-one/agent";
export const scenarios = ["LEAN", "RECOMMENDED", "EXPANDED"];
export const workflowRunId = "a1000000-0000-4000-8000-000000000001";
const now = "2026-10-13T16:00:00.123456Z";
const hash = text => createHash("sha256").update(text).digest("hex");
const clone = value => structuredClone(value);

export function completeWorkflowRun(runId = workflowRunId) {
  const quotationDrafts = scenarios.map(scenario => ({ scenario,
    petPerspective: { proposal: `${scenario} 선택 제안`, rationale: `${scenario} 기록된 이유`, tradeoff: `${scenario} 확인할 조건` },
    items: [{ title: `${scenario} 원본 작업`, description: `${scenario} 고유 설명`, quantity: 2, unit: "DAY", rateCardHint: null,
      basis: { type: scenario === "EXPANDED" ? "ASSUMPTION" : "EVIDENCE", content: `${scenario} 원본 근거`, sourceReference: "source-message-original", sourceTitle: "고객의 원문" } }]
  }));
  return { runId, status: "COMPLETED", activeDepartment: null, interruption: null,
    result: { projectSummary: "프로젝트 전체 분석 기록", openQuestions: ["미해결 질문은 확정 후에도 미해결"], departmentResults: [], quotationDraft: quotationDrafts[1], quotationDrafts, referencedDocumentIds: [] },
    errorCode: null, metadata: { provider: "OPENAI", model: "fixture-model", promptVersion: "fixture", toolSchemaVersion: "fixture", traceId: "fixture", credentialId: null,
      petProfiles: scenarios.map((slot, index) => ({ petId: `fixture-pet-${slot}`, slot, name: `${slot} 담당 동료`, animal: ["cat", "owl", "turtle"][index], color: "sky", accessory: "none", tone: "WARM", valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED", duty: "GENERAL" })) },
    usage: null, updatedAt: now };
}

function composition(opinions, questions) {
  return ["선택 의견 종합 초안 (정리)", ...opinions.flatMap(({ opinionId, scenario, draft }) => [
    `계획 관점: ${scenario}`, `의견 출처: ${opinionId}`, `제안: ${draft.petPerspective.proposal}`,
    `이유: ${draft.petPerspective.rationale}`, `함께 생각할 점: ${draft.petPerspective.tradeoff}`,
    ...draft.items.flatMap(item => [`작업: ${item.title}`, `내용: ${item.description}`, `근거/가정: ${item.basis.content}`])
  ]), "아직 확인할 질문", ...questions].join("\n");
}

/** Stateful UI-only protocol fixture. Every production/provider request remains blocked. */
export async function analysisWorkflowFixture(page, { completed = true, projectId = "project-one" } = {}) {
  const state = await fixture(page);
  state.permissions.push("project.write", "document.read", "document.write");
  state.projects[0].version = 0;
  state.run = completed ? completeWorkflowRun() : null;
  state.history = state.run ? [{ runId: state.run.runId, requirementText: state.projects[0].requirementText, status: state.run.status, createdAt: now }] : [];
  const workflow = { decisions: [], creates: [], revisions: [], confirms: [], requests: [], barriers: {}, failures: {}, lostResponses: {}, sourceEnabled: completed, sourceStale: false, sourceVersion: 0, ledger: new Map(), serial: 1 };
  const root = `/api/v2/workspaces/local-space/projects/${projectId}/analysis-decisions`;
  const id = () => `d1000000-0000-4000-8000-${String(workflow.serial++).padStart(12, "0")}`;
  const sourceMessages = [
    { id: "b1000000-0000-4000-8000-000000000001", eventOrder: 1, kind: "PROJECT_INPUT", content: state.projects[0].requirementText, prompt: null, createdAt: now },
    { id: "b1000000-0000-4000-8000-000000000002", eventOrder: 2, kind: "RUN_INPUT", content: state.projects[0].requirementText, prompt: null, createdAt: now }
  ];
  const latest = familyId => workflow.decisions.find(value => value.familyId === familyId);
  const barrier = async operation => { const value = workflow.barriers[operation]; delete workflow.barriers[operation]; if (value) await value.wait(); };

  await page.route(`**${root}**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = method === "GET" ? null : request.postDataJSON();
    workflow.requests.push({ path, method, body: clone(body) });
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    const fail = (message, status = 409) => json({ message }, status);
    if (method === "GET" && path === `${root}/sources/latest`) {
      const snapshot = state.run && workflow.sourceEnabled ? { runId: state.run.runId, sourceProjectVersion: workflow.sourceVersion, view: clone(state.run) } : null;
      await barrier("source");
      return snapshot ? json(snapshot) : route.fulfill({ status: 204 });
    }
    if (method === "GET" && path === root) { const snapshot = clone(workflow.decisions); await barrier("list"); return json(snapshot); }
    if (method === "GET" && path === `${root}/latest-confirmed`) {
      const value = workflow.decisions.filter(item => item.status === "CONFIRMED").sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))[0];
      return value ? json(clone(value)) : route.fulfill({ status: 204 });
    }
    const operation = path === root ? "create" : path.endsWith("/revisions") ? "revise" : path.endsWith("/confirm") ? "confirm" : "get";
    const targetId = path.slice(root.length + 1).split("/")[0];
    const target = workflow.decisions.find(value => value.id === targetId);
    if (operation === "get" && method === "GET") return target ? json(clone(target)) : fail("Fixture decision not found", 404);
    if (method !== "POST") return fail("Unexpected decision route", 404);
    if (!state.permissions.includes("project.write")) return fail("Permission denied", 403);
    if (operation === "create") workflow.creates.push(clone(body));
    if (operation === "revise") workflow.revisions.push({ id: targetId, ...clone(body) });
    if (operation === "confirm") workflow.confirms.push({ id: targetId, ...clone(body) });
    const operationHash = hash(JSON.stringify({ operation, targetId, ...body, requestId: undefined }));
    const saved = body.requestId ? workflow.ledger.get(body.requestId) : null;
    if (saved) return saved.operationHash === operationHash ? json(clone(saved.value)) : fail("같은 요청 식별자를 다른 변경에 사용할 수 없습니다.");
    if (workflow.failures[operation] > 0) { workflow.failures[operation]--; await barrier(operation); return fail("Fixture temporary request failure", 503); }
    if (operation !== "create" && !target) return fail("Fixture decision not found", 404);
    if (operation === "confirm") {
      if (body.confirmation !== "CONFIRM_ANALYSIS_DECISION") return fail("명시적인 결과 확정이 필요합니다.", 400);
      if (body.expectedContentHash !== target.contentHash) return fail("검토한 내용과 저장된 내용이 다릅니다.");
      if (target.status === "CONFIRMED") return json(clone(target));
    }
    if (workflow.sourceStale || workflow.sourceVersion !== state.projects[0].version) return fail("분석 이후 원문·요구사항 확정·추가 답변이 변경되었습니다.");
    if (target && latest(target.familyId)?.id !== target.id) return fail("새 정리 버전이 이미 저장되었습니다. 최신 버전을 확인해 주세요.");
    let value;
    if (operation === "create") {
      const selected = body.selectedOpinionIds ?? [];
      if (!body.requestId || selected.length === 0 || selected.length > 3 || new Set(selected).size !== selected.length) return fail("1~3개의 서로 다른 의견을 선택해 주세요.", 400);
      if (body.sourceRunId !== state.run?.runId || body.expectedProjectVersion !== state.projects[0].version) return fail("프로젝트가 변경되었습니다.");
      if (state.run.status !== "COMPLETED" || state.run.result?.quotationDrafts?.length !== 3) return fail("완료된 프로젝트 전체 분석만 출처로 사용할 수 있습니다.");
      const sourceOpinions = scenarios.filter(scenario => selected.includes(`${state.run.runId}:${scenario}`))
        .map(scenario => ({ opinionId: `${state.run.runId}:${scenario}`, scenario, draft: clone(state.run.result.quotationDrafts.find(item => item.scenario === scenario)) }));
      if (sourceOpinions.length !== selected.length) return fail("선택 의견이 이 분석에 속하지 않습니다.", 400);
      const bodyText = composition(sourceOpinions, state.run.result.openQuestions), decisionId = id();
      value = { id: decisionId, workspaceId: "local-space", projectId, familyId: decisionId, previousId: null, versionNumber: 1, status: "DRAFT",
        sourceRunId: state.run.runId, sourceProjectVersion: workflow.sourceVersion, selectedOpinionIds: sourceOpinions.map(item => item.opinionId), sourceOpinions,
        sourcePetProfiles: clone(state.run.metadata.petProfiles), sourceSummary: state.run.result.projectSummary, sourceOpenQuestions: clone(state.run.result.openQuestions),
        sourceMessages: clone(sourceMessages), sourceEventOrder: 1, reviewWarnings: selected.length > 1 ? ["서로 다른 범위입니다. 중복·상충하는 범위를 검토해 주세요."] : [],
        originalBodyText: bodyText, bodyText, contentHash: hash(bodyText), bodyOrigin: "SELECTED_OPINIONS", createdBy: "local-user", createdAt: now, confirmedBy: null, confirmedAt: null };
      workflow.decisions.unshift(value);
    } else if (operation === "revise") {
      if (!body.requestId || typeof body.bodyText !== "string" || !body.bodyText.trim()) return fail("정리 내용을 입력해 주세요.", 400);
      if (body.expectedContentHash !== target.contentHash) return fail("검토한 내용과 저장된 내용이 다릅니다.");
      const bodyText = body.bodyText.trim();
      value = { ...clone(target), id: id(), previousId: target.id, versionNumber: target.versionNumber + 1, status: "DRAFT", bodyText, contentHash: hash(bodyText), bodyOrigin: "USER_EDITED", confirmedBy: null, confirmedAt: null };
      workflow.decisions.unshift(value);
    } else if (operation === "confirm") {
      target.status = "CONFIRMED"; target.confirmedBy = "local-user"; target.confirmedAt = now; value = target;
    } else return fail("Unexpected decision operation", 404);
    if (body.requestId) workflow.ledger.set(body.requestId, { operationHash, value });
    const result = clone(value);
    await barrier(operation);
    if (workflow.lostResponses[operation] > 0) { workflow.lostResponses[operation]--; return route.abort("failed"); }
    return json(result);
  });
  return { state, workflow, sourceMessages };
}
