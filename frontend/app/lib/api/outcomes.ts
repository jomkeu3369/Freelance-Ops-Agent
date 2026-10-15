import type { AuthSession } from "./contracts/auth";
import type { ActualOutcome } from "./contracts/outcomes";
import { ApiError, request } from "./http";

export async function getOutcome(session: AuthSession, projectId: string): Promise<ActualOutcome | null> {
  try {
    return await request(
      `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/outcome`,
      {},
      session.accessToken
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function saveOutcome(session: AuthSession, projectId: string, input: { approvedQuotationId: string | null; totalRevenue: number; actualCost: number; actualHours: number; completedOn: string | null; changeReason: string; workItems: Array<{ quotationItemId: string | null; title: string; actualHours: number; actualCost: number; notes: string; }>; }): Promise<ActualOutcome> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/outcome`,
    { method: "PUT", body: JSON.stringify(input) },
    session.accessToken
  );
}
