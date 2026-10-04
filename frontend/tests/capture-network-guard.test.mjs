import test from "node:test";
import assert from "node:assert/strict";
import { captureOrigin, requestDestination, installNetworkGuard } from "../scripts/capture/network-guard.mjs";

const origin = "http://127.0.0.1:3217";
test("capture origin rejects remote hosts, credentials, paths and implicit ports", () => {
  assert.equal(captureOrigin(origin), origin);
  for (const value of ["https://example.com", "http://localhost:3217", "http://127.0.0.1",
    "http://user:password@127.0.0.1:3217", `${origin}/workspace`, `${origin}?key=test`]) {
    assert.throws(() => captureOrigin(value));
  }
});
test("only the isolated frontend and synthetic API namespace pass the guard", () => {
  assert.equal(requestDestination(`${origin}/_next/static/example.js`, origin), "frontend");
  assert.equal(requestDestination("http://localhost:8080/api/v2/me", origin), "fixture");
  for (const url of ["https://api.freelance-ops.site/api/v2/me", "http://localhost:8080/admin",
    "http://localhost:8080/api/v2evil/me", "http://127.0.0.1:8080/api/v2/me",
    "http://127.0.0.1:3218/_next/a.js", "file:///C:/private.txt", "invalid"]) {
    assert.equal(requestDestination(url, origin), "blocked");
  }
});
test("the installed guard aborts external traffic and closes WebSockets", async () => {
  let routeHandler, socketHandler;
  const page = { async route(_pattern, handler) { routeHandler = handler; },
    async routeWebSocket(_pattern, handler) { socketHandler = handler; } };
  const evidence = await installNetworkGuard(page, origin);
  function request(url) {
    const result = { aborted: false, fallback: false };
    return { result, request: () => ({ url: () => url, method: () => "GET" }),
      abort: () => { result.aborted = true; }, fallback: () => { result.fallback = true; } };
  }
  const blocked = request("https://example.com/notifications");
  await routeHandler(blocked);
  assert.equal(blocked.result.aborted, true);
  assert.equal(blocked.result.fallback, false);
  const allowed = request("http://localhost:8080/api/v2/me");
  await routeHandler(allowed);
  assert.equal(allowed.result.fallback, true);
  let closed = false;
  socketHandler({ close() { closed = true; } });
  assert.equal(closed, true);
  assert.equal(evidence.fixture, 1);
  assert.equal(evidence.blocked.length, 1);
  assert.equal(evidence.websocketAttempts, 1);
});
