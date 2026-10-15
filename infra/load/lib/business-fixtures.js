import http from "k6/http";
import { fail } from "k6";

function createResource(baseUrl, path, body, accessToken, operation) {
  const response = http.post(`${baseUrl}${path}`, JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    tags: { operation, name: operation },
    responseCallback: http.expectedStatuses(201),
    timeout: "5s",
    redirects: 0,
  });

  if (response.status !== 201) {
    fail(`${operation} failed with HTTP ${response.status}`);
  }

  let resource;
  try {
    resource = response.json();
  } catch {
    fail(`${operation} returned invalid JSON`);
  }
  if (!resource) {
    fail(`${operation} returned invalid JSON`);
  }
  return resource;
}

export function createBusinessFixtures(baseUrl) {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = ["a", "b"].map((suffix) =>
    createResource(
      baseUrl,
      "/api/v2/auth/register",
      {
        email: `readiness-${nonce}-${suffix}@example.invalid`,
        password: `Readiness-${nonce}-${suffix}!`,
        displayName: `Synthetic readiness ${suffix}`,
        workspaceName: `Synthetic readiness ${suffix}`,
      },
      null,
      "fixture-register",
    ),
  );

  return users.map((user, userIndex) => {
    const fixtureMarker = `private-fixture-${nonce}-${userIndex}`;
    const workspacePath = `/api/v2/workspaces/${user.workspaceId}`;
    const client = createResource(
      baseUrl,
      `${workspacePath}/clients`,
      { name: "Synthetic client", companyName: "Readiness fixture" },
      user.accessToken,
      "fixture-client",
    );
    const projectIds = [];
    const projectCount = userIndex === 0 ? 30 : 1;

    for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
      const project = createResource(
        baseUrl,
        `${workspacePath}/projects`,
        {
          clientId: client.id,
          title: `${projectIndex === 0 ? "SearchOnly" : "Readiness"} project ${projectIndex}`,
          requirementText: `Synthetic local fixture. No model calls. ${fixtureMarker}`,
          currency: "KRW",
        },
        user.accessToken,
        "fixture-project",
      );
      projectIds.push(project.id);
    }

    return {
      userId: user.userId,
      workspaceId: user.workspaceId,
      accessToken: user.accessToken,
      clientId: client.id,
      projectIds,
      fixtureMarker,
    };
  });
}
