import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const loadDirectory = new URL("../load/", import.meta.url);

// k6 경계만 대체해 실제 부하·유료 모델 호출 없이 시나리오의 판정 조건을 검증한다.
async function loadScript(filename, environment = {}, httpOverrides = {}) {
  const checks = [];
  const execution = { scenario: { iterationInTest: 0 } };
  const context = vm.createContext({ __ENV: environment });
  const http = {
    expectedStatuses: (status) => status,
    get: () => assert.fail("Unexpected HTTP GET"),
    post: () => assert.fail("Unexpected HTTP POST"),
    ...httpOverrides,
  };
  const k6 = {
    check: (response, predicates) => {
      const results = Object.values(predicates).map((predicate) =>
        Boolean(predicate(response)),
      );
      checks.push(...results);
      return results.every(Boolean);
    },
    fail: (message) => {
      throw new Error(message);
    },
    sleep: () => {},
  };
  const externalModules = new Map([
    ["k6", k6],
    ["k6/http", { default: http }],
    ["k6/execution", { default: execution }],
  ]);
  const modules = new Map();

  async function readModule(url) {
    const identifier = url.href;
    if (modules.has(identifier)) return modules.get(identifier);
    const module = new vm.SourceTextModule(await readFile(url, "utf8"), {
      context,
      identifier,
    });
    modules.set(identifier, module);
    await module.link(async (specifier, parent) => {
      const moduleExports = externalModules.get(specifier);
      if (moduleExports) {
        return new vm.SyntheticModule(
          Object.keys(moduleExports),
          function () {
            for (const [name, value] of Object.entries(moduleExports))
              this.setExport(name, value);
          },
          { context },
        );
      }
      return readModule(new URL(specifier, parent.identifier));
    });
    return module;
  }

  const module = await readModule(new URL(filename, loadDirectory));
  await module.evaluate();
  return { script: module.namespace, checks, execution };
}

function response(status, body) {
  return {
    status,
    body: JSON.stringify(body),
    json: (selector) => (selector ? body[selector] : body),
  };
}

test("업무 fixture는 로컬 주소와 제한된 정수 RPS만 허용한다", async () => {
  for (const baseUrl of [
    "https://api.example.com",
    "http://127.0.0.1.evil.test",
    "http://localhost/path",
  ]) {
    await assert.rejects(
      loadScript("k6-business-readiness.js", { BASE_URL: baseUrl }),
      /loopback/,
    );
  }
  for (const peakRate of ["0", "101", "1.5", "invalid"]) {
    await assert.rejects(
      loadScript("k6-business-readiness.js", { PEAK_RPS: peakRate }),
      /PEAK_RPS/,
    );
  }
});

test("fixture 2개에 프로젝트 30개·1개를 만들고 토큰을 태그에 남기지 않는다", async () => {
  const requests = [];
  let userCount = 0;
  let projectCount = 0;
  const { script } = await loadScript(
    "k6-business-readiness.js",
    {},
    {
      post: (url, payload, params) => {
        requests.push({ url, body: JSON.parse(payload), params });
        assert.equal(params.responseCallback, 201);
        assert.equal(params.redirects, 0);
        assert.equal(params.timeout, "5s");
        if (url.endsWith("/auth/register")) {
          userCount += 1;
          return response(201, {
            userId: userCount,
            workspaceId: userCount,
            accessToken: `secret-${userCount}`,
          });
        }
        return response(201, {
          id: url.endsWith("/clients") ? userCount : ++projectCount,
        });
      },
    },
  );
  const fixtures = script.setup();
  assert.equal(requests.length, 35);
  assert.equal(fixtures.length, 2);
  assert.equal(fixtures[0].projectIds.length, 30);
  assert.equal(fixtures[1].projectIds.length, 1);
  assert.equal(
    requests.filter(({ body }) => body.title?.startsWith("SearchOnly")).length,
    2,
  );
  assert.ok(
    requests.every(
      ({ params }) => !JSON.stringify(params.tags).includes("secret-"),
    ),
  );
  assert.ok(requests.every(({ url }) => !url.includes("agent-runs")));
});

