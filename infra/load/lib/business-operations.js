import http from "k6/http";
import { check } from "k6";

export const operationNames = [
  "me",
  "projects",
  "project-search",
  "project-detail",
  "clients",
  "foreign-resource",
  "foreign-workspace",
  "unauthenticated",
];

function readJson(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

function businessOperations(currentWorkspace, otherWorkspace) {
  const workspacePath = `/api/v2/workspaces/${currentWorkspace.workspaceId}`;
  const firstProjectId = currentWorkspace.projectIds[0];

  return [
    {
      name: "me",
      path: "/api/v2/me",
      validate: (body) => body?.id === currentWorkspace.userId,
    },
    {
      name: "projects",
      path: `${workspacePath}/projects`,
      validate: (body) =>
        Array.isArray(body) &&
        body.length === currentWorkspace.projectIds.length &&
        body.every(
          (project) => project.workspaceId === currentWorkspace.workspaceId,
        ),
    },
    {
      name: "project-search",
      path: `${workspacePath}/projects?search=SearchOnly`,
      validate: (body) =>
        Array.isArray(body) &&
        body.length === 1 &&
        body[0].id === firstProjectId &&
        body[0].workspaceId === currentWorkspace.workspaceId,
    },
    {
      name: "project-detail",
      path: `${workspacePath}/projects/${firstProjectId}`,
      validate: (body) =>
        body?.id === firstProjectId &&
        body.workspaceId === currentWorkspace.workspaceId,
    },
    {
      name: "clients",
      path: `${workspacePath}/clients`,
      validate: (body) =>
        Array.isArray(body) &&
        body.length === 1 &&
        body[0].id === currentWorkspace.clientId &&
        body[0].workspaceId === currentWorkspace.workspaceId,
    },
    {
      name: "foreign-resource",
      path: `${workspacePath}/projects/${otherWorkspace.projectIds[0]}`,
      status: 404,
    },
    {
      name: "foreign-workspace",
      path: `/api/v2/workspaces/${otherWorkspace.workspaceId}/projects`,
      status: 404,
    },
    {
      name: "unauthenticated",
      path: `${workspacePath}/projects`,
      status: 401,
      anonymous: true,
    },
  ];
}

function isSafeError(response, expectedStatus, fixtures) {
  const body = readJson(response);
  const text = response.body || "";
  const validError =
    text === "" ||
    (body && !Array.isArray(body) && body.status === expectedStatus);

  return (
    validError &&
    fixtures.every((fixture) => !text.includes(fixture.fixtureMarker)) &&
    !/"(requirementText|accessToken|refreshToken|stackTrace|trace|exception)"\s*:/.test(
      text,
    )
  );
}

export function runBusinessOperation(baseUrl, fixtures, iteration) {
  const [currentWorkspace, otherWorkspace] = fixtures;
  const operations = businessOperations(currentWorkspace, otherWorkspace);
  const operation = operations[iteration % operations.length];
  const expectedStatus = operation.status || 200;
  const response = http.get(`${baseUrl}${operation.path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(operation.anonymous
        ? {}
        : { Authorization: `Bearer ${currentWorkspace.accessToken}` }),
    },
    tags: { operation: operation.name, name: operation.name },
    responseCallback: http.expectedStatuses(expectedStatus),
    timeout: "5s",
    redirects: 0,
  });

  check(response, {
    [`${operation.name}: expected status`]: (result) =>
      result.status === expectedStatus,
    [`${operation.name}: response contract`]: (result) =>
      operation.validate
        ? operation.validate(readJson(result))
        : isSafeError(result, expectedStatus, fixtures),
  });
}
