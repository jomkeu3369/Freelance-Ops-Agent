import { clearQueryCache, invalidateQueries, queryCached } from "./query-cache";

export type Provider = "OPENAI" | "GEMINI";
export type ReasoningEffort = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type AgentRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_USER"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface AuthSession {
  userId: string;
  workspaceId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  clientId: string | null;
  title: string;
  requirementText: string;
  currency: string;
  deadline: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  status: string;
  updatedAt: string;
  version?: number;
}

export interface Client {
  id: string;
  workspaceId: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: "ACTIVE" | "ARCHIVED";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ClientInput {
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export type ProjectStatus = "LEAD" | "QUALIFYING" | "QUOTING" | "NEGOTIATING" | "ACCEPTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface ProjectInput {
  clientId: string | null;
  title: string;
  requirementText: string;
  currency: string;
  deadline: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
}

export interface MeProfile {
  id: string;
  email: string;
  displayName: string;
  status: string;
  workspaces: Array<{
    workspaceId: string;
    name: string;
    slug: string;
    effectivePermissions: string[];
  }>;
}

export interface RequirementFeature {
  title: string;
  description: string;
  priority: "MUST" | "SHOULD" | "COULD" | "WONT";
  acceptanceCriteria: string;
}

export interface RequirementVersion {
  id: string;
  workspaceId: string;
  projectId: string;
  versionNumber: number;
  sourceText: string;
  features: RequirementFeature[];
  assumptions: string[];
  questions: Array<{ content: string; status: string }>;
  createdBy: string;
  createdAt: string;
}

export interface RateCard {
  id: string;
  workspaceId: string;
  name: string;
  unit: WorkUnit;
  rate: number;
  minimumAmount: number;
  currency: string;
  active: boolean;
  version: number;
}

export interface EstimationPolicy {
  workspaceId: string;
  defaultTaxRate: number;
  defaultRiskBufferRate: number;
  maximumDiscountRate: number;
  version: number;
}

export interface KnowledgeDocument {
  id: string;
  workspaceId: string;
  sourceType: "PAST_PROJECT" | "POLICY" | "PLATFORM_TERMS" | "USER_TEMPLATE" | "EXTERNAL_SOURCE";
  title: string;
  sourceUri: string | null;
  sourceVersion: string | null;
  jurisdiction: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  contentSha256: string;
  status: string;
  chunks: Array<{ id: string; chunkIndex: number; content: string; embeddingModel: string | null; startOffset: number | null; endOffset: number | null }>;
  createdAt: string;
  version: number;
}

export interface AgentInterruption {
  interruptionId: string;
  kind: "CLARIFICATION" | "RISK_DECISION" | "QUOTE_APPROVAL";
  questions: string[];
}

export interface AgentQuotationDraft {
  scenario: QuotationScenario;
  items: Array<{
    title: string;
    description: string;
    quantity: number;
    unit: WorkUnit;
    rateCardHint: string | null;
    basis: {
      type: BasisType;
      content: string;
      sourceReference: string | null;
      sourceTitle: string | null;
    };
  }>;
}

export interface AgentRunView {
  runId: string;
  status: AgentRunStatus;
  activeDepartment: string | null;
  interruption: AgentInterruption | null;
  result: {
    projectSummary: string;
    openQuestions: string[];
    departmentResults: Array<{
      department: string;
      status: string;
      summary: string;
      evidenceIds: string[];
      assumptionIds: string[];
      sources: Array<{
        title: string;
        url: string;
        provider: string;
        jurisdiction: string | null;
        excerpt: string;
      }>;
      errorCode: string | null;
    }>;
    quotationDraft: AgentQuotationDraft | null;
  } | null;
  errorCode: string | null;
  metadata: {
    provider: Provider;
    model: string;
    promptVersion: string;
    toolSchemaVersion: string;
    traceId: string;
  } | null;
  usage: {
    requestTier: string;
    modelCalls: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    searchCredits: number;
    crawledPages: number;
    retryCount: number;
    durationMs: number;
  } | null;
  updatedAt: string;
}

export interface AgentRunUsage {
  runId: string;
  requestTier: string;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  searchCredits: number;
  crawledPages: number;
  retryCount: number;
  durationMs: number;
  pricingSnapshotId: string | null;
  actualCost: number | null;
  costCurrency: string | null;
  costStatus: string;
  billableOutcome: boolean;
  recordedAt: string;
}

export interface ModelPricing {
  id: string;
  provider: Provider;
  model: string;
  versionLabel: string;
  currency: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  validFrom: string;
  validUntil: string | null;
}

export interface ModelPricingInput {
  provider: Provider;
  model: string;
  versionLabel: string;
  currency: string;
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  validFrom: string;
  validUntil: string | null;
}

export interface RunAccepted {
  runId: string;
  status: AgentRunStatus;
  acceptedAt: string;
}

export interface WorkflowEvent {
  eventId: number;
  runId: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export type QuotationScenario = "LEAN" | "RECOMMENDED" | "EXPANDED";
export type WorkUnit = "HOUR" | "DAY" | "FIXED";
export type BasisType = "ASSUMPTION" | "EVIDENCE";

export interface QuotationItemInput {
  rateCardId: string | null;
  title: string;
  description: string;
  quantity: number;
  unit: WorkUnit;
  unitRate: number;
  discountRate: number;
  basis: {
    type: BasisType;
    content: string;
    sourceType: "PAST_PROJECT" | "POLICY" | "PLATFORM_TERMS" | "USER_TEMPLATE" | "EXTERNAL_SOURCE" | null;
    sourceReference: string | null;
    sourceTitle: string | null;
    retrievedAt: string | null;
  };
}

export interface QuotationItem extends Omit<QuotationItemInput, "basis"> {
  subtotal: number;
  discountAmount: number;
  total: number;
  basis: QuotationItemInput["basis"];
}

export interface Quotation {
  id: string;
  workspaceId: string;
  projectId: string;
  seriesId: string;
  previousVersionId: string | null;
  versionNumber: number;
  scenario: QuotationScenario;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  currency: string;
  subtotal: number;
  discountTotal: number;
  riskBufferRate: number;
  riskBufferAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  validUntil: string | null;
  items: QuotationItem[];
  publishedAt: string | null;
  createdAt: string;
  version: number;
}

export interface ActualOutcome {
  id: string;
  workspaceId: string;
  projectId: string;
  approvedQuotationId: string | null;
  totalRevenue: number;
  actualCost: number;
  actualHours: number;
  profitAmount: number;
  profitMargin: number;
  completedOn: string | null;
  changeReason: string | null;
  workItems: Array<{
    quotationItemId: string | null;
    title: string;
    actualHours: number;
    actualCost: number;
    notes: string | null;
  }>;
  version: number;
}

export interface ProposalShare {
  shareId: string;
  token: string;
  publicPath: string;
  expiresAt: string;
  createdAt: string;
}

export interface SharedProposal {
  quotationId: string;
  projectId: string;
  projectTitle: string;
  versionNumber: number;
  scenario: QuotationScenario;
  currency: string;
  subtotal: number;
  discountTotal: number;
  riskBufferAmount: number;
  taxAmount: number;
  total: number;
  validUntil: string | null;
  publishedAt: string;
  shareExpiresAt: string;
  items: QuotationItem[];
}

const SESSION_KEY = "freelance-ops-session-v1";
const SESSION_RECOVERY_EVENT = "freelance-ops-session-recovery";
let refreshPromise: Promise<AuthSession> | null = null;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

export function loadSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    window.sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  window.sessionStorage.removeItem(SESSION_KEY);
  clearQueryCache();
}

export function subscribeToSessionRecovery(listener: (session: AuthSession | null) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AuthSession | null>).detail);
  window.addEventListener(SESSION_RECOVERY_EVENT, handler);
  return () => window.removeEventListener(SESSION_RECOVERY_EVENT, handler);
}

