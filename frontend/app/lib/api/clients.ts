import type { AuthSession } from "./contracts/auth";
import type { Client, ClientInput } from "./contracts/projects";
import { invalidateQueries, queryCached } from "../query-cache";
import { request } from "./http";

export function listClients(session: AuthSession): Promise<Client[]> {
  return queryCached(`clients:${session.workspaceId}`, () =>
    request(`/api/v2/workspaces/${session.workspaceId}/clients`, {}, session.accessToken)
  );
}

export function createClient(session: AuthSession, input: ClientInput): Promise<Client> {
  return request<Client>(
    `/api/v2/workspaces/${session.workspaceId}/clients`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken
  ).then((client) => {
    invalidateQueries(`clients:${session.workspaceId}`);
    return client;
  });
}

export function updateClient(session: AuthSession, clientId: string, input: ClientInput): Promise<Client> {
  return request<Client>(
    `/api/v2/workspaces/${session.workspaceId}/clients/${clientId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    session.accessToken
  ).then((client) => {
    invalidateQueries(`clients:${session.workspaceId}`);
    return client;
  });
}

export function archiveClient(session: AuthSession, clientId: string): Promise<void> {
  return request<void>(
    `/api/v2/workspaces/${session.workspaceId}/clients/${clientId}`,
    { method: "DELETE" },
    session.accessToken
  ).then(() => {
    invalidateQueries(`clients:${session.workspaceId}`);
  });
}
