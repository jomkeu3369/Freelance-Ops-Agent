import { FREE_USAGE_EXHAUSTED } from "./free-usage.mjs";
import { clearQueryCache, invalidateQueries, queryCached } from "./query-cache";

export type Provider = "OPENAI";
export type RecordedProvider = Provider | "GEMINI";
export function isSupportedProvider(provider: RecordedProvider): provider is Provider { return provider === "OPENAI"; }
export type ReasoningEffort = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type AgentRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_USER"
  | "COMPLETED"
  | "PARTIAL"
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

// A pending registration is deliberately not an authenticated session.
export interface EmailVerificationRequired {
  userId: null;
  workspaceId: null;
  accessToken: null;
  accessTokenExpiresAt: null;
  refreshToken: null;
  refreshTokenExpiresAt: null;
  tokenType: "EmailVerificationRequired";
}
export type RegistrationResult = AuthSession | EmailVerificationRequired;
export function isEmailVerificationRequired(result: RegistrationResult): result is EmailVerificationRequired {
  return result.tokenType === "EmailVerificationRequired";
}

export interface ServiceNotice {
  id: string;
  kind: "OPERATIONAL" | "TERMS_VERSION" | "PRIVACY_VERSION";
  title: string;
  body: string;
  versionLabel: string;
  effectiveAt: string | null;
  publishAt: string | null;
  status: "DRAFT" | "REVIEWED" | "PUBLISHED";
  contentHash: string;
  revision: number;
}
export interface NoticeCampaign {
  id: string;
  noticeId: string;
  status: "DRAFT" | "QUEUED" | "CANCELLED" | "COMPLETED";
  contentHash: string;
  recipientHash: string;
  recipientCount: number;
  snapshotTitle: string;
  snapshotVersionLabel: string;
  snapshotBody?: string;
  testStatus: null | "BLOCKED_TRANSPORT" | "ACCEPTED" | "RETRYABLE_FAILED" | "PERMANENT_FAILED" | "UNKNOWN" | "BOUNCED";
  createdAt: string;
  deliveries: Record<string, number>;
}
export interface NoticeAdministration {
  notices: ServiceNotice[];
  campaigns: NoticeCampaign[];
  transportReady: boolean;
}
export type NoticeInput = Pick<ServiceNotice, "kind" | "title" | "body" | "versionLabel" | "effectiveAt">;

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

export interface MemorySourceMessage {
  id: string;
  eventOrder: number;
  kind: string;
  content: string;
  prompt: string | null;
  createdAt: string;
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
  origin: "user" | "agent" | "external";
  memoryType: string;
  confirmationStatus: "confirmed" | "unconfirmed" | "superseded";
  retrievalEligible: boolean;
  projectId: string | null;
  sourceRunId: string | null;
  sourceMessageIds: string[];
  parentDocumentIds: string[];
  supersedes: string | null;
  revisionNumber: number;
  confirmedBy: string | null;
  confirmedAt: string | null;
  sourceMessages: MemorySourceMessage[];
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
  petPerspective?: { proposal: string; rationale: string; tradeoff: string } | null;
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
    quotationDrafts: AgentQuotationDraft[];
  } | null;
  errorCode: string | null;
  metadata: {
    petProfiles?: PetProfile[];
    credentialId?: string | null;
    provider: RecordedProvider;
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
  provider: RecordedProvider;
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

export interface EstimationPolicyProposal {
  proposalId: string;
  projectId: string;
  sourceMessage: string;
  status: "PENDING" | "APPLIED" | "EXPIRED";
  before: EstimationPolicy;
  after: EstimationPolicy;
  confirmationToken: string;
  expiresAt: string;
  appliedAt: string | null;
  createdAt: string;
}

export interface AgentRunHistoryItem {
  runId: string;
  requirementText: string;
  status: AgentRunStatus;
  createdAt: string;
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
  items: Omit<QuotationItem, "rateCardId">[];
}

const SESSION_KEY = "freelance-ops-session-v1";
const SESSION_RECOVERY_EVENT = "freelance-ops-session-recovery";
let refreshPromise: Promise<AuthSession> | null = null;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null, readonly metadata: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "ApiError";
  }
}

export function isFreeUsageExhausted(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === FREE_USAGE_EXHAUSTED;
}

const FREE_USAGE_EVENT = "freelance-ops-free-usage-exhausted";
export function subscribeToFreeUsageExhausted(listener: (error: ApiError) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ApiError>).detail);
  window.addEventListener(FREE_USAGE_EVENT, handler);
  return () => window.removeEventListener(FREE_USAGE_EVENT, handler);
}