function publishRecoveredSession(session: AuthSession | null): void {
  window.dispatchEvent(new CustomEvent<AuthSession | null>(SESSION_RECOVERY_EVENT, { detail: session }));
}

async function rotateSession(session: AuthSession): Promise<AuthSession> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = request<AuthSession>(
    "/api/v2/auth/refresh",
    { method: "POST", body: JSON.stringify({ refreshToken: session.refreshToken }) },
    undefined,
    false,
  ).then((nextSession) => {
    const preservedSession = { ...nextSession, workspaceId: session.workspaceId };
    saveSession(preservedSession);
    publishRecoveredSession(preservedSession);
    return preservedSession;
  }).catch((error) => {
    clearSession();
    publishRecoveredSession(null);
    throw error;
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function recoverSession(failedToken: string): Promise<AuthSession | null> {
  const current = loadSession();
  if (!current) return null;
  if (current.accessToken !== failedToken) return current;
  if (new Date(current.refreshTokenExpiresAt).getTime() <= Date.now()) {
    clearSession();
    publishRecoveredSession(null);
    return null;
  }
  return rotateSession(current);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string, allowSessionRecovery = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.", 0);
  }
  if (response.status === 401 && token && allowSessionRecovery) {
    const recovered = await recoverSession(token);
    if (recovered) return request<T>(path, init, recovered.accessToken, false);
  }
  if (!response.ok) {
    let message = `요청을 완료하지 못했습니다. (${response.status})`;
    try {
      const problem = (await response.json()) as { detail?: string; title?: string };
      message = problem.detail ?? problem.title ?? message;
    } catch {
      // Keep the public-safe fallback message.
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function register(input: {
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
}): Promise<AuthSession> {
  return request("/api/v2/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function login(email: string, password: string): Promise<AuthSession> {
  return request("/api/v2/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function refreshAuthSession(session: AuthSession): Promise<AuthSession> {
  const current = loadSession();
  if (current && current.accessToken !== session.accessToken) return Promise.resolve(current);
  return rotateSession(current ?? session);
}

export function revokeAuthSession(session: AuthSession): Promise<void> {
  return request("/api/v2/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: session.refreshToken }) });
}

export function getMe(session: AuthSession): Promise<MeProfile> {
  return queryCached(`me:${session.userId}`, () => request("/api/v2/me", {}, session.accessToken));
}

export function listProjects(session: AuthSession): Promise<Project[]> {
  return queryCached(`projects:${session.workspaceId}`, () => request(`/api/v2/workspaces/${session.workspaceId}/projects`, {}, session.accessToken));
}

export function listClients(session: AuthSession): Promise<Client[]> {
  return queryCached(
    `clients:${session.workspaceId}`,
    () => request(`/api/v2/workspaces/${session.workspaceId}/clients`, {}, session.accessToken),
  );
}

export function createClient(session: AuthSession, input: ClientInput): Promise<Client> {
  return request<Client>(
    `/api/v2/workspaces/${session.workspaceId}/clients`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
  ).then((client) => { invalidateQueries(`clients:${session.workspaceId}`); return client; });
}

export function updateClient(session: AuthSession, clientId: string, input: ClientInput): Promise<Client> {
  return request<Client>(
    `/api/v2/workspaces/${session.workspaceId}/clients/${clientId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    session.accessToken,
  ).then((client) => { invalidateQueries(`clients:${session.workspaceId}`); return client; });
}

export function archiveClient(session: AuthSession, clientId: string): Promise<void> {
  return request<void>(
    `/api/v2/workspaces/${session.workspaceId}/clients/${clientId}`,
    { method: "DELETE" },
    session.accessToken,
  ).then(() => { invalidateQueries(`clients:${session.workspaceId}`); });
}

export function createProject(
  session: AuthSession,
  input: ProjectInput,
): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
  ).then((project) => { invalidateQueries(`projects:${session.workspaceId}`); return project; });
}

export function updateProject(session: AuthSession, project: Project, status: ProjectStatus): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${project.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        clientId: project.clientId,
        title: project.title,
        requirementText: project.requirementText,
        currency: project.currency,
        deadline: project.deadline,
        budgetMin: project.budgetMin,
        budgetMax: project.budgetMax,
        status,
      }),
    },
    session.accessToken,
  ).then((updated) => { invalidateQueries(`projects:${session.workspaceId}`); return updated; });
}

export function updateProjectDetails(session: AuthSession, project: Project, input: ProjectInput): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${project.id}`,
    { method: "PATCH", body: JSON.stringify({ ...input, status: project.status }) },
    session.accessToken,
  ).then((updated) => { invalidateQueries(`projects:${session.workspaceId}`); return updated; });
}

export interface QuotationAssumptionSuggestion {
  requestId: string;
  content: string;
  provider: Provider;
  model: string;
}

export function deleteProject(session: AuthSession, projectId: string): Promise<void> {
  return request<void>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}`,
    { method: "DELETE" },
    session.accessToken,
  ).then(() => { invalidateQueries(`projects:${session.workspaceId}`); });
}

export function listRequirements(session: AuthSession, projectId: string): Promise<RequirementVersion[]> {
  return queryCached(`requirements:${session.workspaceId}:${projectId}`, () => request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/requirements`,
    {},
    session.accessToken,
  ));
}

export function createRequirementVersion(
  session: AuthSession,
  projectId: string,
  input: { sourceText: string; features: RequirementFeature[]; assumptions: string[]; questions: string[] },
): Promise<RequirementVersion> {
  return request<RequirementVersion>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/requirements`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
  ).then((version) => { invalidateQueries(`requirements:${session.workspaceId}:${projectId}`); return version; });
}

export function listRateCards(session: AuthSession): Promise<RateCard[]> {
  return queryCached(`rate-cards:${session.workspaceId}`, () => request(`/api/v2/workspaces/${session.workspaceId}/rate-cards`, {}, session.accessToken));
}

export function saveRateCard(
  session: AuthSession,
  rateCardId: string,
  input: Omit<RateCard, "id" | "workspaceId" | "version">,
): Promise<RateCard> {
  return request<RateCard>(
    `/api/v2/workspaces/${session.workspaceId}/rate-cards/${rateCardId}`,
    { method: "PUT", body: JSON.stringify(input) },
    session.accessToken,
  ).then((card) => { invalidateQueries(`rate-cards:${session.workspaceId}`); return card; });
}

export function getEstimationPolicy(session: AuthSession): Promise<EstimationPolicy> {
  return queryCached(`estimation-policy:${session.workspaceId}`, () => request(`/api/v2/workspaces/${session.workspaceId}/estimation-policy`, {}, session.accessToken));
}

export function saveEstimationPolicy(
  session: AuthSession,
  input: Omit<EstimationPolicy, "workspaceId" | "version">,
): Promise<EstimationPolicy> {
  return request<EstimationPolicy>(
    `/api/v2/workspaces/${session.workspaceId}/estimation-policy`,
    { method: "PUT", body: JSON.stringify(input) },
    session.accessToken,
  ).then((policy) => { invalidateQueries(`estimation-policy:${session.workspaceId}`); return policy; });
}

export function listDocuments(session: AuthSession): Promise<KnowledgeDocument[]> {
  return queryCached(`documents:${session.workspaceId}`, () => request(`/api/v2/workspaces/${session.workspaceId}/documents`, {}, session.accessToken));
}

export function getDocument(session: AuthSession, documentId: string): Promise<KnowledgeDocument> {
  return queryCached(
    `document:${session.workspaceId}:${documentId}`,
    () => request(`/api/v2/workspaces/${session.workspaceId}/documents/${documentId}`, {}, session.accessToken),
  );
}

export function createDocument(
  session: AuthSession,
  input: {
    sourceType: KnowledgeDocument["sourceType"];
    title: string;
    sourceUri: string | null;
    sourceVersion: string | null;
    jurisdiction: string | null;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    chunks: Array<{ content: string; embedding: null; embeddingModel: null; startOffset: number; endOffset: number }>;
  },
): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(
    `/api/v2/workspaces/${session.workspaceId}/documents`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
  ).then((document) => { invalidateQueries(`documents:${session.workspaceId}`); return document; });
}

export function archiveDocument(session: AuthSession, documentId: string): Promise<void> {
  return request<void>(
    `/api/v2/workspaces/${session.workspaceId}/documents/${documentId}`,
    { method: "DELETE" },
    session.accessToken,
  ).then(() => {
    invalidateQueries(`documents:${session.workspaceId}`);
    invalidateQueries(`document:${session.workspaceId}:${documentId}`);
  });
}

export function listQuotations(session: AuthSession, projectId: string): Promise<Quotation[]> {
  return queryCached(`quotations:${session.workspaceId}:${projectId}`, () => request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/quotations`,
    {},
    session.accessToken,
  ));
}

export function reloadQuotations(session: AuthSession, projectId: string): Promise<Quotation[]> {
  invalidateQueries(`quotations:${session.workspaceId}:${projectId}`);
  return listQuotations(session, projectId);
}

export function createQuotation(
  session: AuthSession,
  projectId: string,
  input: {
    scenario: QuotationScenario;
    currency: string;
    taxRate: number;
    applyDefaultRiskBuffer: boolean;
    validUntil: string | null;
    items: QuotationItemInput[];
  },
): Promise<Quotation> {
  return request<Quotation>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/quotations`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
  ).then((quotation) => { invalidateQueries(`quotations:${session.workspaceId}:${projectId}`); return quotation; });
}

export function publishQuotation(session: AuthSession, quotationId: string): Promise<Quotation> {
  return request<Quotation>(
    `/api/v2/workspaces/${session.workspaceId}/quotations/${quotationId}/publish`,
    { method: "POST" },
    session.accessToken,
  ).then((quotation) => { invalidateQueries(`quotations:${session.workspaceId}`); return quotation; });
}

export function reviseQuotation(
  session: AuthSession,
  quotationId: string,
  input: {
    scenario: QuotationScenario;
    currency: string;
    taxRate: number;
    applyDefaultRiskBuffer: boolean;
    validUntil: string | null;
    items: QuotationItemInput[];
  },
): Promise<Quotation> {
  return request<Quotation>(
    `/api/v2/workspaces/${session.workspaceId}/quotations/${quotationId}/revisions`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
  ).then((quotation) => { invalidateQueries(`quotations:${session.workspaceId}`); return quotation; });
}

export function createProposalShare(session: AuthSession, quotationId: string, expiresInDays = 14): Promise<ProposalShare> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/quotations/${quotationId}/shares`,
    { method: "POST", body: JSON.stringify({ expiresInDays }) },
    session.accessToken,
  );
}

export function revokeProposalShare(session: AuthSession, shareId: string): Promise<void> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/proposal-shares/${shareId}`,
    { method: "DELETE" },
    session.accessToken,
  );
}

export function getSharedProposal(token: string): Promise<SharedProposal> {
  return request(`/api/v2/proposals/${encodeURIComponent(token)}`);
}

export function submitProposalDecision(
  token: string,
  input: {
    decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
    clientName: string;
    clientEmail: string;
    comment: string;
  },
): Promise<{ decisionId: string; quotationId: string; decision: string; clientName: string; comment: string; decidedAt: string }> {
  return request(`/api/v2/proposals/${encodeURIComponent(token)}/decisions`, { method: "POST", body: JSON.stringify(input) });
}

export async function getOutcome(session: AuthSession, projectId: string): Promise<ActualOutcome | null> {
  try {
    return await request(
      `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/outcome`,
      {},
      session.accessToken,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function saveOutcome(
  session: AuthSession,
  projectId: string,
  input: {
    approvedQuotationId: string | null;
    totalRevenue: number;
    actualCost: number;
    actualHours: number;
    completedOn: string | null;
    changeReason: string;
    workItems: Array<{
      quotationItemId: string | null;
      title: string;
      actualHours: number;
      actualCost: number;
      notes: string;
    }>;
  },
): Promise<ActualOutcome> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/outcome`,
    { method: "PUT", body: JSON.stringify(input) },
    session.accessToken,
  );
}

