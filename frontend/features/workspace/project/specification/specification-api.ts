import { AuthSession, request } from "../../../../app/lib/api";
import { invalidateQueries } from "../../../../app/lib/query-cache";

export interface SpecificationSummary {
  id: string;
  revisionNumber: number;
  status: "DRAFT" | "CONFIRMED";
  title: string;
  contentHash: string;
  sourceDecisionId: string;
  sourceDecisionVersion: number;
  sourceCurrent: boolean;
  createdAt: string;
  confirmedAt: string | null;
}
export interface Specification extends SpecificationSummary {
  workspaceId: string;
  projectId: string;
  supersedes: string | null;
  bodyText: string;
  sourceDecisionHash: string;
  sourceBodyText: string;
  sourceRunId: string;
  sourceProjectVersion: number;
  sourceProvenance: Record<string, unknown>;
  originalSources: Array<{ id: string; kind: string; content: string; prompt: string | null }>;
  createdBy: string;
  confirmedBy: string | null;
  reusableDocumentId: string | null;
  indexStatus: "KEYWORD_ONLY" | "NOT_INDEXED" | "SUPERSEDED";
  downloadFileName: string;
}
function path(session: AuthSession, projectId: string) {
  return `/api/v2/workspaces/${encodeURIComponent(session.workspaceId)}/projects/${encodeURIComponent(projectId)}/specifications`;
}
export function listSpecifications(session: AuthSession, projectId: string, signal?: AbortSignal) {
  return request<SpecificationSummary[]>(path(session, projectId), { cache: "no-store", signal }, session.accessToken);
}
export function getSpecification(session: AuthSession, projectId: string, id: string, signal?: AbortSignal) {
  return request<Specification>(`${path(session, projectId)}/${encodeURIComponent(id)}`, { cache: "no-store", signal }, session.accessToken);
}
export function createSpecification(session: AuthSession, projectId: string, decisionId: string, requestId: string) {
  return request<Specification>(path(session, projectId), { method: "POST", body: JSON.stringify({ decisionId, requestId }) }, session.accessToken);
}
export function reviseSpecification(session: AuthSession, projectId: string, specification: Specification, input: { title: string; bodyText: string; requestId: string }) {
  return request<Specification>(`${path(session, projectId)}/${encodeURIComponent(specification.id)}/revisions`, {
    method: "POST", body: JSON.stringify({ ...input, expectedContentHash: specification.contentHash }),
  }, session.accessToken);
}
export function confirmSpecification(session: AuthSession, projectId: string, specification: Specification) {
  return request<Specification>(`${path(session, projectId)}/${encodeURIComponent(specification.id)}/confirm`, {
    method: "POST", body: JSON.stringify({ expectedContentHash: specification.contentHash, confirmation: "CONFIRM_SPECIFICATION" }),
  }, session.accessToken).then(result => {
    invalidateQueries(`documents:${session.workspaceId}`);
    invalidateQueries(`document:${session.workspaceId}:`);
    return result;
  });
}
export async function downloadSpecificationPdf(session: AuthSession, projectId: string, specification: Specification) {
  const blob = await request<Blob>(`${path(session, projectId)}/${encodeURIComponent(specification.id)}/pdf`, { cache: "no-store" }, session.accessToken, true, "blob");
  if (blob.type.split(";")[0] !== "application/pdf" || blob.size > 10 * 1024 * 1024 || await blob.slice(0, 5).text() !== "%PDF-")
    throw new Error("유효한 PDF 파일을 받지 못했습니다. 다시 시도해 주세요.");
  return blob;
}