export interface CreditModelRate { provider: string; model: string; credits: number; enabled: boolean; }
export interface CreditQuote { credits: number; pricingUpdatedAt: string; }
export function isCreditQuoteRefreshRequired(error: unknown): error is ApiError {
  return error instanceof ApiError && ["CREDIT_QUOTE_REQUIRED", "CREDIT_QUOTE_STALE", "PLATFORM_MODEL_UNAVAILABLE"].includes(error.code ?? "");
}

export function isPlatformSpendUnavailable(error: unknown): error is ApiError {
  return error instanceof ApiError && ["PLATFORM_SPEND_EXHAUSTED", "PLATFORM_SPEND_DISABLED"].includes(error.code ?? "");
}

export interface FreeUsage {
  unit?: "CREDITS";
  periodType?: "WEEKLY";
  modelRates?: CreditModelRate[];
  pricingUpdatedAt?: string;
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  resetAt: string;
  period: string;
  timezone: string;
  epoch: number;
  canManage: boolean;
}

export interface FreeUsageSettings {
  unit?: "CREDITS";
  periodType?: "WEEKLY";
  modelRates?: CreditModelRate[];
  limit: number;
  maxLimit: number;
  epoch: number;
  updatedAt: string;
  lastResetAt: string | null;
}

export function getFreeUsage(session: AuthSession): Promise<FreeUsage> {
  return request("/api/v2/usage/free", { cache: "no-store" }, session.accessToken);
}

export function getFreeUsageSettings(session: AuthSession): Promise<FreeUsageSettings> {
  return request("/api/v2/admin/free-usage", { cache: "no-store" }, session.accessToken);
}

export function updateFreeUsageLimit(session: AuthSession, settings: FreeUsageSettings, limit: number): Promise<FreeUsageSettings> {
  return request("/api/v2/admin/free-usage", {
    method: "PATCH", body: JSON.stringify({ limit, expectedEpoch: settings.epoch, expectedUpdatedAt: settings.updatedAt })
  }, session.accessToken);
}

export function updateFreeModelRate(session: AuthSession, settings: FreeUsageSettings, rate: CreditModelRate): Promise<FreeUsageSettings> {
  return request("/api/v2/admin/free-usage/models", {
    method: "PATCH", body: JSON.stringify({ ...rate, expectedEpoch: settings.epoch, expectedUpdatedAt: settings.updatedAt })
  }, session.accessToken);
}