export function startAgentRun(
  session: AuthSession,
  project: Project,
  input: { provider: Provider; model: string; reasoningEffort: ReasoningEffort },
): Promise<RunAccepted> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${project.id}/agent-runs`,
    {
      method: "POST",
      body: JSON.stringify({
        requirementText: project.requirementText,
        locale: "ko-KR",
        jurisdictionCode: "KR",
        modelSelection: input,
        budget: {
          maxDurationSeconds: 180,
          maxModelCalls: 12,
          maxToolCalls: 12,
          maxInputTokens: 50000,
          maxOutputTokens: 12000,
          maxDepartments: 3,
          maxHierarchyDepth: 2,
          maxSearchCredits: 2,
          maxRetries: 2,
          maxHandoffs: 3,
        },
        safetyContext: {
          externalSideEffect: false,
          sensitiveData: false,
          financialAuthorityRequired: false,
          legalAuthorityRequired: false,
          irreversibleAction: false,
          approvalRequired: false,
          authorityVerified: false,
        },
      }),
    },
    session.accessToken,
  );
}

export function getAgentRun(session: AuthSession, runId: string): Promise<AgentRunView> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}`,
    {},
    session.accessToken,
  );
}

export function suggestQuotationAssumption(
  session: AuthSession,
  projectId: string,
  input: {
    itemTitle: string;
    itemDescription: string;
    quantity: number;
    unit: WorkUnit;
    currentAssumption: string;
    modelSelection: { provider: Provider; model: string; reasoningEffort: ReasoningEffort };
  },
): Promise<QuotationAssumptionSuggestion> {
  return request<QuotationAssumptionSuggestion>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/quotations/assumption-suggestions`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
  );
}

export function getLatestProjectAgentRun(session: AuthSession, projectId: string): Promise<AgentRunView | null> {
  return request<AgentRunView | undefined>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/agent-runs/latest`,
    {},
    session.accessToken,
  ).then((run) => run ?? null);
}

