import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";


const originalOrigin = process.env.NEXT_PUBLIC_API_BASE_URL;
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
let temporaryRoot;
let api;
let queryCache;

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
  await writeFile(join(temporaryRoot, "byok-presentation.mjs"), await readFile(new URL("../app/lib/byok-presentation.mjs", import.meta.url)));
  api = await import(pathToFileURL(join(temporaryRoot, "api.mjs")));
  queryCache = await import(pathToFileURL(join(temporaryRoot, "query-cache.mjs")));
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

function fixture(suffix = "a") {
  return { userId: `user-${suffix}`, workspaceId: `workspace-${suffix}`, accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}`, accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-02-01T00:00:00Z", tokenType: "Bearer" };
}
function browserSession(session = fixture()) {
  const values = new Map();
  const browser = new EventTarget();
  browser.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.window = browser;
  api.saveSession(session);
  return session;
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function nextSession(session) { return { ...session, accessToken: `${session.accessToken}-rotated`, refreshToken: `${session.refreshToken}-rotated` }; }

for (const replacement of [null, fixture("b")]) {
  test(`refresh success cannot ${replacement ? "overwrite a newer login" : "resurrect a logged-out session"}`, async () => {
    const session = browserSession();
    const response = deferred();
    globalThis.fetch = () => response.promise;
    const pending = api.refreshAuthSession(session);
    const rejected = assert.rejects(pending);
    api.clearSession();
    if (replacement) api.saveSession(replacement);
    response.resolve(Response.json(nextSession(session)));
    await rejected;
    assert.deepEqual(api.loadSession(), replacement);
  });
}
test("a failed old refresh cannot clear a newer login", async () => {
  const session = browserSession(); const response = deferred();
  globalThis.fetch = () => response.promise;
  const pending = api.refreshAuthSession(session); const rejected = assert.rejects(pending);
  const replacement = fixture("b"); api.saveSession(replacement);
  response.resolve(Response.json({}, { status: 401 })); await rejected;
  assert.deepEqual(api.loadSession(), replacement);
});
test("a delayed 401 never replays an old account mutation under the new account", async () => {
  const session = browserSession(); const response = deferred(); const calls = [];
  globalThis.fetch = (url, init) => { calls.push({ url, init }); return calls.length === 1 ? response.promise : Promise.resolve(Response.json({})); };
  const pending = api.request("/api/v2/account-mutation", { method: "POST", body: "{}" }, session.accessToken);
  const rejected = assert.rejects(pending); api.saveSession(fixture("b"));
  response.resolve(Response.json({}, { status: 401 })); await rejected;
  assert.equal(calls.length, 1);
});
test("a late refresh preserves the workspace selected while it was pending", async () => {
  const session = browserSession(); const response = deferred(); globalThis.fetch = () => response.promise;
  const pending = api.refreshAuthSession(session); api.saveSession({ ...session, workspaceId: "workspace-selected" });
  response.resolve(Response.json(nextSession(session)));
  assert.equal((await pending).workspaceId, "workspace-selected");
  assert.equal(api.loadSession().workspaceId, "workspace-selected");
});
test("a new login's refresh is independent of an older pending refresh", async () => {
  const session = browserSession(); const old = deferred(); const newer = deferred(); const calls = [];
  globalThis.fetch = (_url, init) => { calls.push(JSON.parse(init.body)); return calls.length === 1 ? old.promise : newer.promise; };
  const pending = api.refreshAuthSession(session); const rejected = assert.rejects(pending);
  const replacement = fixture("b"); api.saveSession(replacement);
  const next = api.refreshAuthSession(replacement);
  old.resolve(Response.json({}, { status: 401 }));
  newer.resolve(Response.json(nextSession(replacement)));
  await rejected; await next;
  assert.equal(calls.length, 2); assert.equal(api.loadSession().userId, replacement.userId);
});
test("simultaneous 401 responses rotate once and retry within the same session", async () => {
  const session = browserSession(); const response = deferred(); let refreshes = 0; let retries = 0;
  globalThis.fetch = (url, init) => {
    if (String(url).endsWith("/auth/refresh")) { refreshes++; return response.promise; }
    if (init.headers.get("Authorization") === `Bearer ${session.accessToken}`) return Promise.resolve(Response.json({}, { status: 401 }));
    retries++; return Promise.resolve(Response.json({ ok: true }));
  };
  const requests = [api.request("/one", {}, session.accessToken), api.request("/two", {}, session.accessToken)];
  await new Promise(resolve => setImmediate(resolve)); response.resolve(Response.json(nextSession(session)));
  await Promise.all(requests); assert.equal(refreshes, 1); assert.equal(retries, 2);
});
for (const status of [0, 429, 503]) {
  test(`temporary refresh failure ${status} retains the session`, async () => {
    const session = browserSession();
    globalThis.fetch = async () => { if (!status) throw new TypeError("offline"); return Response.json({}, { status }); };
    await assert.rejects(api.refreshAuthSession(session)); assert.deepEqual(api.loadSession(), session);
  });
}
test("a genuinely rejected current refresh clears the session", async () => {
  const session = browserSession(); globalThis.fetch = async () => Response.json({}, { status: 401 });
  await assert.rejects(api.refreshAuthSession(session)); assert.equal(api.loadSession(), null);
});
test("refresh after logout does not send the stale token", async () => {
  const session = browserSession(); let calls = 0; api.clearSession();
  globalThis.fetch = async () => { calls++; return Response.json(nextSession(session)); };
  await assert.rejects(api.refreshAuthSession(session)); assert.equal(calls, 0);
});

test("a stale callback started after another login cannot recover under that login", async () => {
  const session = browserSession(); api.saveSession(fixture("b")); const calls = [];
  globalThis.fetch = async (_url, init) => { calls.push(init.headers.get("Authorization")); return calls.length === 1 ? Response.json({}, { status: 401 }) : Response.json({}); };
  await assert.rejects(api.request("/old-action", { method: "POST" }, session.accessToken));
  assert.deepEqual(calls, []);
});
test("same-user relogin invalidates the previous login's requests", async () => {
  const session = browserSession(); const response = deferred(); let calls = 0;
  globalThis.fetch = async () => { calls++; return calls === 1 ? response.promise : Response.json({}); };
  const pending = api.request("/old-action", { method: "POST" }, session.accessToken); const rejected = assert.rejects(pending);
  api.saveSession({ ...fixture("b"), userId: session.userId }); response.resolve(Response.json({}, { status: 401 }));
  await rejected; assert.equal(calls, 1);
});
test("recovery listeners changing the login cannot allow the old request retry", async () => {
  const session = browserSession(); const replacement = fixture("b"); const calls = [];
  const unsubscribe = api.subscribeToSessionRecovery(next => { if (next) api.saveSession(replacement); });
  globalThis.fetch = async (url, init) => { calls.push(init.headers.get("Authorization")); return String(url).endsWith("/auth/refresh") ? Response.json(nextSession(session)) : Response.json({}, { status: 401 }); };
  try { await assert.rejects(api.request("/old-action", { method: "POST" }, session.accessToken)); } finally { unsubscribe(); }
  assert.equal(calls.length, 2); assert.deepEqual(api.loadSession(), replacement);
});
test("a stale successful request cannot deliver data from the previous login", async () => {
  const session = browserSession(); const response = deferred(); globalThis.fetch = () => response.promise;
  const pending = api.request("/private-data", {}, session.accessToken); const rejected = assert.rejects(pending);
  api.saveSession(fixture("b")); response.resolve(Response.json({ secret: "synthetic-old-data" })); await rejected;
});

for (const outcome of ["resolve", "reject"]) {
  test(`old cached query ${outcome} cannot refill or remove a newer login's cache`, async () => {
    queryCache.clearQueryCache();
    let settle;
    const old = queryCache.queryCached("workspace-shared", () => new Promise((resolve, reject) => { settle = outcome === "resolve" ? resolve : reject; }));
    const observed = old.catch(() => null);
    queryCache.clearQueryCache();
    assert.equal(await queryCache.queryCached("workspace-shared", async () => "new-value"), "new-value");
    settle(outcome === "resolve" ? "old-value" : new Error("old failure")); await observed;
    assert.equal(await queryCache.queryCached("workspace-shared", async () => "unexpected-reload"), "new-value");
  });
}