export function resetAllFreeUsage(session: AuthSession, settings: FreeUsageSettings): Promise<FreeUsageSettings> {
  return request("/api/v2/admin/free-usage/reset", {
    method: "POST", body: JSON.stringify({ confirmation: "RESET_ALL_FREE_USAGE", expectedEpoch: settings.epoch, expectedUpdatedAt: settings.updatedAt })
  }, session.accessToken);
}

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").trim().replace(/\/$/, "");
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
    let metadata: Record<string, unknown> = {};
    try {
      const problem: unknown = await response.json();
      if (problem && typeof problem === "object" && !Array.isArray(problem)) {
        metadata = problem as Record<string, unknown>;
        const publicMessage = metadata.detail ?? metadata.message ?? metadata.title;
        if (typeof publicMessage === "string") message = publicMessage;
      }
    } catch {
      // Keep the public-safe fallback message.
    }
    const error = new ApiError(message, response.status, typeof metadata.code === "string" ? metadata.code : null, metadata);
    if (isFreeUsageExhausted(error) && typeof window !== "undefined" && loadSession()?.accessToken === token) {
      window.dispatchEvent(new CustomEvent<ApiError>(FREE_USAGE_EVENT, { detail: error }));
    }
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function register(input: {
  email: string;
  password: string;
  displayName: string;
  workspaceName: string;
  ageAtLeast14: boolean;
}): Promise<RegistrationResult> {
  return request("/api/v2/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function requestEmailVerification(email: string): Promise<{ status: "IF_ELIGIBLE_CHECK_EMAIL" }> {
  return request("/api/v2/auth/email-verification/request", { method: "POST", body: JSON.stringify({ email }), cache: "no-store" }, undefined, false);
}
export function confirmEmailVerification(token: string, password: string): Promise<{ status: "VERIFIED" }> {
  return request("/api/v2/auth/email-verification/confirm", { method: "POST", body: JSON.stringify({ token, password }), cache: "no-store" }, undefined, false);
}
export function listPublicNotices(): Promise<ServiceNotice[]> {
  return request("/api/v2/notices", { cache: "no-store" });
}
export function getNoticeAdministration(session: AuthSession): Promise<NoticeAdministration> {
  return request("/api/v2/admin/notices", { cache: "no-store" }, session.accessToken);
}
export function createNotice(session: AuthSession, input: NoticeInput): Promise<ServiceNotice> {
  return request("/api/v2/admin/notices", { method: "POST", body: JSON.stringify(input) }, session.accessToken);
}
export function reviewNotice(session: AuthSession, notice: ServiceNotice): Promise<ServiceNotice> {
  return request(`/api/v2/admin/notices/${encodeURIComponent(notice.id)}/review`, { method: "POST", body: JSON.stringify({ expectedRevision: notice.revision }) }, session.accessToken);
}
export function publishNotice(session: AuthSession, notice: ServiceNotice, publishAt: string): Promise<ServiceNotice> {
  return request(`/api/v2/admin/notices/${encodeURIComponent(notice.id)}/publish`, { method: "POST", body: JSON.stringify({ expectedRevision: notice.revision, publishAt, confirmation: "PUBLISH_NOTICE" }) }, session.accessToken);
}
export function prepareNoticeCampaign(session: AuthSession, noticeId: string): Promise<NoticeCampaign> {
  return request("/api/v2/admin/notice-campaigns", { method: "POST", body: JSON.stringify({ noticeId }) }, session.accessToken);
}
export function testNoticeCampaign(session: AuthSession, id: string): Promise<NoticeCampaign> {
  return request(`/api/v2/admin/notice-campaigns/${encodeURIComponent(id)}/test`, { method: "POST" }, session.accessToken);
}
export function confirmNoticeCampaign(session: AuthSession, campaign: NoticeCampaign): Promise<NoticeCampaign> {
  return request(`/api/v2/admin/notice-campaigns/${encodeURIComponent(campaign.id)}/confirm`, { method: "POST", body: JSON.stringify({ contentHash: campaign.contentHash, recipientHash: campaign.recipientHash, recipientCount: campaign.recipientCount, confirmation: "QUEUE_OPERATIONAL_NOTICE" }) }, session.accessToken);
}
export function cancelNoticeCampaign(session: AuthSession, id: string): Promise<NoticeCampaign> {
  return request(`/api/v2/admin/notice-campaigns/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({}) }, session.accessToken);
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

export function listProjects(session: AuthSession, search = ""): Promise<Project[]> {
  const normalizedSearch = search.trim();
  const query = normalizedSearch ? `?search=${encodeURIComponent(normalizedSearch)}` : "";
  return queryCached(
    `projects:${session.workspaceId}:${normalizedSearch.toLocaleLowerCase()}`,
    () => request(`/api/v2/workspaces/${session.workspaceId}/projects${query}`, {}, session.accessToken)
  );
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

// Bypass cached lists when a failed write may still have reached the server.
export function readProject(session: AuthSession, projectId: string): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}`,
    { cache: "no-store" },
    session.accessToken
  ).then((project) => { invalidateQueries(`projects:${session.workspaceId}`); invalidateQueries(`documents:${session.workspaceId}`); invalidateQueries(`document:${session.workspaceId}:`); return project; });
}

export function updateProject(session: AuthSession, project: Project, status: ProjectStatus): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${project.id}/status`,
    { method: "PATCH", body: JSON.stringify({ status }) },
    session.accessToken
  ).then((updated) => { invalidateQueries(`projects:${session.workspaceId}`); invalidateQueries(`documents:${session.workspaceId}`); invalidateQueries(`document:${session.workspaceId}:`); return updated; });
}

export function updateProjectDetails(session: AuthSession, project: Project, input: ProjectInput): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${project.id}`,
    { method: "PATCH", body: JSON.stringify({ ...input, status: project.status }) },
    session.accessToken,
  ).then((updated) => { invalidateQueries(`projects:${session.workspaceId}`); invalidateQueries(`documents:${session.workspaceId}`); invalidateQueries(`document:${session.workspaceId}:`); return updated; });
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
  ).then((version) => { invalidateQueries(`requirements:${session.workspaceId}:${projectId}`); invalidateQueries(`documents:${session.workspaceId}`); invalidateQueries(`document:${session.workspaceId}:`); return version; });
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

