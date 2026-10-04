import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { validateVercelEnvironment } from "../scripts/validate-vercel-env.mjs";

const originalOrigin = process.env.NEXT_PUBLIC_API_BASE_URL;
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
let temporaryRoot;
let api;

before(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "freelance-ops-api-url-test-"));
  // Exercise the real TypeScript API client without loading Next or contacting a server.
  for (const name of ["api", "query-cache"]) {
    const source = await readFile(new URL(`../app/lib/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 },
    });
    await writeFile(join(temporaryRoot, `${name}.mjs`), outputText.replace('"./query-cache"', '"./query-cache.mjs"'));
  }
  await writeFile(join(temporaryRoot, "free-usage.mjs"), await readFile(new URL("../app/lib/free-usage.mjs", import.meta.url)));
  api = await import(pathToFileURL(join(temporaryRoot, "api.mjs")));
});

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
  else process.env.NEXT_PUBLIC_API_BASE_URL = originalOrigin;
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
});

after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test("API origins use the same outer-whitespace normalization as Vercel validation", () => {
  for (const raw of [" https://api.example.invalid", "https://api.example.invalid ", "\t\nhttps://api.example.invalid\r\n "]) {
    process.env.NEXT_PUBLIC_API_BASE_URL = raw;
    const validated = validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: raw });
    assert.equal(api.apiBaseUrl(), validated.apiOrigin);
  }
});

test("normalization preserves existing origins, local fallback and trailing-slash behavior", () => {
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  assert.equal(api.apiBaseUrl(), "http://localhost:8080");
  for (const [raw, expected] of [
    ["https://api.example.invalid", "https://api.example.invalid"],
    ["http://localhost:8080", "http://localhost:8080"],
    ["https://api.example.invalid/", "https://api.example.invalid"],
    [" https://api.example.invalid/ \n", "https://api.example.invalid"],
    ["", ""],
  ]) {
    process.env.NEXT_PUBLIC_API_BASE_URL = raw;
    assert.equal(api.apiBaseUrl(), expected);
  }
});

test("a whitespace-padded origin produces a valid request URL without external network", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = " \thttps://api.example.invalid \r\n";
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(new Request(url, init));
    return new Response(JSON.stringify({ projectTitle: "Local fixture" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  const result = await api.getSharedProposal("fixture / share");
  assert.equal(result.projectTitle, "Local fixture");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.example.invalid/api/v2/proposals/fixture%20%2F%20share");
  assert.equal(requests[0].method, "GET");
});

function browserSession() {
  const values = new Map();
  const window = new EventTarget();
  window.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.window = window;
  const session = { userId: "user", workspaceId: "workspace", accessToken: "old-token", refreshToken: "refresh", refreshTokenExpiresAt: "2099-01-01T00:00:00Z" };
  api.saveSession(session);
  return session;
}

test("API preserves typed quota metadata and publishes only exact quota errors, never generic 429", async () => {
  const session = browserSession();
  const events = [];
  const unsubscribe = api.subscribeToFreeUsageExhausted(error => events.push(error));
  for (const code of [undefined, "RATE_LIMITED", "free_usage_exhausted", "FREE_USAGE_EXHAUSTED"]) {
    globalThis.fetch = async () => Response.json({ message: "public-safe error", code, limit: 5, used: 4, reserved: 1, resetAt: "2026-10-31T15:00:00Z" }, {status: 429});
    await assert.rejects(api.getFreeUsage(session), error => {
      assert.equal(error.message, "public-safe error");
      assert.equal(error.status, 429);
      assert.equal(error.code, code ?? null);
      assert.equal(error.metadata.reserved, 1);
      assert.equal(api.isFreeUsageExhausted(error), code === "FREE_USAGE_EXHAUSTED");
      return true;
    });
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].metadata.used, 4);
  unsubscribe();
});

test("analysis idempotency key survives automatic token refresh and differs for a new submission", async () => {
  const session = browserSession();
  const requests = [];
  let starts = 0;
  globalThis.fetch = async (url, init) => {
    requests.push(new Request(url, init));
    if (String(url).endsWith("/auth/refresh")) return Response.json({...session, accessToken: "new-token"});
    starts++;
    return starts === 1 ? Response.json({}, {status: 401}) : Response.json({runId: "one"}, {status: 202});
  };
  const project = {id: "project", requirementText: "unchanged draft"};
  await api.startAgentRun(session, project, {provider: "OPENAI", model: "fixture", reasoningEffort: "LOW"});
  const attempts = requests.filter(req => req.url.endsWith("/agent-runs"));
  assert.equal(attempts.length, 2);
  const key = attempts[0].headers.get("Idempotency-Key");
  assert.match(key, /^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(attempts[1].headers.get("Idempotency-Key"), key);
  assert.equal(attempts[1].headers.get("Authorization"), "Bearer new-token");
  await api.startAgentRun(api.loadSession(), project, {provider: "OPENAI", model: "fixture", reasoningEffort: "LOW"});
  assert.notEqual(requests.at(-1).headers.get("Idempotency-Key"), key);
});

test("admin reset and limit changes send both optimistic concurrency preconditions", async () => {
  const session = browserSession();
  const settings = {limit: 5, maxLimit: 100, epoch: 7, updatedAt: "2026-10-03T00:00:00Z", lastResetAt: null};
  const bodies = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return Response.json(settings); };
  await api.updateFreeUsageLimit(session, settings, 0);
  await api.resetAllFreeUsage(session, settings);
  assert.deepEqual(bodies, [{limit: 0, expectedEpoch: 7, expectedUpdatedAt: settings.updatedAt}, {confirmation: "RESET_ALL_FREE_USAGE", expectedEpoch: 7, expectedUpdatedAt: settings.updatedAt}]);
});

test("registration sends the age attestation as a JSON boolean and never assumes consent", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.invalid";
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(new Request(url, init));
    return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } });
  };
  const input = { email: "fixture@example.invalid", password: "local-fixture-only", displayName: "Fixture", workspaceName: "Fixture workspace" };
  for (const ageAtLeast14 of [true, false]) {
    await api.register({ ...input, ageAtLeast14 });
    const request = requests.at(-1);
    assert.equal(request.url, "https://api.example.invalid/api/v2/auth/register");
    assert.equal(request.method, "POST");
    assert.deepEqual(await request.json(), { ...input, ageAtLeast14 });
  }
  // A stale JavaScript caller is not silently opted in; the server rejects the missing field.
  await api.register(input);
  assert.deepEqual(await requests.at(-1).json(), input);
});

test("email verification requests never authenticate and send secrets in POST bodies only", async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(new Request(url, init));
    return Response.json({ status: "VERIFIED" });
  };
  await api.requestEmailVerification("fixture@example.invalid");
  await api.confirmEmailVerification("fixture-token-only", "new-owner-password");
  assert.equal(requests[0].url.endsWith("/auth/email-verification/request"), true);
  assert.deepEqual(await requests[0].json(), { email: "fixture@example.invalid" });
  assert.equal(requests[1].url.endsWith("/auth/email-verification/confirm"), true);
  assert.deepEqual(await requests[1].json(), { token: "fixture-token-only", password: "new-owner-password" });
  for (const request of requests) {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.has("Authorization"), false);
    assert.equal(new URL(request.url).search, "");
    assert.equal(request.cache, "no-store");
  }
});

test("registration preserves the unauthenticated pending result", async () => {
  const result = { userId: null, workspaceId: null, accessToken: null, accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null, tokenType: "EmailVerificationRequired" };
  globalThis.fetch = async () => Response.json(result);
  const response = await api.register({ email: "fixture@example.invalid", password: "unused-signup-password", displayName: "Fixture", workspaceName: "Fixture", ageAtLeast14: true });
  assert.deepEqual(response, result);
  assert.equal(api.isEmailVerificationRequired(response), true);
  assert.equal(api.isEmailVerificationRequired({ tokenType: "Bearer" }), false);
});

test("notices admin sends optimistic revision and immutable content/audience approval", async () => {
  const requests = [];
  const session = browserSession();
  globalThis.fetch = async (url, init) => { requests.push(new Request(url, init)); return Response.json({}); };
  const notice = { id: "notice-fixture", revision: 7 };
  const campaign = { id: "campaign-fixture", contentHash: "a".repeat(64), recipientHash: "b".repeat(64), recipientCount: 17 };
  await api.reviewNotice(session, notice);
  await api.publishNotice(session, notice, "2099-01-01T00:00:00Z");
  await api.testNoticeCampaign(session, campaign.id);
  await api.confirmNoticeCampaign(session, campaign);
  await api.cancelNoticeCampaign(session, campaign.id);
  assert.deepEqual(await requests[0].json(), { expectedRevision: 7 });
  assert.deepEqual(await requests[1].json(), { expectedRevision: 7, publishAt: "2099-01-01T00:00:00Z", confirmation: "PUBLISH_NOTICE" });
  assert.equal(await requests[2].text(), "");
  assert.deepEqual(await requests[3].json(), { contentHash: campaign.contentHash, recipientHash: campaign.recipientHash, recipientCount: 17, confirmation: "QUEUE_OPERATIONAL_NOTICE" });
  assert.deepEqual(await requests[4].json(), {});
  for (const request of requests) assert.equal(request.headers.get("Authorization"), "Bearer old-token");
});

test("START sends the exact server quote at top level and excludes it for explicit BYOK", async () => {
  const session = browserSession(); const bodies = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return Response.json({runId: "synthetic"}, {status: 202}); };
  const quote = {credits: 10, pricingUpdatedAt: "2026-10-04T12:00:00.123456Z"};
  const project = {id: "project", requirementText: "exact message"};
  await api.startAgentRun(session, project, {provider: "OPENAI", model: "luna", reasoningEffort: "LOW"}, undefined, "quote-test-key", quote);
  await api.startAgentRun(session, project, {provider: "OPENAI", model: "personal", reasoningEffort: "LOW", credentialId: "own-key-id"}, undefined, "byok-test-key", quote);
  assert.deepEqual(bodies[0].creditQuote, quote);
  assert.equal(bodies[0].modelSelection.creditQuote, undefined);
  assert.equal(bodies[1].creditQuote, undefined);
});

test("model price mutations preserve exact administrator concurrency versions", async () => {
  const session = browserSession(); const requests = [];
  const settings = {epoch: 7, updatedAt: "2026-10-04T12:00:00.987654Z"};
  globalThis.fetch = async (url, init) => { requests.push({url, body: JSON.parse(init.body)}); return Response.json(settings); };
  const rate = {provider: "OPENAI", model: "luna", credits: 20, enabled: false};
  await api.updateFreeModelRate(session, settings, rate);
  assert.equal(requests[0].url.endsWith("/api/v2/admin/free-usage/models"), true);
  assert.deepEqual(requests[0].body, {...rate, expectedEpoch: 7, expectedUpdatedAt: settings.updatedAt});
});

test("quote and operating-spend failures are separate from user credit exhaustion", () => {
  for (const code of ["CREDIT_QUOTE_REQUIRED", "CREDIT_QUOTE_STALE", "PLATFORM_MODEL_UNAVAILABLE"]) {
    const error = new api.ApiError("synthetic", 409, code);
    assert.equal(api.isCreditQuoteRefreshRequired(error), true);
    assert.equal(api.isFreeUsageExhausted(error), false);
  }
  for (const code of ["PLATFORM_SPEND_EXHAUSTED", "PLATFORM_SPEND_DISABLED"]) {
    const error = new api.ApiError("synthetic", 429, code);
    assert.equal(api.isPlatformSpendUnavailable(error), true);
    assert.equal(api.isFreeUsageExhausted(error), false);
    assert.equal(api.isCreditQuoteRefreshRequired(error), false);
  }
});
