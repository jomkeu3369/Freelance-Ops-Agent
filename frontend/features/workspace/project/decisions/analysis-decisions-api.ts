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
export function getLatestAnalysisSource(session: AuthSession, projectId: string): Promise<AnalysisSource | null> {
  return request(`${base(session, projectId)}/sources/latest`, { cache: "no-store" }, session.accessToken);
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
