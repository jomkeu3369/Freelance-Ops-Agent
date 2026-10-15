import type { SkillSelection } from "../../../features/workspace/skills/skill-selection";
import type {
  AgentRunHistoryItem,
  AgentRunUsage,
  AgentRunView,
  Provider,
  ReasoningEffort,
  RunAccepted
} from "./contracts/agents";
import type { AuthSession } from "./contracts/auth";
import type { Project } from "./contracts/projects";
import type { CreditQuote } from "./contracts/usage";
import { byokCostEstimate, byokCostNoticeVersion, byokFailureMessage } from "../byok-presentation.mjs";
import { invalidateQueries } from "../query-cache";
import { ApiError, request } from "./http";

export function startAgentRun(session: AuthSession, project: Project, input: { provider: Provider; model: string; reasoningEffort: ReasoningEffort; credentialId?: string | null }, message?: string, idempotencyKey: string = crypto.randomUUID(), creditQuote?: CreditQuote, attachmentIds?: string[], skillSelection?: SkillSelection, workflowMode?: "PROJECT_ANALYSIS" | "AD_HOC"): Promise<RunAccepted> {
  if (input.credentialId && !byokCostEstimate(input.provider, input.model)) {
    return Promise.reject(
      new ApiError(byokFailureMessage("BYOK_COST_NOTICE_REFRESH_REQUIRED")!, 409, "BYOK_COST_NOTICE_REFRESH_REQUIRED")
    );
  }
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${project.id}/agent-runs`,
    {
      method: "POST",
      // 제출마다 한 번만 생성하며 인증 복구 중에도 같은 요청 키를 유지한다.
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        requirementText: message ?? project.requirementText,
        ...(attachmentIds?.length ? { attachmentIds } : {}),
        ...(skillSelection ? { skillSelection } : {}),
        ...(workflowMode ? { workflowMode } : {}),
        locale: "ko-KR",
        jurisdictionCode: "KR",
        modelSelection: input,
        ...(input.credentialId ? { byokCostNoticeVersion } : {}),
        ...(!input.credentialId && creditQuote ? { creditQuote } : {}),
        budget: {
          maxDurationSeconds: 180,
          maxModelCalls: 50,
          maxToolCalls: 12,
          maxInputTokens: input.credentialId ? 150000 : 50000,
          maxOutputTokens: 48000,
          maxDepartments: 4,
          maxHierarchyDepth: 2,
          maxSearchCredits: 2,
          maxRetries: 2,
          maxHandoffs: 3
        },
        safetyContext: {
          externalSideEffect: false,
          sensitiveData: false,
          financialAuthorityRequired: false,
          legalAuthorityRequired: false,
          irreversibleAction: false,
          approvalRequired: false,
          authorityVerified: false
        }
      })
    },
    session.accessToken
  );
}

export function listProjectAgentRunHistory(session: AuthSession, projectId: string): Promise<AgentRunHistoryItem[]> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/agent-runs/history?limit=20`,
    { cache: "no-store" },
    session.accessToken
  );
}

export async function getAgentRun(session: AuthSession, runId: string): Promise<AgentRunView> {
  const result = await request<AgentRunView>(
    `/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}`,
    {},
    session.accessToken
  );
  if (result.status === "COMPLETED") invalidateQueries(`documents:${session.workspaceId}`);
  return result;
}

export function getLatestProjectAgentRun(session: AuthSession, projectId: string): Promise<AgentRunView | null> {
  return request<AgentRunView | undefined>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/agent-runs/latest`,
    {},
    session.accessToken
  ).then((run) => run ?? null);
}

export function getAgentRunUsage(session: AuthSession, runId: string): Promise<AgentRunUsage> {
  return request(`/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}/usage`, {}, session.accessToken);
}

export function cancelAgentRun(session: AuthSession, runId: string): Promise<AgentRunView> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}/cancel`,
    { method: "POST" },
    session.accessToken
  );
}

export function resumeAgentRun(session: AuthSession, runId: string, interruptionId: string, answers: string[]): Promise<RunAccepted> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/agent-runs/${runId}/responses`,
    {
      method: "POST",
      body: JSON.stringify({
        interruptionId,
        idempotencyKey: `web-${crypto.randomUUID()}`,
        answers: answers.map((answer, questionIndex) => ({ questionIndex, answer }))
      })
    },
    session.accessToken
  );
}
