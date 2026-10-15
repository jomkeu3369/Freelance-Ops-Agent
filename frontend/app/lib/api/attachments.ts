import type { AttachmentPreview, OcrOptions } from "./contracts/agents";
import type { AuthSession } from "./contracts/auth";
import { request } from "./http";

export function readChatAttachment(session: AuthSession, projectId: string, file: File, encoding: string, delimiter: string, signal?: AbortSignal, ocr?: OcrOptions): Promise<AttachmentPreview> {
  const body = new FormData();
  body.append("file", file);
  body.append("encoding", encoding);
  body.append("delimiter", delimiter);
  if (ocr) {
    body.append("ocrLanguage", ocr.ocrLanguage);
    body.append("ocrLayout", ocr.ocrLayout);
  }
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/attachments`,
    { method: "POST", body, signal },
    session.accessToken
  );
}

export function removeChatAttachment(session: AuthSession, projectId: string, id: string): Promise<void> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/attachments/${id}`,
    { method: "DELETE" },
    session.accessToken
  );
}
