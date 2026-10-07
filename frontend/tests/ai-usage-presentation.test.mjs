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
Object.assign(usage, { spendingEnabled: true, models: [{ provider: "OPENAI", model: "server-model", catalogued: true, enabled: true, available: true, unavailableReason: null, providerAccessVerified: false, reasoningEfforts: ["LOW"], maxRunUsd: "0.5" }] });
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
  const item = { runId: "run-one", model: "server-model", status: "UNKNOWN", startedAt: usage.periodStart, platformCostUsd: null, platformReservedUsd: "0.000123456789", usageKnown: false, byokInputTokens: null, byokOutputTokens: null };
  const result = api.parseAiUsageHistory({ items: [item], nextCursor: "opaque-cursor" });
  assert.deepEqual(result, { items: [item], nextCursor: "opaque-cursor" });
  assert.equal(api.parseAiUsageHistory({ total: 0 }), null);
  assert.equal(api.parseAiUsageHistory({ items: [{ ...item, platformCostUsd: -1 }] }), null);
});
test("included generation fails closed for unknown prices, unsupported models, paused spending and insufficient reservation capacity", () => {
  assert.equal(api.includedUsageBlocker({ ...usage, remainingUsd: "0.00000001" }, "OPENAI", "server-model"), null);
  assert.equal(api.includedUsageBlocker(usage, "OPENAI", "server-model"), null);
  assert.equal(api.includedUsageBlocker(null, "OPENAI", "server-model"), "unverified");
  assert.equal(api.includedUsageBlocker({ ...usage, spendingEnabled: false }, "OPENAI", "server-model"), "paused");
  assert.equal(api.includedUsageBlocker(usage, "OPENAI", "unknown-model"), "model");
  assert.equal(api.includedUsageBlocker({ ...usage, remainingUsd: "0" }, "OPENAI", "server-model"), "insufficient");
  assert.equal(api.includedUsageBlocker({ ...usage, models: [{ ...usage.models[0], maxRunUsd: null }] }, "OPENAI", "server-model"), "model");
});

test("real history envelope omits workspace id and preserves deleted and uncertain BYOK records", () => {
  const item = { runId: "deleted-run", model: "gpt-6-luna", status: "DELETED", startedAt: "2026-10-05T01:00:00Z", platformCostUsd: 0.00000001, platformReservedUsd: 0.00000002, usageKnown: false, byokInputTokens: 100, byokOutputTokens: 50, providerCalls: [{ fundingSource: "BYOK", usageKnown: false }] };
  assert.deepEqual(api.parseAiUsageHistory({ items: [item], nextCursor: null }), { items: [item], nextCursor: null });
  assert.equal(api.parseAiUsage({ ...usage, models: [{ ...usage.models[0], providerAccessVerified: undefined }] }), null);
});

test("zero use is exactly 100 percent and unavailable catalogue entries fail closed", () => {
  const full = { ...usage, settledUsd: 0, reservedUsd: 0, remainingUsd: 1.25, remainingPercent: 100, reservedPercent: 0, periodStart: "2026-10-05" };
  assert.equal(api.parseAiUsage(full).remainingPercent, 100);
  assert.equal(api.formatUsagePercent(full.remainingPercent, "en"), "100%");
  for (const patch of [{ available: false }, { enabled: false }, { catalogued: false }, { maxRunUsd: 0 }, { reasoningEfforts: ["HIGH"] }]) {
    assert.equal(api.includedUsageBlocker({ ...usage, models: [{ ...usage.models[0], ...patch }] }, "OPENAI", "server-model"), "model");
  }
});

test("new composer eligibility and header never depend on historical credit balances", async () => {
  const workbench = await readFile(new URL("../features/workspace/project/project-workbench.tsx", import.meta.url), "utf8");
  const step = await readFile(new URL("../features/workspace/project/analysis/analysis-step.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(workbench, /useCreditUsage|creditDecision|credit\.quote|modelRates=/);
  assert.doesNotMatch(step, /FreeUsageStatus|usageState/);
  assert.match(workbench, /retry\?\.creditQuote/);
  assert.match(workbench, /includedUsageBlocker/);
});

test("model options share Send's fail-closed catalog guard without claiming provider access", () => {
  assert.equal(api.isUsageModelSelectable(usage.models[0]), true);
  for (const patch of [{ available: false }, { enabled: false }, { catalogued: false }, { maxRunUsd: null }, { maxRunUsd: 0 }, { reasoningEfforts: ["HIGH"] }]) {
    assert.equal(api.isUsageModelSelectable({ ...usage.models[0], ...patch }), false);
  }
  assert.equal(api.modelUnavailableMessage("SPENDING_DISABLED"), "기본 제공 AI 실행이 현재 중지되어 있습니다.");
  assert.equal(api.modelUnavailableMessage("NEW_UNKNOWN_REASON"), "모델 지원 상태와 예약 상한을 확인해야 합니다.");
  assert.equal(api.reasoningEffortLabel("NONE"), "없음");
  assert.equal(api.reasoningEffortLabel("low"), "낮음");
  assert.equal(api.reasoningEffortLabel("FUTURE_VALUE"), "확인 필요");
});
