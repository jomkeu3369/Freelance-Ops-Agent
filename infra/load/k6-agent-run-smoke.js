import http from "k6/http";
import { check, fail, sleep } from "k6";

const required = ["BASE_URL", "ACCESS_TOKEN", "WORKSPACE_ID", "PROJECT_ID"];
for (const name of required) {
  if (!__ENV[name]) fail(`${name} is required`);
}
if (__ENV.ALLOW_PAID_MODEL_CALLS !== "true") {
  fail("Set ALLOW_PAID_MODEL_CALLS=true after confirming the provider budget");
}

const baseUrl = __ENV.BASE_URL.replace(/\/$/, "");
const headers = {
  Authorization: `Bearer ${__ENV.ACCESS_TOKEN}`,
  "Content-Type": "application/json",
};

export const options = {
  vus: Number(__ENV.VUS || 1),
  iterations: Number(__ENV.ITERATIONS || 1),
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{operation:start-run}": ["p(95)<2000"],
  },
};

export default function () {
  const payload = JSON.stringify({
    requirementText: "운영 smoke test: 요구사항을 한 문장으로 요약해 주세요.",
    locale: "ko-KR",
    jurisdictionCode: "KR",
    modelSelection: {
      provider: __ENV.PROVIDER || "OPENAI",
      model: __ENV.MODEL || "gpt-5.6-luna",
      reasoningEffort: "LOW",
    },
    budget: {
      maxDurationSeconds: 90,
      maxModelCalls: 3,
      maxToolCalls: 1,
      maxInputTokens: 5000,
      maxOutputTokens: 1000,
      maxDepartments: 1,
      maxHierarchyDepth: 1,
      maxSearchCredits: 0,
      maxRetries: 0,
      maxHandoffs: 0,
    },
    safetyContext: {
      externalSideEffect: false,
      sensitiveData: false,
      financialAuthorityRequired: false,
      legalAuthorityRequired: false,
      irreversibleAction: false,
      approvalRequired: false,
      authorityVerified: true,
    },
  });
  const response = http.post(
    `${baseUrl}/api/v2/workspaces/${__ENV.WORKSPACE_ID}/projects/${__ENV.PROJECT_ID}/agent-runs`,
    payload,
    { headers, tags: { operation: "start-run" } },
  );
  check(response, { "run accepted": (result) => result.status === 202 });
  sleep(1);
}
