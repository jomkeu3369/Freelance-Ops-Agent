import { invalidateQueries } from "@/app/lib/query-cache";
import { request, type AgentQuotationDraft, type AgentRunView, type AuthSession, type MemorySourceMessage, type PetProfile } from "@/app/lib/api";

export interface AnalysisDecision {
  id: string; workspaceId: string; projectId: string; familyId: string; previousId: string | null;
  versionNumber: number; status: "DRAFT" | "CONFIRMED"; sourceRunId: string; sourceProjectVersion: number;
  selectedOpinionIds: string[];
  sourceOpinions: { opinionId: string; scenario: AgentQuotationDraft["scenario"]; draft: AgentQuotationDraft }[];
  sourcePetProfiles: PetProfile[]; sourceSummary: string; sourceOpenQuestions: string[];
  sourceMessages: MemorySourceMessage[]; sourceEventOrder: number; reviewWarnings: string[];
  originalBodyText: string; bodyText: string; contentHash: string; bodyOrigin: "SELECTED_OPINIONS" | "USER_EDITED";
  createdBy: string; createdAt: string; confirmedBy: string | null; confirmedAt: string | null;
}

export interface AnalysisSource { runId: string; sourceProjectVersion: number | null; view: AgentRunView; }
export interface CreateDecisionInput { requestId: string; sourceRunId: string; expectedProjectVersion: number; selectedOpinionIds: string[]; }
export interface ReviseDecisionInput { requestId: string; expectedContentHash: string; bodyText: string; }

function base(session: AuthSession, projectId: string) {
  return `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/analysis-decisions`;
}

export function listAnalysisDecisions(session: AuthSession, projectId: string): Promise<AnalysisDecision[]> {
  return request(base(session, projectId), { cache: "no-store" }, session.accessToken);
}
export function getAnalysisDecision(session: AuthSession, projectId: string, id: string): Promise<AnalysisDecision> {
  return request(`${base(session, projectId)}/${id}`, { cache: "no-store" }, session.accessToken);
}
export async function getLatestAnalysisSource(session: AuthSession, projectId: string): Promise<AnalysisSource | null> {
  const value = await request<AnalysisSource | null>(`${base(session, projectId)}/sources/latest`, { cache: "no-store" }, session.accessToken);
  if (value === null) return null;
  if (!value || typeof value !== "object" || typeof value.runId !== "string" || !value.runId
    || !(value.sourceProjectVersion === null || Number.isSafeInteger(value.sourceProjectVersion) && value.sourceProjectVersion >= 0)
    || !value.view || typeof value.view !== "object" || value.view.runId !== value.runId
    || !["QUEUED", "RUNNING", "WAITING_FOR_USER", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(value.view.status)) {
    throw new Error("분석 출처 응답을 확인하지 못했습니다. 잘못된 결과는 선택하거나 확정하지 않습니다.");
  }
  return value;
}
export function getLatestDecisionRevision(session: AuthSession, projectId: string, id: string): Promise<AnalysisDecision> {
  return request(`${base(session, projectId)}/${id}/latest-revision`, { cache: "no-store" }, session.accessToken);
}
export function getLatestConfirmedDecision(session: AuthSession, projectId: string): Promise<AnalysisDecision | null> {
  return request(`${base(session, projectId)}/latest-confirmed`, { cache: "no-store" }, session.accessToken);
}
export function createAnalysisDecision(session: AuthSession, projectId: string, input: CreateDecisionInput): Promise<AnalysisDecision> {
  return request(base(session, projectId), { method: "POST", body: JSON.stringify(input) }, session.accessToken);
}
export function reviseAnalysisDecision(session: AuthSession, projectId: string, id: string, input: ReviseDecisionInput): Promise<AnalysisDecision> {
  return request(`${base(session, projectId)}/${id}/revisions`, { method: "POST", body: JSON.stringify(input) }, session.accessToken);
}
export async function confirmAnalysisDecision(session: AuthSession, projectId: string, decision: AnalysisDecision): Promise<AnalysisDecision> {
  const value = await request<AnalysisDecision>(`${base(session, projectId)}/${decision.id}/confirm`, { method: "POST", body: JSON.stringify({
    expectedContentHash: decision.contentHash, confirmation: "CONFIRM_ANALYSIS_DECISION"
  }) }, session.accessToken);
  invalidateQueries(`documents:${session.workspaceId}`);
  invalidateQueries(`document:${session.workspaceId}:`);
  return value;
}
