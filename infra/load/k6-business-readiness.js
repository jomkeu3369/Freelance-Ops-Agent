import http from "k6/http";
import { check, fail } from "k6";
import execution from "k6/execution";

// This suite creates synthetic accounts and data only on a disposable local API.
const baseUrl = (__ENV.BASE_URL || "http://127.0.0.1:18080").replace(/\/$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) {
  throw new Error("Business readiness fixtures require a disposable loopback API");
}
const peakRate = Number(__ENV.PEAK_RPS || 50);
if (!Number.isInteger(peakRate) || peakRate < 1 || peakRate > 100) {
  throw new Error("PEAK_RPS must be an integer between 1 and 100");
}

export const options = {
  setupTimeout: "120s",
  scenarios: {
    business: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 100,
      stages: [
        { target: 5, duration: "20s" },
        { target: 20, duration: "30s" },
        { target: peakRate, duration: "20s" },
        { target: peakRate, duration: "60s" },
        { target: 0, duration: "10s" },
      ],
    },
  },
  thresholds: {
    checks: ["rate==1"],
    dropped_iterations: ["count==0"],
    "http_req_failed{scenario:business}": ["rate<0.01"],
    "http_req_duration{scenario:business}": ["p(95)<500", "p(99)<1000"],
  },
};

for (const operation of ["me", "projects", "project-search", "project-detail", "clients", "foreign-resource", "foreign-workspace", "unauthenticated"]) {
  options.thresholds[`http_reqs{operation:${operation}}`] = ["count>0"];
  options.thresholds[`http_req_duration{operation:${operation}}`] = ["p(95)<500", "p(99)<1000"];
}

function params(operation, token, expectedStatus = 200) {
  return {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    tags: { operation, name: operation },
    responseCallback: http.expectedStatuses(expectedStatus),
    timeout: "5s",
    redirects: 0,
  };
}

function json(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

function create(path, body, token, operation) {
  const response = http.post(`${baseUrl}${path}`, JSON.stringify(body), params(operation, token, 201));
  if (response.status !== 201) fail(`${operation} failed with HTTP ${response.status}`);
  const result = json(response);
  if (!result) fail(`${operation} returned invalid JSON`);
  return result;
}

export function setup() {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = ["a", "b"].map((suffix) => create("/api/v2/auth/register", {
    email: `readiness-${nonce}-${suffix}@example.invalid`,
    password: `Readiness-${nonce}-${suffix}!`,
    displayName: `Synthetic readiness ${suffix}`,
    workspaceName: `Synthetic readiness ${suffix}`,
  }, null, "fixture-register"));
  const fixtures = users.map((user, index) => {
    const fixtureMarker = `private-fixture-${nonce}-${index}`;
    const prefix = `/api/v2/workspaces/${user.workspaceId}`;
    const client = create(`${prefix}/clients`, {
      name: "Synthetic client",
      companyName: "Readiness fixture",
    }, user.accessToken, "fixture-client");
    const projects = [];
    for (let i = 0; i < (index === 0 ? 30 : 1); i += 1) {
      projects.push(create(`${prefix}/projects`, {
        clientId: client.id,
        title: `${i === 0 ? "SearchOnly" : "Readiness"} project ${i}`,
        requirementText: `Synthetic local fixture. No model calls. ${fixtureMarker}`,
        currency: "KRW",
      }, user.accessToken, "fixture-project").id);
    }
    return { userId: user.userId, workspaceId: user.workspaceId, accessToken: user.accessToken, clientId: client.id, projectIds: projects, fixtureMarker };
  });
  return fixtures;
}

export default function (fixtures) {
  const [own, other] = fixtures;
  const prefix = `/api/v2/workspaces/${own.workspaceId}`;
  const operations = [
    { name: "me", path: "/api/v2/me", valid: (body) => body?.id === own.userId },
    { name: "projects", path: `${prefix}/projects`, valid: (body) => Array.isArray(body) && body.length === own.projectIds.length && body.every((item) => item.workspaceId === own.workspaceId) },
    { name: "project-search", path: `${prefix}/projects?search=SearchOnly`, valid: (body) => Array.isArray(body) && body.length === 1 && body[0].id === own.projectIds[0] && body[0].workspaceId === own.workspaceId },
    { name: "project-detail", path: `${prefix}/projects/${own.projectIds[0]}`, valid: (body) => body?.id === own.projectIds[0] && body.workspaceId === own.workspaceId },
    { name: "clients", path: `${prefix}/clients`, valid: (body) => Array.isArray(body) && body.length === 1 && body[0].id === own.clientId && body[0].workspaceId === own.workspaceId },
    { name: "foreign-resource", path: `${prefix}/projects/${other.projectIds[0]}`, status: 404 },
    { name: "foreign-workspace", path: `/api/v2/workspaces/${other.workspaceId}/projects`, status: 404 },
    { name: "unauthenticated", path: `${prefix}/projects`, status: 401, anonymous: true },
  ];
  const operation = operations[execution.scenario.iterationInTest % operations.length];
  const response = http.get(`${baseUrl}${operation.path}`, params(operation.name, operation.anonymous ? null : own.accessToken, operation.status || 200));
  check(response, {
    [`${operation.name}: expected status`]: (result) => result.status === (operation.status || 200),
    [`${operation.name}: response contract`]: (result) => {
      if (operation.valid) return operation.valid(json(result));
      const body = json(result);
      const text = result.body || "";
      const validError = text === "" || (body && !Array.isArray(body) && body.status === operation.status);
      return validError && !text.includes(own.fixtureMarker) && !text.includes(other.fixtureMarker)
        && !/"(requirementText|accessToken|refreshToken|stackTrace|trace|exception)"\s*:/.test(text);
    },
  });
}

// The disposable database is removed after the suite. Tokens and payloads are
// intentionally absent from console output and metric tags.
