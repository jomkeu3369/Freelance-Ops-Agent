import http from "k6/http";
import { check } from "k6";

const baseUrl = (__ENV.BASE_URL || "https://api.freelance-ops.site").replace(/\/$/, "");

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
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<500", "p(99)<1000"],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/actuator/health/readiness`, {
    tags: { operation: "readiness" },
  });
  check(response, {
    "readiness returns 200": (result) => result.status === 200,
    "readiness is UP": (result) => result.json("status") === "UP",
  });
}
