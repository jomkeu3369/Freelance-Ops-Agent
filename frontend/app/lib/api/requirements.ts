import type { AuthSession } from "./contracts/auth";
import type { RequirementFeature, RequirementVersion } from "./contracts/projects";
import { invalidateQueries, queryCached } from "../query-cache";
import { request } from "./http";

export function listRequirements(session: AuthSession, projectId: string): Promise<RequirementVersion[]> {
  return queryCached(`requirements:${session.workspaceId}:${projectId}`, () =>
    request(`/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/requirements`, {}, session.accessToken)
  );
}

export function createRequirementVersion(session: AuthSession, projectId: string, input: { sourceText: string; features: RequirementFeature[]; assumptions: string[]; questions: string[] }): Promise<RequirementVersion> {
  return request<RequirementVersion>(
    `/api/v2/workspaces/${session.workspaceId}/projects/${projectId}/requirements`,
    { method: "POST", body: JSON.stringify(input) },
    session.accessToken
  ).then((version) => {
    invalidateQueries(`requirements:${session.workspaceId}:${projectId}`);
    invalidateQueries(`documents:${session.workspaceId}`);
    invalidateQueries(`document:${session.workspaceId}:`);
    return version;
  });
}