export function cancelActiveProjectAgentRuns(session: AuthSession, projectId: string): Promise<void> {
  return request<void>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/agent-runs/cancel-active`,
    { method: "POST" },
    session.accessToken,
  );
}

export function getAgentRunUsage(session: AuthSession, runId: string): Promise<AgentRunUsage> {
  return request(`/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}/usage`, {}, session.accessToken);
}

export function listModelPricing(session: AuthSession): Promise<ModelPricing[]> {
  return queryCached(
    `model-pricing:${session.workspaceId}`,
    () => request(`/api/v2/workspaces/${session.workspaceId}/model-pricing`, {}, session.accessToken),
  );
}

export function createModelPricing(session: AuthSession, input: ModelPricingInput): Promise<ModelPricing> {
  return request<ModelPricing>(
    `/api/v2/workspaces/${session.workspaceId}/model-pricing`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken,
  ).then((pricing) => { invalidateQueries(`model-pricing:${session.workspaceId}`); return pricing; });
}

export function cancelAgentRun(session: AuthSession, runId: string): Promise<AgentRunView> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}/cancel`,
    { method: "POST" },
    session.accessToken,
  );
}

export function resumeAgentRun(
  session: AuthSession,
  runId: string,
  interruptionId: string,
  answers: string[],
): Promise<RunAccepted> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}/responses`,
    {
      method: "POST",
      body: JSON.stringify({
        interruptionId,
        idempotencyKey: `web-${crypto.randomUUID()}`,
        answers: answers.map((answer, questionIndex) => ({ questionIndex, answer })),
      }),
    },
    session.accessToken,
  );
}

export async function streamRunEvents(
  session: AuthSession,
  runId: string,
  onEvent: (event: WorkflowEvent) => void,
  signal: AbortSignal,
  lastEventId?: number,
  onConnected?: () => void,
): Promise<void> {
  const headers = new Headers({
    Accept: "text/event-stream",
    Authorization: `Bearer ${session.accessToken}`,
  });
  if (lastEventId != null && lastEventId > 0) headers.set("Last-Event-ID", String(lastEventId));
  const response = await fetch(
    `${apiBaseUrl()}/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}/events`,
    {
      headers,
      signal,
    },
  );
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!response.ok || !response.body || !contentType.includes("text/event-stream")) {
    throw new Error("실시간 실행 스트림에 연결하지 못했습니다.");
  }
  onConnected?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const packets = buffer.split(/\r?\n\r?\n/);
    buffer = packets.pop() ?? "";
    for (const packet of packets) {
      const data = packet
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as WorkflowEvent);
      } catch {
        // Ignore malformed public events and keep the stream alive.
      }
    }
  }
}
