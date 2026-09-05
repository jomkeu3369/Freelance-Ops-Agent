import http from "k6/http";
import { check } from "k6";

const baseUrl = (__ENV.BASE_URL || "http://127.0.0.1:18080").replace(/\/$/, "");

export const options = {
  scenarios: {
    readiness: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 10,
      maxVUs: 50,
      stages: [
        { target: 5, duration: "20s" },
        { target: 20, duration: "30s" },
        { target: 50, duration: "20s" },
        { target: 0, duration: "10s" },
      ],
    },
  },
  thresholds: {
    checks: ["rate==1"],
    dropped_iterations: ["count==0"],
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<500", "p(99)<1000"],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/actuator/health/readiness`, {
    timeout: "5s",
    redirects: 0,
    tags: { operation: "readiness" },
  });
  check(response, {
    "readiness returns 200": (result) => result.status === 200,
    "readiness is UP": (result) => {
      try {
        return result.json("status") === "UP";
      } catch {
        return false;
      }
    },
  });
}
