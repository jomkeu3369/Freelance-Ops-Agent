import type { AuthSession } from "./contracts/auth";
import type {
  Quotation,
  QuotationItemInput,
  QuotationPage,
  QuotationPreview,
  QuotationScenario
} from "./contracts/quotations";
import { invalidateQueries, queryCached } from "../query-cache";
import { request } from "./http";

export function listQuotationPage(session: AuthSession, projectId: string, cursor: string | null = null): Promise<QuotationPage> {
  const parameters = new URLSearchParams({ limit: "50" });
  if (cursor) parameters.set("cursor", cursor);
  return queryCached(`quotations:${session.workspaceId}:${projectId}:page:${parameters}`, () =>
    request(
      `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/quotations/page?${parameters}`,
      {},
      session.accessToken
    )
  );
}

export function getQuotation(session: AuthSession, quotationId: string): Promise<Quotation> {
  return request(`/api/v2/workspaces/${session.workspaceId}/quotations/${quotationId}`, {}, session.accessToken);
}

export async function getProjectQuotation(session: AuthSession, projectId: string, quotationId: string): Promise<Quotation> {
  const quotation = await getQuotation(session, quotationId);
  if (quotation.workspaceId !== session.workspaceId || quotation.projectId !== projectId) {
    throw new Error("프로젝트에 속한 견적을 확인할 수 없습니다.");
  }
  return quotation;
}

export function getLatestQuotation(session: AuthSession, quotationId: string): Promise<Quotation> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/quotations/${quotationId}/latest`,
    { cache: "no-store" },
    session.accessToken
  );
}

export function createQuotation(session: AuthSession, projectId: string, input: { scenario: QuotationScenario; currency: string; taxRate: number; applyDefaultRiskBuffer: boolean; validUntil: string | null; items: QuotationItemInput[]; }): Promise<Quotation> {
  return request<Quotation>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/quotations`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken
  ).then((quotation) => {
    invalidateQueries(`quotations:${session.workspaceId}:${projectId}`);
    return quotation;
  });
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
    session.accessToken
  ).then((quotation) => {
    invalidateQueries(`quotations:${session.workspaceId}`);
    return quotation;
  });
}

export function reviseQuotation(session: AuthSession, quotationId: string, input: { scenario: QuotationScenario; currency: string; taxRate: number; applyDefaultRiskBuffer: boolean; validUntil: string | null; items: QuotationItemInput[]; }): Promise<Quotation> {
  return request<Quotation>(
    `/api/v2/workspaces/${session.workspaceId}/quotations/${quotationId}/revisions`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken
  ).then((quotation) => {
    invalidateQueries(`quotations:${session.workspaceId}`);
    return quotation;
  });
}
