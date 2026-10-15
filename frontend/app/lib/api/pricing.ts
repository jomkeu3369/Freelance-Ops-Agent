import type { AuthSession } from "./contracts/auth";
import type { EstimationPolicy, EstimationPolicyProposal, RateCard } from "./contracts/quotations";
import { invalidateQueries, queryCached } from "../query-cache";
import { request } from "./http";

export function listRateCards(session: AuthSession): Promise<RateCard[]> {
  return queryCached(`rate-cards:${session.workspaceId}`, () =>
    request(`/api/v2/workspaces/${session.workspaceId}/rate-cards`, {}, session.accessToken)
  );
}

export function saveRateCard(session: AuthSession, rateCardId: string, input: Omit<RateCard, "id" | "workspaceId" | "version">): Promise<RateCard> {
  return request<RateCard>(
    `/api/v2/workspaces/${session.workspaceId}/rate-cards/${rateCardId}`,
    { method: "PUT", body: JSON.stringify(input) },
    session.accessToken
  ).then((card) => {
    invalidateQueries(`rate-cards:${session.workspaceId}`);
    return card;
  });
}

export function getEstimationPolicy(session: AuthSession): Promise<EstimationPolicy> {
  return queryCached(`estimation-policy:${session.workspaceId}`, () =>
    request(`/api/v2/workspaces/${session.workspaceId}/estimation-policy`, {}, session.accessToken)
  );
}

export function getCurrentEstimationPolicy(session: AuthSession): Promise<EstimationPolicy> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/estimation-policy`,
    { cache: "no-store" },
    session.accessToken
  );
}

export function saveEstimationPolicy(session: AuthSession, input: Omit<EstimationPolicy, "workspaceId" | "version">): Promise<EstimationPolicy> {
  return request<EstimationPolicy>(
    `/api/v2/workspaces/${session.workspaceId}/estimation-policy`,
    { method: "PUT", body: JSON.stringify(input) },
    session.accessToken
  ).then((policy) => {
    invalidateQueries(`estimation-policy:${session.workspaceId}`);
    return policy;
  });
}

export function proposeEstimationPolicy(session: AuthSession, input: { projectId: string; sourceMessage: string; defaultTaxRate: number; defaultRiskBufferRate: number; maximumDiscountRate: number; expectedVersion: number; idempotencyKey: string; }): Promise<EstimationPolicyProposal> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/estimation-policy/proposals`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken
  );
}

export function listProjectEstimationPolicyProposals(session: AuthSession, projectId: string): Promise<EstimationPolicyProposal[]> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/estimation-policy/proposals`,
    { cache: "no-store" },
    session.accessToken
  );
}

export function getEstimationPolicyProposal(session: AuthSession, proposalId: string): Promise<EstimationPolicyProposal> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/estimation-policy/proposals/${proposalId}`,
    { cache: "no-store" },
    session.accessToken
  );
}

export function confirmEstimationPolicyProposal(session: AuthSession, proposalId: string, confirmationToken: string): Promise<EstimationPolicyProposal> {
  return request<EstimationPolicyProposal>(
    `/api/v2/workspaces/${session.workspaceId}/estimation-policy/proposals/${proposalId}/confirm`,
    { method: "POST", body: JSON.stringify({ confirmationToken }) },
    session.accessToken
  ).then((proposal: EstimationPolicyProposal) => {
    invalidateQueries(`estimation-policy:${session.workspaceId}`);
    return proposal;
  });
}
