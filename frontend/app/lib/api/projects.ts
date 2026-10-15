import type { AuthSession } from "./contracts/auth";
import type { Project, ProjectInput, ProjectStatus } from "./contracts/projects";
import { invalidateQueries, queryCached } from "../query-cache";
import { request } from "./http";

export function listProjects(session: AuthSession, search = ""): Promise<Project[]> {
  const normalizedSearch = search.trim();
  const query = normalizedSearch ? `?search=${encodeURIComponent(normalizedSearch)}` : "";
  return queryCached(`projects:${session.workspaceId}:${normalizedSearch.toLocaleLowerCase()}`, () =>
    request(`/api/v2/workspaces/${session.workspaceId}/projects${query}`, {}, session.accessToken)
  );
}

export function createProject(session: AuthSession, input: ProjectInput): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken
  ).then((project) => {
    invalidateQueries(`projects:${session.workspaceId}`);
    return project;
  });
}

// 실패한 저장 요청이 서버에 반영됐을 수 있으므로 캐시를 건너뛰고 확인한다.
export function readProject(session: AuthSession, projectId: string): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}`,
    { cache: "no-store" },
    session.accessToken
  ).then((project) => {
    invalidateQueries(`projects:${session.workspaceId}`);
    invalidateQueries(`documents:${session.workspaceId}`);
    invalidateQueries(`document:${session.workspaceId}:`);
    return project;
  });
}

export function updateProject(session: AuthSession, project: Project, status: ProjectStatus): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${project.id}/status`,
    { method: "PATCH", body: JSON.stringify({ status }) },
    session.accessToken
  ).then((updated) => {
    invalidateQueries(`projects:${session.workspaceId}`);
    invalidateQueries(`documents:${session.workspaceId}`);
    invalidateQueries(`document:${session.workspaceId}:`);
    return updated;
  });
}

export function updateProjectDetails(session: AuthSession, project: Project, input: ProjectInput): Promise<Project> {
  return request<Project>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${project.id}`,
    { method: "PATCH", body: JSON.stringify({ ...input, status: project.status }) },
    session.accessToken
  ).then((updated) => {
    invalidateQueries(`projects:${session.workspaceId}`);
    invalidateQueries(`documents:${session.workspaceId}`);
    invalidateQueries(`document:${session.workspaceId}:`);
    return updated;
  });
}

export function deleteProject(session: AuthSession, projectId: string): Promise<void> {
  return request<void>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}`,
    { method: "DELETE" },
    session.accessToken
  ).then(() => {
    invalidateQueries(`projects:${session.workspaceId}`);
  });
}
