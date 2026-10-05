import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
let directory, api;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "ai-usage-presentation-"));
  const source = await readFile(new URL("../app/lib/ai-usage-presentation.ts", import.meta.url), "utf8");
  await writeFile(join(directory, "usage.mjs"), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } }).outputText);
  api = await import(pathToFileURL(join(directory, "usage.mjs")));
});
after(async () => { await rm(directory, { recursive: true, force: true }); });
const usage = { currency: "USD", limitUsd: "1.25", settledUsd: "0.25", reservedUsd: "0.1", remainingUsd: "0.9", remainingPercent: "72.000000", reservedPercent: "8.000000", periodStart: "2026-10-04T15:00:00Z", resetAt: "2026-10-11T15:00:00Z", timezone: "Asia/Seoul" };
Object.assign(usage, { spendingEnabled: true, models: [{ provider: "OPENAI", model: "server-model", catalogued: true, enabled: true, available: true, unavailableReason: null, reasoningEfforts: ["low"], maxRunUsd: "0.5" }] });
test("valid server monetary precision is retained; display rounding is explicitly marked", () => {
  assert.deepEqual(api.parseAiUsage(usage), usage);
  assert.equal(api.formatUsagePercent("0.000004", "en"), "≈0%");
  assert.equal(api.formatUsagePercent("0.000000000001", "en"), "≈0%");
  assert.equal(api.formatUsagePercent("72.123456789", "en"), "≈72.12%");
  assert.equal(api.formatUsagePercent("72.000000", "en"), "72%");
  assert.equal(api.formatUsagePercent(null, "en"), "—");
});
test("missing, negative, nonfinite and out-of-range values cannot paint a false ring", () => {
  for (const value of [null, {}, { remaining: 100 }, { ...usage, limitUsd: undefined }, { ...usage, remainingPercent: 101 }, { ...usage, reservedUsd: -1 }, { ...usage, remainingPercent: "NaN" }, { ...usage, currency: "KRW" }]) assert.equal(api.parseAiUsage(value), null);
  assert.equal(api.parseAiUsage({ ...usage, limitUsd: 0, remainingPercent: null, reservedPercent: null }).remainingPercent, null);
  assert.equal(api.parseAiUsage({ ...usage, limitUsd: 0, remainingPercent: 100 }), null);
});
test("history distinguishes unknown cost from zero and preserves cursor precision", () => {
  const item = { runId: "run-one", workspaceId: "workspace-one", model: "server-model", status: "UNKNOWN", startedAt: usage.periodStart, platformCostUsd: null, platformReservedUsd: "0.000123456789", usageKnown: false, byokInputTokens: null, byokOutputTokens: null };
  const result = api.parseAiUsageHistory({ items: [item], nextCursor: "opaque-cursor" });
  assert.deepEqual(result, { items: [item], nextCursor: "opaque-cursor" });
  assert.equal(api.parseAiUsageHistory({ total: 0 }), null);
  assert.equal(api.parseAiUsageHistory({ items: [{ ...item, platformCostUsd: -1 }] }), null);
});
test("included generation fails closed for unknown prices, unsupported models, paused spending and insufficient reservation capacity", () => {
  assert.equal(api.includedUsageBlocker(usage, "OPENAI", "server-model"), null);
  assert.equal(api.includedUsageBlocker(null, "OPENAI", "server-model"), "unverified");
  assert.equal(api.includedUsageBlocker({ ...usage, spendingEnabled: false }, "OPENAI", "server-model"), "paused");
  assert.equal(api.includedUsageBlocker(usage, "OPENAI", "unknown-model"), "model");
  assert.equal(api.includedUsageBlocker({ ...usage, remainingUsd: "0.1" }, "OPENAI", "server-model"), "insufficient");
  assert.equal(api.includedUsageBlocker({ ...usage, models: [{ ...usage.models[0], maxRunUsd: null }] }, "OPENAI", "server-model"), "model");
});
