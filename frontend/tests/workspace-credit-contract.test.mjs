import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// The backend's MockMvc/DTO tests consume this same file, not a second hand-written schema.
const contract = JSON.parse(await readFile(new URL("../../contracts/fixtures/workspace-credit-contract.json", import.meta.url), "utf8"));
const oldFetch = globalThis.fetch;
const oldOrigin = process.env.NEXT_PUBLIC_API_BASE_URL;
const session = { userId: "11111111-1111-4111-8111-111111111111", workspaceId: "44444444-4444-4444-8444-444444444444", accessToken: "synthetic-unit-token" };
const project = { id: "55555555-5555-4555-8555-555555555555", requirementText: contract.start.requirementText };
let directory, api, policy, PendingRunStore;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "workspace-credit-contract-"));
  for (const name of ["api", "query-cache", "credit-policy", "pending-run-store"]) {
    const source = await readFile(new URL(`../app/lib/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } });
    await writeFile(join(directory, `${name}.mjs`), outputText.replace('"./query-cache"', '"./query-cache.mjs"'));
  }
  await writeFile(join(directory, "free-usage.mjs"), await readFile(new URL("../app/lib/free-usage.mjs", import.meta.url)));
  api = await import(pathToFileURL(join(directory, "api.mjs")));
  policy = await import(pathToFileURL(join(directory, "credit-policy.mjs")));
  ({ PendingRunStore } = await import(pathToFileURL(join(directory, "pending-run-store.mjs"))));
});
afterEach(() => { globalThis.fetch = oldFetch; if (oldOrigin === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL; else process.env.NEXT_PUBLIC_API_BASE_URL = oldOrigin; });
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
function capture(response, status = 200) {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://contract.example.invalid";
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null }); return Response.json(response, { status }); };
  return requests;
}

test("real START client emits the exact shared server DTO including reviewed microseconds", async () => {
  const requests = capture({ runId: "synthetic", status: "QUEUED" }, 202);
  await api.startAgentRun(session, project, contract.start.modelSelection, contract.start.requirementText, "shared-start-key", contract.start.creditQuote);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, contract.start);
  assert.equal(new Headers(requests[0].headers).get("Idempotency-Key"), "shared-start-key");
  assert.equal(requests[0].url, `https://contract.example.invalid/api/v2/workspaces/${session.workspaceId}/projects/${project.id}/agent-runs`);
});
test("BYOK client matches shared server DTO and excludes any platform credit quote", async () => {
  const requests = capture({ runId: "synthetic", status: "QUEUED" }, 202);
  await api.startAgentRun(session, project, contract.byokStart.modelSelection, contract.byokStart.requirementText, "shared-byok-key", contract.start.creditQuote);
  assert.deepEqual(requests[0].body, contract.byokStart);
});
test("shared server usage and settings responses drive exact model prices and admin versions", async () => {
  capture(contract.usage); const usage = await api.getFreeUsage(session);
  assert.equal(policy.isWeeklyCreditUsage(usage), true);
  assert.deepEqual(policy.creditDecision(usage, "OPENAI", "gpt-5.6-luna"), { kind: "ready", remaining: 70, quote: contract.start.creditQuote });
  assert.equal(policy.creditDecision(usage, "OPENAI", "gpt-5.6-terra").kind, "insufficient");
  capture(contract.settings); const settings = await api.getFreeUsageSettings(session);
  assert.equal(policy.isWeeklyCreditSettings(settings), true);
  const requests = capture(contract.settings);
  await api.updateFreeModelRate(session, settings, contract.adminModelChange);
  assert.deepEqual(requests[0].body, contract.adminModelChange);
  await api.resetAllFreeUsage(session, settings);
  assert.deepEqual(requests[1].body, contract.adminReset);
});
test("shared server errors remain typed and distinguish quote, user balance and operating guards", async () => {
  for (const { status, body } of contract.errors) {
    capture(body, status);
    await assert.rejects(api.startAgentRun(session, project, contract.start.modelSelection, contract.start.requirementText, "shared-error-key", contract.start.creditQuote), error => {
      assert.equal(error.status, status); assert.equal(error.code, body.code);
      assert.equal(api.isCreditQuoteRefreshRequired(error), ["CREDIT_QUOTE_REQUIRED", "CREDIT_QUOTE_STALE", "PLATFORM_MODEL_UNAVAILABLE"].includes(body.code));
      assert.equal(api.isPlatformSpendUnavailable(error), ["PLATFORM_SPEND_EXHAUSTED", "PLATFORM_SPEND_DISABLED"].includes(body.code));
      assert.equal(api.isFreeUsageExhausted(error), body.code === "FREE_USAGE_EXHAUSTED");
      if (body.requiredCredits) assert.equal(error.metadata.requiredCredits, body.requiredCredits);
      return true;
    });
  }
});
test("resume remains the existing interruption contract and never submits a second START quote", async () => {
  const requests = capture({ runId: "synthetic", status: "RUNNING" }, 202);
  await api.resumeAgentRun(session, "66666666-6666-4666-8666-666666666666", contract.resume.interruptionId, contract.resume.answers.map(answer => answer.answer));
  assert.match(requests[0].url, /\/agent-runs\/[^/]+\/responses$/);
  assert.match(requests[0].body.idempotencyKey, /^web-[0-9a-f-]{36}$/);
  assert.deepEqual({ ...requests[0].body, idempotencyKey: contract.resume.idempotencyKey }, contract.resume);
  assert.equal(requests[0].body.creditQuote, undefined);
});
test("shared quote errors require a new user request; uncertain failures preserve exact START body", async () => {
  const store = new PendingRunStore();
  const input = { userId: session.userId, workspaceId: session.workspaceId, projectId: project.id, provider: "OPENAI", model: "gpt-5.6-luna", message: contract.start.requirementText, creditQuote: contract.start.creditQuote };
  const original = store.getOrCreate(input); store.settle(original.id, "uncertain");
  const newer = { ...contract.start.creditQuote, credits: 20, pricingUpdatedAt: "2026-10-04T12:01:00.654321Z" };
  const retry = store.getOrCreate({ ...input, creditQuote: newer });
  const requests = capture({ runId: "synthetic", status: "QUEUED" }, 202);
  await api.startAgentRun(session, project, contract.start.modelSelection, retry.message, retry.id, retry.creditQuote);
  assert.deepEqual(requests[0].body, contract.start);
  assert.equal(retry.id, original.id);
  store.settle(retry.id, "rejected");
  const next = store.getOrCreate({ ...input, creditQuote: newer });
  assert.notEqual(next.id, original.id); assert.deepEqual(next.creditQuote, newer);
});

test("account balance changes only from a fresh shared server usage response after settlement", async () => {
  capture(contract.usage);
  const reserved = await api.getFreeUsage(session);
  assert.equal(reserved.reserved, 10); assert.equal(reserved.remaining, 70);
  // A terminal run does not itself carry a refundable credit amount. No local refund is inferred.
  capture({ runId: "synthetic", status: "FAILED", result: null, metadata: null });
  await api.getAgentRun(session, "synthetic");
  assert.equal(reserved.reserved, 10); assert.equal(reserved.remaining, 70);
  capture(contract.settledFailureUsage);
  const settled = await api.getFreeUsage(session);
  assert.equal(policy.isWeeklyCreditUsage(settled), true);
  assert.equal(settled.used, 20); assert.equal(settled.reserved, 0); assert.equal(settled.remaining, 80);
  assert.equal(policy.creditDecision(settled, "OPENAI", "gpt-5.6-luna").remaining, 80);
});

test("shared contract changes trigger frontend CI as well as backend contract checks", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/frontend-ci.yml", import.meta.url), "utf8");
  assert.equal(workflow.match(/contracts\/fixtures\/workspace-credit-contract\.json/g)?.length, 2);
});

test("START client retains reviewed attachments, manual-empty skill choice and AD_HOC workflow", async () => {
  const requests = capture({ runId: "synthetic", status: "QUEUED" }, 202);
  const selection = { mode: "MANUAL", manualIds: [], excludedIds: ["writing-proposal"], catalogVersion: "1.0.0" };
  await api.startAgentRun(session, project, contract.start.modelSelection, "Read the attached text only", "exact-skill-key", undefined, ["attachment-one"], selection, "AD_HOC");
  assert.deepEqual(requests[0].body.skillSelection, selection);
  assert.deepEqual(requests[0].body.attachmentIds, ["attachment-one"]);
  assert.equal(requests[0].body.workflowMode, "AD_HOC");
  assert.equal(requests[0].body.requirementText, "Read the attached text only");
  assert.equal(new Headers(requests[0].headers).get("Idempotency-Key"), "exact-skill-key");
});
