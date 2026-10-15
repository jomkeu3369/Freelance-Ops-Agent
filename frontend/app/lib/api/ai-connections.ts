import type { AIConnection, AIConnections, Provider } from "./contracts/agents";
import type { AuthSession } from "./contracts/auth";
import { request } from "./http";

export function listAIConnections(session: AuthSession): Promise<AIConnections> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/ai-connections`,
    { cache: "no-store" },
    session.accessToken
  );
}

export function saveAIConnection(session: AuthSession, provider: Provider, model: string, apiKey: string): Promise<AIConnection> {
  // 로그인이 바뀌면 이전 세션에서 제출한 키를 다시 보내지 않는다.
  return request(
    `/api/v2/workspaces/${session.workspaceId}/ai-connections/${provider}`,
    { method: "PUT", body: JSON.stringify({ model, apiKey }), cache: "no-store" },
    session.accessToken,
    false
  );
}

export function deleteAIConnection(session: AuthSession, id: string): Promise<void> {
  return request(
    `/api/v2/workspaces/${session.workspaceId}/ai-connections/${id}`,
    { method: "DELETE", cache: "no-store" },
    session.accessToken
  );
}
