import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
async function load(name) {
  const source = await readFile(new URL(`../app/lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { creditDecision, isWeeklyCreditUsage, isWeeklyCreditSettings } = await load("credit-policy");
const { PendingRunStore } = await load("pending-run-store");
const usage = { unit: "CREDITS", periodType: "WEEKLY", limit: 100, used: 20, reserved: 10, remaining: 70, resetAt: "2026-10-11T15:00:00Z", period: "2026-10-05", timezone: "Asia/Seoul", epoch: 1, canManage: false, pricingUpdatedAt: "2026-10-04T12:00:00.123456Z", modelRates: [{ provider: "OPENAI", model: "luna", credits: 10, enabled: true }, { provider: "OPENAI", model: "terra", credits: 100, enabled: true }] };
const input = { userId: "user", workspaceId: "workspace", projectId: "project", provider: "OPENAI", model: "luna", message: "  exact text\nsecond line  ", creditQuote: { credits: 10, pricingUpdatedAt: usage.pricingUpdatedAt } };

test("weekly credit decision uses server prices and preserves microsecond version bytes", () => {
  assert.equal(isWeeklyCreditUsage(usage), true);
  assert.deepEqual(creditDecision(usage, "OPENAI", "luna"), { kind: "ready", remaining: 70, quote: { credits: 10, pricingUpdatedAt: "2026-10-04T12:00:00.123456Z" } });
  assert.equal(creditDecision(usage, "OPENAI", "terra").kind, "insufficient");
});
test("legacy, malformed, duplicate-rate and unavailable data fail closed without default prices", () => {
  for (const value of [null, {}, { ...usage, unit: undefined }, { ...usage, periodType: "MONTHLY" }, { ...usage, pricingUpdatedAt: "bad" }, { ...usage, remaining: -1 }, { ...usage, modelRates: [...usage.modelRates, usage.modelRates[0]] }, { ...usage, modelRates: [{ ...usage.modelRates[0], credits: 0 }] }]) {
    assert.equal(isWeeklyCreditUsage(value), false);
    assert.equal(creditDecision(value, "OPENAI", "luna").kind, "unavailable");
  }
});
test("unknown or disabled models never inherit another model's price", () => {
  assert.equal(creditDecision(usage, "OPENAI", "unknown").kind, "disabled");
  assert.equal(creditDecision({ ...usage, modelRates: [{ ...usage.modelRates[0], enabled: false }] }, "OPENAI", "luna").kind, "disabled");
});
test("explicit BYOK does not require or return a credit quote", () => {
  assert.deepEqual(creditDecision(null, "OPENAI", "personal", "key-id"), { kind: "byok" });
  const pending = new PendingRunStore().getOrCreate({ ...input, credentialId: "key-id" });
  assert.equal(pending.creditQuote, undefined);
});
test("admin contract rejects legacy settings and preserves server version", () => {
  const settings = { unit: "CREDITS", periodType: "WEEKLY", modelRates: usage.modelRates, limit: 100, maxLimit: 100000, epoch: 1, updatedAt: usage.pricingUpdatedAt, lastResetAt: null };
  assert.equal(isWeeklyCreditSettings(settings), true);
  assert.equal(isWeeklyCreditSettings({ ...settings, unit: undefined }), false);
  assert.equal(settings.updatedAt, usage.pricingUpdatedAt);
});
test("ambiguous retry keeps the original key, exact request and quote despite refreshed pricing", () => {
  const store = new PendingRunStore();
  const first = store.getOrCreate(input);
  store.settle(first.id, "uncertain");
  const retry = store.getOrCreate({ ...input, creditQuote: { credits: 50, pricingUpdatedAt: "2026-10-04T12:01:00Z" } });
  assert.equal(first.id, retry.id);
  assert.equal(retry.message, input.message);
  assert.deepEqual(retry.creditQuote, input.creditQuote);
  assert.equal(store.retries().length, 1);
});
test("explicit quote rejection permits a new user-confirmed quote and key", () => {
  const store = new PendingRunStore();
  const first = store.getOrCreate(input);
  store.settle(first.id, "rejected");
  const next = store.getOrCreate({ ...input, creditQuote: { credits: 20, pricingUpdatedAt: "2026-10-04T12:01:00Z" } });
  assert.notEqual(first.id, next.id);
  assert.equal(next.creditQuote.credits, 20);
  assert.equal(store.retries().length, 0);
});
test("new content/model/project stays separate while earlier ambiguous requests remain recoverable", () => {
  const store = new PendingRunStore(); const first = store.getOrCreate(input); store.settle(first.id, "uncertain");
  for (const change of [{ message: "New content" }, { model: "terra" }, { projectId: "other-project" }, { workspaceId: "other-workspace" }]) assert.notEqual(store.getOrCreate({ ...input, ...change }).id, first.id);
  assert.equal(store.getOrCreate(input).id, first.id);
  store.settle(first.id, "accepted"); assert.equal(store.retries().length, 0);
});
test("clearing the session cannot resurrect a late request or cross account scope", () => {
  const store = new PendingRunStore(); const first = store.getOrCreate(input); store.clear(); store.settle(first.id, "uncertain");
  assert.equal(store.retries().length, 0);
  assert.notEqual(store.getOrCreate(input).id, first.id);
});

test("inconsistent balances fail closed, but usage above a reduced limit is valid", () => {
  for (const data of [{ ...usage, limit: 0, used: 0, reserved: 0, remaining: 100 }, { ...usage, remaining: 100 }, { ...usage, remaining: 1 }]) {
    assert.equal(isWeeklyCreditUsage(data), false);
    assert.equal(creditDecision(data, "OPENAI", "luna").kind, "unavailable");
  }
  assert.equal(isWeeklyCreditUsage({ ...usage, limit: 10, remaining: 0 }), true);
});
const { AdminSettingsRequests } = await load("admin-settings-requests");
test("settings mutation invalidates old reads and freezes auth-recovery reads until settled", () => {
  const requests = new AdminSettingsRequests(); requests.setScope("user:workspace");
  const oldRead = requests.beginRead(); const mutation = requests.beginMutation();
  requests.setScope("user:workspace");
  assert.equal(requests.acceptsRead(oldRead), false);
  assert.equal(requests.beginRead(), null);
  assert.equal(requests.beginMutation(), null);
  assert.equal(requests.acceptsMutation(mutation), true);
  requests.finishMutation(mutation);
  assert.equal(requests.acceptsRead(oldRead), false);
  assert.equal(requests.acceptsRead(requests.beginRead()), true);
});
test("account changes invalidate settings mutations and cannot restore old account data", () => {
  const requests = new AdminSettingsRequests(); requests.setScope("user:workspace");
  const mutation = requests.beginMutation(); requests.setScope(null);
  assert.equal(requests.acceptsMutation(mutation), false);
  assert.equal(requests.beginRead(), null);
  requests.setScope("other:workspace"); const next = requests.beginMutation();
  requests.finishMutation(mutation);
  assert.equal(requests.acceptsMutation(next), true);
});
test("standalone AI generation stays disabled while manual editors remain", async () => {
  const pet = await readFile(new URL("../features/workspace/pets/pet-customizer.tsx", import.meta.url), "utf8");
  const basis = await readFile(new URL("../features/workspace/project/quotation/quote-item-basis.tsx", import.meta.url), "utf8");
  const builder = await readFile(new URL("../features/workspace/project/quotation/use-quote-builder.ts", import.meta.url), "utf8");
  assert.doesNotMatch(pet, /generatePet|onClick=.*generate\(/);
  assert.match(pet, /disabled aria-describedby/); assert.match(pet, /savePet\(session, draft\)/);
  assert.match(basis, /className="ai-assumption-button"\s+disabled/);
  assert.doesNotMatch(builder, /suggestQuotationAssumption/);
  assert.match(basis, /readOnly=\{!canWrite\}/);
});
