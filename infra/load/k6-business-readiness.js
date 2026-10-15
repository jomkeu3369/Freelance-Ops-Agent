import execution from "k6/execution";
import { createBusinessFixtures } from "./lib/business-fixtures.js";
import {
  operationNames,
  runBusinessOperation,
} from "./lib/business-operations.js";

// 합성 데이터를 생성하므로 일회용 DB에 연결된 로컬 API만 허용한다.
const baseUrl = (__ENV.BASE_URL || "http://127.0.0.1:18080").replace(/\/$/, "");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) {
  throw new Error(
    "Business readiness fixtures require a disposable loopback API",
  );
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

for (const operation of operationNames) {
  options.thresholds[`http_reqs{operation:${operation}}`] = ["count>0"];
  options.thresholds[`http_req_duration{operation:${operation}}`] = [
    "p(95)<500",
    "p(99)<1000",
  ];
}

export function setup() {
  // 토큰과 요청 본문은 메모리에서만 사용하고 로그·메트릭 태그에 넣지 않는다.
  return createBusinessFixtures(baseUrl);
}

export default function (fixtures) {
  runBusinessOperation(baseUrl, fixtures, execution.scenario.iterationInTest);
}
