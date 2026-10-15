import type { AuthSession } from "./contracts/auth";
import type { ProposalShare, SharedProposal } from "./contracts/outcomes";
import { request } from "./http";

export function createProposalShare(session: AuthSession, quotationId: string, expiresInDays = 14): Promise<ProposalShare> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/quotations/${quotationId}/shares`,
    { method: "POST", body: JSON.stringify({ expiresInDays }) },
    session.accessToken
  );
}

export function revokeProposalShare(session: AuthSession, shareId: string): Promise<void> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/proposal-shares/${shareId}`,
    { method: "DELETE" },
    session.accessToken
  );
}

export function getSharedProposal(token: string): Promise<SharedProposal> {
  return request(`/api/v2/proposals/${encodeURIComponent(token)}`);
}

export function submitProposalDecision(token: string, input: { decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED"; clientName: string; clientEmail: string; comment: string; }): Promise<{
  decisionId: string;
  quotationId: string;
  decision: string;
  clientName: string;
  comment: string;
  decidedAt: string;
}> {
  return request(`/api/v2/proposals/${encodeURIComponent(token)}/decisions`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
