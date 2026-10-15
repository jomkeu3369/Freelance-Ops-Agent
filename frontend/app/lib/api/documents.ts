import type { AuthSession } from "./contracts/auth";
import type { KnowledgeDocument } from "./contracts/knowledge";
import { invalidateQueries, queryCached } from "../query-cache";
import { request } from "./http";

export function listDocuments(session: AuthSession): Promise<KnowledgeDocument[]> {
  return queryCached(`documents:${session.workspaceId}`, () =>
    request(`/api/v2/workspaces/${session.workspaceId}/documents`, {}, session.accessToken)
  );
}

export function getDocument(session: AuthSession, documentId: string): Promise<KnowledgeDocument> {
  return queryCached(`document:${session.workspaceId}:${documentId}`, () =>
    request(`/api/v2/workspaces/${session.workspaceId}/documents/${documentId}`, {}, session.accessToken)
  );
}

export function createDocument(session: AuthSession, input: { sourceType: KnowledgeDocument["sourceType"]; title: string; sourceUri: string | null; sourceVersion: string | null; jurisdiction: string | null; effectiveFrom: string | null; effectiveUntil: string | null; chunks: Array<{ content: string; embedding: null; embeddingModel: null; startOffset: number; endOffset: number }>; }): Promise<KnowledgeDocument> {
  return request<KnowledgeDocument>(
    `/api/v2/workspaces/${session.workspaceId}/documents`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken
  ).then((document) => {
    invalidateQueries(`documents:${session.workspaceId}`);
    return document;
  });
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
    session.accessToken
  ).then(() => {
    invalidateQueries(`documents:${session.workspaceId}`);
    invalidateQueries(`document:${session.workspaceId}:${documentId}`);
  });
}
