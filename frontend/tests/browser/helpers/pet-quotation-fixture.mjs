import { fixture } from "./chat-fixture.mjs";

// Browser-only contract fixture: authentication is seeded and every business/AI
// response below is synthetic. This does not exercise Spring, PostgreSQL, LLMs,
// email verification, real provider access, or monetary settlement.
// Shapes follow app/lib/api/contracts/{projects,pets,agents,quotations,outcomes}
// and backend ClientResponse, AgentRunView, QuotationResponse,
// SharedProposalResponse/SharedProposalItemResponse, ProposalDecisionResponse.
export const workflow = {
  projectId: "project-one",
  clientId: "client-workflow",
  petId: "pet-workflow",
  token: "synthetic-pet-quotation-token",
  title: "가상 고객의 예약 사이트 견적",
  requirement: "가상 고객 문의: 예약 신청과 관리자 일정 확인이 필요합니다. 결제는 이번 범위에서 제외합니다.",
  question: "예약 알림은 이메일만 포함하면 될까요?",
  answer: "이메일 알림만 포함하고 문자 발송은 제외해 주세요.",
  itemTitle: "예약 신청 화면",
};

const timestamp = "2026-10-19T01:00:00Z";
const petProfile = {
  petId: workflow.petId, slot: "RECOMMENDED", name: "견적 친구", animal: "owl", color: "lavender",
  accessory: "glasses", tone: "WARM", valuePriority: "BALANCED", deliveryPriority: "QUALITY",
  scopePriority: "BALANCED", duty: "RESEARCH", skillMode: "AUTO",
  preferences: { personality: "", communication: "친근하게 설명", focus: "확인된 범위", responsibility: "", requests: ["원문에 없는 내용은 질문하기"] },
};

function result() {
  const quotationDrafts = ["LEAN", "RECOMMENDED", "EXPANDED"].map((scenario, index) => ({
    scenario,
    items: [{ title: workflow.itemTitle, description: "고객이 확인한 예약 신청 범위", quantity: [4, 6, 8][index], unit: "HOUR", rateCardHint: "예약 화면 개발", basis: { type: "ASSUMPTION", content: "이메일 알림만 포함. 문자 발송과 결제는 제외한다.", sourceReference: null, sourceTitle: null } }],
    petPerspective: { proposal: "확인된 예약 범위부터 견적을 검토해요.", rationale: "고객이 이메일 알림 범위를 확인했습니다.", tradeoff: "문자와 결제는 별도 협의가 필요합니다." },
  }));
  return { projectSummary: "가상 AI 응답: 예약 신청과 관리자 일정, 이메일 알림을 검토했습니다. 결제와 문자는 제외합니다.", openQuestions: [], departmentResults: [], quotationDraft: quotationDrafts[1], quotationDrafts, referencedDocumentIds: [] };
}