test("업무 조회 5개와 접근 거부 3개의 계약·인증·오류 노출을 판정한다", async () => {
  const currentWorkspace = {
    userId: 1,
    workspaceId: 10,
    accessToken: "private-token",
    clientId: 20,
    projectIds: [30, 31],
    fixtureMarker: "private-fixture-current",
  };
  const otherWorkspace = {
    workspaceId: 11,
    projectIds: [32],
    fixtureMarker: "private-fixture-other",
  };
  const project = { id: 30, workspaceId: 10 };
  const responses = {
    me: response(200, { id: 1 }),
    projects: response(200, [project, { id: 31, workspaceId: 10 }]),
    "project-search": response(200, [project]),
    "project-detail": response(200, project),
    clients: response(200, [{ id: 20, workspaceId: 10 }]),
    "foreign-resource": response(404, { status: 404 }),
    "foreign-workspace": response(404, { status: 404 }),
    unauthenticated: response(401, { status: 401 }),
  };
  const calledOperations = [];
  const { script, checks, execution } = await loadScript(
    "k6-business-readiness.js",
    {},
    {
      get: (url, params) => {
        const operation = params.tags.operation;
        calledOperations.push(operation);
        assert.equal(
          params.headers.Authorization,
          operation === "unauthenticated" ? undefined : "Bearer private-token",
        );
        assert.equal(params.responseCallback, responses[operation].status);
        return responses[operation];
      },
    },
  );
  const fixtures = [currentWorkspace, otherWorkspace];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    execution.scenario.iterationInTest = iteration;
    script.default(fixtures);
  }
  assert.equal(new Set(calledOperations).size, 8);
  for (const operation of calledOperations) {
    assert.equal(
      script.options.thresholds[`http_reqs{operation:${operation}}`][0],
      "count>0",
    );
  }
  assert.equal(checks.length, 16);
  assert.ok(checks.every(Boolean));

  execution.scenario.iterationInTest = 2;
  responses["project-search"] = response(200, [{ id: 999, workspaceId: 10 }]);
  script.default(fixtures);
  assert.equal(checks.at(-1), false);

  execution.scenario.iterationInTest = 5;
  for (const exposedData of [
    { accessToken: "secret" },
    { message: otherWorkspace.fixtureMarker },
  ]) {
    responses["foreign-resource"] = response(404, {
      status: 404,
      ...exposedData,
    });
    script.default(fixtures);
    assert.equal(checks.at(-1), false);
  }
});

test("readiness는 HTTP 200이어도 DOWN이나 JSON 파싱 실패를 거부한다", async () => {
  let readiness = response(200, { status: "UP" });
  const { script, checks } = await loadScript(
    "k6-readiness.js",
    {},
    { get: () => readiness },
  );
  script.default();
  assert.ok(checks.every(Boolean));
  readiness = response(200, { status: "DOWN" });
  script.default();
  assert.equal(checks.at(-1), false);
  readiness = {
    status: 200,
    json: () => {
      throw new Error("Invalid JSON");
    },
  };
  script.default();
  assert.equal(checks.at(-1), false);
});

test("Agent smoke는 유료 호출 동의를 요구하며 202 접수만 성공으로 판정한다", async () => {
  const environment = {
    BASE_URL: "http://localhost:18080",
    ACCESS_TOKEN: "test-token",
    WORKSPACE_ID: "10",
    PROJECT_ID: "30",
  };
  await assert.rejects(
    loadScript("k6-agent-run-smoke.js", environment),
    /ALLOW_PAID_MODEL_CALLS/,
  );
  let status = 202;
  const { script, checks } = await loadScript(
    "k6-agent-run-smoke.js",
    {
      ...environment,
      ALLOW_PAID_MODEL_CALLS: "true",
    },
    {
      post: (url, payload, params) => {
        assert.equal(params.responseCallback, 202);
        assert.equal(params.redirects, 0);
        assert.equal(params.timeout, "10s");
        assert.equal(params.tags.name, "start-run");
        return response(status, {});
      },
    },
  );
  assert.equal(script.options.thresholds.checks[0], "rate==1");
  script.default();
  assert.equal(checks.at(-1), true);
  status = 200;
  script.default();
  assert.equal(checks.at(-1), false);
});