export function getCurrentEstimationPolicy(session: AuthSession): Promise<EstimationPolicy> {
  return request(`/api/v2/workspaces/${session.workspaceId}/estimation-policy`, { cache: "no-store" }, session.accessToken);
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

export async function confirmDocument(session: AuthSession, document: KnowledgeDocument): Promise<{ document: KnowledgeDocument; indexStatus: "INDEXED" | "PENDING" | "KEYWORD_ONLY" }> {
  const result = await request<{ document: KnowledgeDocument; indexStatus: "INDEXED" | "PENDING" | "KEYWORD_ONLY" }>(
    `/api/v2/workspaces/${session.workspaceId}/documents/${document.id}/confirm`,
    { method: "POST", body: JSON.stringify({ expectedVersion: document.version }) },
    session.accessToken
  );
  invalidateQueries(`documents:${session.workspaceId}`);
  invalidateQueries(`document:${session.workspaceId}:${document.id}`);
  return result;
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

export interface QuotationPreview {
  subtotal: number;
  discountTotal: number;
  riskBufferRate: number;
  riskBufferAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  items: Array<{ subtotal: number; discountAmount: number; total: number }>;
}

export function previewQuotation(session: AuthSession, projectId: string, input: Parameters<typeof createQuotation>[2]): Promise<QuotationPreview> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/quotations/preview`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken
  );
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
  input: { provider: Provider; model: string; reasoningEffort: ReasoningEffort; credentialId?: string | null },
  message?: string,
  idempotencyKey: string = crypto.randomUUID(),
  creditQuote?: CreditQuote,
): Promise<RunAccepted> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${project.id}/agent-runs`,
    {
      method: "POST",
      // Generated once per submission; request() preserves this header during auth recovery.
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        requirementText: message ?? project.requirementText,
        locale: "ko-KR",
        jurisdictionCode: "KR",
        modelSelection: input,
        ...(!input.credentialId && creditQuote ? { creditQuote } : {}),
        budget: {
          maxDurationSeconds: 180,
          maxModelCalls: 50,
          maxToolCalls: 12,
          maxInputTokens: 50000,
          maxOutputTokens: 48000,
          maxDepartments: 4,
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

export function listProjectAgentRunHistory(session: AuthSession, projectId: string): Promise<AgentRunHistoryItem[]> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/agent-runs/history?limit=20`,
    { cache: "no-store" },
    session.accessToken,
  );
}

export function proposeEstimationPolicy(session: AuthSession, input: {
  projectId: string;
  sourceMessage: string;
  defaultTaxRate: number;
  defaultRiskBufferRate: number;
  maximumDiscountRate: number;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<EstimationPolicyProposal> {
  return request(`/api/v2/workspaces/${session.workspaceId}/estimation-policy/proposals`,
    { method: "POST", body: JSON.stringify(input) }, session.accessToken);
}

export function listProjectEstimationPolicyProposals(session: AuthSession, projectId: string): Promise<EstimationPolicyProposal[]> {
  return request(`/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/estimation-policy/proposals`,
    { cache: "no-store" }, session.accessToken);
}

export function getEstimationPolicyProposal(session: AuthSession, proposalId: string): Promise<EstimationPolicyProposal> {
  return request(`/api/v2/workspaces/${session.workspaceId}/estimation-policy/proposals/${proposalId}`,
    { cache: "no-store" }, session.accessToken);
}

export function confirmEstimationPolicyProposal(session: AuthSession, proposalId: string, confirmationToken: string): Promise<EstimationPolicyProposal> {
  return request<EstimationPolicyProposal>(`/api/v2/workspaces/${session.workspaceId}/estimation-policy/proposals/${proposalId}/confirm`,
    { method: "POST", body: JSON.stringify({ confirmationToken }) }, session.accessToken)
    .then((proposal: EstimationPolicyProposal) => { invalidateQueries(`estimation-policy:${session.workspaceId}`); return proposal; });
}

export async function getAgentRun(session: AuthSession, runId: string): Promise<AgentRunView> {
  const result = await request<AgentRunView>(
    `/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}`,
    {},
    session.accessToken,
  );
  if (result.status === "COMPLETED") invalidateQueries(`documents:${session.workspaceId}`);
  return result;
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
    modelSelection: { provider: Provider; model: string; reasoningEffort: ReasoningEffort; credentialId?: string | null };
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

export interface AIConnection { id: string; provider: RecordedProvider; model: string; maskedKey: string; updatedAt: string }
export interface AIConnections { available: boolean; models: Record<Provider, string[]>; connections: AIConnection[] }
export function listAIConnections(session: AuthSession): Promise<AIConnections> {
  return request(`/api/v2/workspaces/${session.workspaceId}/ai-connections`, { cache: "no-store" }, session.accessToken);
}
export function saveAIConnection(session: AuthSession, provider: Provider, model: string, apiKey: string): Promise<AIConnection> {
  // A key must never be replayed using a different recovered login session.
  return request(`/api/v2/workspaces/${session.workspaceId}/ai-connections/${provider}`, { method: "PUT", body: JSON.stringify({ model, apiKey }), cache: "no-store" }, session.accessToken, false);
}
export function deleteAIConnection(session: AuthSession, id: string): Promise<void> {
  return request(`/api/v2/workspaces/${session.workspaceId}/ai-connections/${id}`, { method: "DELETE", cache: "no-store" }, session.accessToken);
}

export interface PetProfile {
  petId?: string | null;
  duty?: "GENERAL" | "SCHEDULE" | "RESEARCH" | "WRITING" | "DEVELOPMENT" | "DESIGN";
  skillMode?: "AUTO";
  preferences?: { personality: string; communication: string; focus: string; responsibility: string; requests: string[] };
  slot: "LEAN" | "RECOMMENDED" | "EXPANDED";
  name: string;
  animal: "turtle" | "owl" | "cat";
  color: "sage" | "lavender" | "peach" | "sky" | "rose" | "ink";
  accessory: "none" | "glasses" | "scarf" | "star";
  tone: "WARM" | "DIRECT" | "FORMAL";
  valuePriority: "PROFIT" | "BALANCED" | "RELATIONSHIP";
  deliveryPriority: "SPEED" | "BALANCED" | "QUALITY";
  scopePriority: "CAUTIOUS" | "BALANCED" | "EXPLORATORY";
}
export function listPets(session: AuthSession): Promise<PetProfile[]> {
  return request(`/api/v2/workspaces/${session.workspaceId}/pets`, { cache: "no-store" }, session.accessToken);
}
export interface CustomAgentPet { id: string; profile: PetProfile; archived: boolean; revision: number }
export interface AgentPetCollection {
  pets: CustomAgentPet[]; selectedPetId: string | null; maxActivePets: number; maxStoredPets: number;
  maxPromptLength: number; maxPreferenceRequests: number; generationMode: "RULE_BASED_PREVIEW"; aiGenerationAvailable: boolean;
}
export interface ComposeAgentPet { id: string; mutationId: string; expectedRevision: number; description: string; resetPreferences: boolean }
export function listAgentPets(session: AuthSession): Promise<AgentPetCollection> {
  return request(`/api/v2/workspaces/${session.workspaceId}/agent-pets`, { cache: "no-store" }, session.accessToken);
}
export function previewAgentPet(session: AuthSession, input: ComposeAgentPet): Promise<PetProfile> {
  return request(`/api/v2/workspaces/${session.workspaceId}/agent-pets/preview`, { method: "POST", body: JSON.stringify(input) }, session.accessToken, false);
}
export function saveAgentPet(session: AuthSession, input: ComposeAgentPet): Promise<CustomAgentPet> {
  return request(`/api/v2/workspaces/${session.workspaceId}/agent-pets`, { method: "POST", body: JSON.stringify(input) }, session.accessToken, false);
}
export function changeAgentPet(session: AuthSession, pet: CustomAgentPet, action: "SELECT" | "ARCHIVE" | "RESTORE"): Promise<void> {
  return request(`/api/v2/workspaces/${session.workspaceId}/agent-pets/${pet.id}`, { method: "PATCH", body: JSON.stringify({ action, expectedRevision: pet.revision }) }, session.accessToken, false);
}
export function deleteAgentPet(session: AuthSession, pet: CustomAgentPet): Promise<void> {
  return request(`/api/v2/workspaces/${session.workspaceId}/agent-pets/${pet.id}?revision=${pet.revision}`, { method: "DELETE" }, session.accessToken, false);
}
export function savePet(session: AuthSession, profile: PetProfile): Promise<PetProfile> {
  return request(`/api/v2/workspaces/${session.workspaceId}/pets`, { method: "PUT", body: JSON.stringify(profile) }, session.accessToken, false);
}
export function generatePet(session: AuthSession, projectId: string, input: { slot: PetProfile["slot"]; description: string; modelSelection: { provider: Provider; model: string; reasoningEffort: ReasoningEffort; credentialId?: string } }): Promise<{ profile: PetProfile; provider: Provider; model: string; inputTokens: number; outputTokens: number }> {
  return request(`/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/pet-generations`, { method: "POST", body: JSON.stringify(input) }, session.accessToken, false);
}