export async function petQuotationFixture(page) {
  const state = await fixture(page);
  state.projects = [];
  state.permissions.push("client.read", "client.write", "project.write", "quotation.publish");
  Object.assign(state, {
    clients: [], clientCreates: [], projectCreates: [], petSelections: [], quoteCreates: [],
    publishes: [], shares: [], decisions: [], publicReads: [], unexpectedWrites: [], pageErrors: [],
    quote: null, saveFailures: 0, lostStartResponses: 0, startKeys: [], selectedPetAtStart: [],
    pets: { pets: [{ id: workflow.petId, archived: false, revision: 1, profile: petProfile }], selectedPetId: null, maxActivePets: 2, maxStoredPets: 3, maxPromptLength: 500, maxPreferenceRequests: 6, generationMode: "RULE_BASED_PREVIEW", aiGenerationAvailable: false },
  });
  page.on("pageerror", error => state.pageErrors.push(error.message));
  const acceptedStarts = new Map();
  await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "ko"));
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.route("**/api/v2/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    const prefix = "/api/v2/workspaces/local-space";
    if (path === `${prefix}/clients`) {
      if (method === "GET") return json(state.clients);
      if (method === "POST") {
        const body = request.postDataJSON();
        state.clientCreates.push(body);
        const client = { ...body, id: workflow.clientId, workspaceId: "local-space", status: "ACTIVE", createdBy: "local-user", createdAt: timestamp, updatedAt: timestamp, version: 0 };
        state.clients.push(client);
        return json(client, 201);
      }
    }
    if (path === `${prefix}/projects` && method === "POST") {
      const body = request.postDataJSON();
      state.projectCreates.push(body);
      const project = { ...body, id: workflow.projectId, workspaceId: "local-space", status: "LEAD", updatedAt: timestamp, version: 0 };
      state.projects.push(project);
      return json(project, 201);
    }
    if (path === `${prefix}/projects/${workflow.projectId}` && method === "GET") return json(state.projects[0]);
    if (path === `${prefix}/agent-pets` && method === "GET") return json(state.pets);
    if (path === `${prefix}/agent-pets/${workflow.petId}` && method === "PATCH") {
      const body = request.postDataJSON();
      state.petSelections.push(body);
      if (body.action !== "SELECT" || body.expectedRevision !== 1) return json({ message: "Synthetic pet selection conflict" }, 409);
      state.pets.selectedPetId = workflow.petId;
      return route.fulfill({ status: 204 });
    }
    if (path === `${prefix}/projects/${workflow.projectId}/agent-runs` && method === "POST") {
      const body = request.postDataJSON();
      const key = request.headers()["idempotency-key"];
      state.starts.push(body);
      state.startKeys.push(key);
      state.selectedPetAtStart.push(state.pets.selectedPetId);
      if (!key) return json({ message: "Synthetic idempotency key is required" }, 400);
      const previous = acceptedStarts.get(key);
      if (previous && previous.body !== JSON.stringify(body)) return json({ message: "Synthetic idempotency body conflict" }, 409);
      const acceptedRun = previous?.run ?? {
        runId: "run-one", status: "WAITING_FOR_USER", activeDepartment: "REQUIREMENTS",
        interruption: { interruptionId: "synthetic-question", kind: "CLARIFICATION", questions: [workflow.question] },
        result: null, errorCode: null,
        metadata: { provider: body.modelSelection.provider, model: body.modelSelection.model, credentialId: null, promptVersion: "synthetic-workflow-v1", toolSchemaVersion: "synthetic-tools-v1", traceId: "synthetic-trace", petProfiles: state.pets.selectedPetId ? [petProfile] : [], skillSelection: body.skillSelection ?? null, resolvedSkillIds: [], deferredSkillIds: [] },
        usage: null, updatedAt: timestamp,
      };
      acceptedStarts.set(key, { body: JSON.stringify(body), run: acceptedRun });
      // Model an accepted request whose delivery is uncertain to the UI. No run
      // appears in fixture read projections until the same key is retried.
      if (state.lostStartResponses-- > 0) return json({ message: "가상 서버: 시작 응답을 확인하지 못했습니다." }, 503);
      state.run = acceptedRun;
      state.history = [{ runId: "run-one", requirementText: body.requirementText, status: state.run.status, createdAt: timestamp }];
      return json({ runId: "run-one", status: "QUEUED", acceptedAt: timestamp }, 202);
    }
    if (path === `${prefix}/agent-runs/run-one/responses` && method === "POST") {
      state.resumes.push(request.postDataJSON());
      state.run = { ...state.run, status: "COMPLETED", activeDepartment: null, interruption: null, result: result() };
      state.history[0].status = "COMPLETED";
      return json({ runId: "run-one", status: "QUEUED", acceptedAt: timestamp }, 202);
    }
    if (path === `${prefix}/agent-runs/run-one/usage` && method === "GET") return json({ message: "Synthetic fixture has no settled provider usage" }, 404);
    if (path === `${prefix}/rate-cards` && method === "GET") return json([]);
    if (path === `${prefix}/projects/${workflow.projectId}/quotations/page` && method === "GET") return json({ items: state.quote ? [state.quote] : [], nextCursor: null });
    if (path === `${prefix}/projects/${workflow.projectId}/quotations` && method === "POST") {
      const body = request.postDataJSON();
      state.quoteCreates.push(body);
      if (state.saveFailures-- > 0) return json({ message: "가상 서버: 견적 초안을 저장하지 못했습니다." }, 503);
      // Deterministic response fixture for one explicitly entered item, not a
      // replacement for QuotationCalculator's backend monetary tests.
      const items = body.items.map(item => {
        const subtotal = item.quantity * item.unitRate, discountAmount = subtotal * item.discountRate;
        return { ...item, subtotal, discountAmount, total: subtotal - discountAmount };
      });
      const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0), discountTotal = items.reduce((sum, item) => sum + item.discountAmount, 0);
      const riskBufferRate = body.applyDefaultRiskBuffer ? state.policy.defaultRiskBufferRate : 0;
      const riskBufferAmount = (subtotal - discountTotal) * riskBufferRate;
      const taxAmount = (subtotal - discountTotal + riskBufferAmount) * body.taxRate;
      state.quote = { scenario: body.scenario, currency: body.currency, taxRate: body.taxRate, validUntil: body.validUntil, id: "quote-workflow", workspaceId: "local-space", projectId: workflow.projectId, seriesId: "series-workflow", previousVersionId: null, versionNumber: 1, status: "DRAFT", subtotal, discountTotal, riskBufferRate, riskBufferAmount, taxAmount, total: subtotal - discountTotal + riskBufferAmount + taxAmount, items, publishedAt: null, createdBy: "local-user", createdAt: timestamp, version: 0 };
      return json(state.quote, 201);
    }
    if (path === `${prefix}/quotations/quote-workflow/publish` && method === "POST") {
      state.publishes.push(path);
      if (!state.quote || state.quote.status !== "DRAFT") return json({ message: "Synthetic quote is not a saved draft" }, 409);
      state.quote = { ...state.quote, status: "PUBLISHED", publishedAt: timestamp, version: state.quote.version + 1 };
      return json(state.quote);
    }
    if (path === `${prefix}/quotations/quote-workflow/shares` && method === "POST") {
      state.shares.push(request.postDataJSON());
      if (state.quote?.status !== "PUBLISHED") return json({ message: "Synthetic quote is not published" }, 409);
      return json({ shareId: "share-workflow", token: workflow.token, publicPath: `/proposal/${workflow.token}`, expiresAt: "2099-01-01T00:00:00Z", createdAt: timestamp }, 201);
    }
    if (path === `/api/v2/proposals/${workflow.token}` && method === "GET") {
      state.publicReads.push({ authorization: request.headers().authorization ?? null });
      if (!state.shares.length) return json({ message: "Synthetic share does not exist" }, 404);
      const { id, projectId, versionNumber, scenario, currency, subtotal, discountTotal, riskBufferAmount, taxAmount, total, validUntil, publishedAt, items } = state.quote;
      return json({ quotationId: id, projectId, projectTitle: state.projects[0].title, versionNumber, scenario, currency, subtotal, discountTotal, riskBufferAmount, taxAmount, total, validUntil, publishedAt, shareExpiresAt: "2099-01-01T00:00:00Z", items: items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== "rateCardId"))) });
    }
    if (path === `/api/v2/proposals/${workflow.token}/decisions` && method === "POST") {
      const body = request.postDataJSON();
      if (!state.shares.length || state.quote?.status !== "PUBLISHED") return json({ message: "Synthetic published share does not exist" }, 404);
      state.decisions.push({ body, authorization: request.headers().authorization ?? null });
      if (state.decisions.length > 1) return json({ message: "Synthetic decision already recorded" }, 409);
      return json({ decisionId: "decision-workflow", quotationId: state.quote.id, decision: body.decision, clientName: body.clientName, comment: body.comment, decidedAt: timestamp }, 201);
    }
    // Keep auth, usage, event reads and project lists in the shared fixture, but
    // reject every unplanned workflow mutation instead of inventing success.
    if (!["GET", "OPTIONS"].includes(method)) {
      state.unexpectedWrites.push({ path, method });
      return json({ message: "Unhandled synthetic workflow mutation" }, 501);
    }
    return route.fallback();
  });
  return state;
}
