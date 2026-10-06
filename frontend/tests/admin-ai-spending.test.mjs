import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { translateUi } from "../app/lib/ui-locale.mjs";
const directory = await mkdtemp(join(tmpdir(), "admin-ai-spending-"));
after(() => rm(directory, { recursive: true, force: true }));
await writeFile(join(directory, "api.mjs"), "export async function request(path, options, token, recovery = true) { return {path, options, token, recovery}; }");
for (const name of ["admin-ai-spending", "admin-ai-spending-api", "admin-settings-requests"]) {
  const source = await readFile(new URL(`../app/lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  await writeFile(join(directory, `${name}.mjs`), outputText.replace('"./api"', '"./api.mjs"'));
}
const { parseUsdAmount, canonicalUsd, parseAiSpendingSettings, platformStartsPaused, modelStartsPaused, spendingModelKey } = await import(pathToFileURL(join(directory, "admin-ai-spending.mjs")));
const api = await import(pathToFileURL(join(directory, "admin-ai-spending-api.mjs")));
const { AdminSettingsRequests } = await import(pathToFileURL(join(directory, "admin-settings-requests.mjs")));
const settings = { currency: "USD", accountWeekUsd: "1.00000000", globalDayUsd: "20", globalWeekUsd: "100", maxBudgetUsd: 100000, maxModelRunUsd: 100, revision: 7, updatedAt: "2026-10-06T00:00:00.123456Z", spendingEnabled: false, models: [{ provider: "OPENAI", model: "synthetic", maxRunUsd: "0.12345678", enabled: true }] };

test("USD parsing preserves input and validates zero, eight-place boundaries and maxima", () => {
  for (const input of ["0", "0.00000000", "0.00000001", "0.12345678", "99999.99999999", "100000.00000000"]) assert.equal(parseUsdAmount(input), input);
  for (const input of ["", " ", " 1", "1 ", "1e-8", "+1", "-0", "-1", ".1", "1.", "01", "1,000", "0.000000001", "0.100000000", "100000.00000001", "100001", "NaN", "Infinity"]) assert.equal(parseUsdAmount(input), null, input);
  assert.equal(parseUsdAmount("100.00000000", "100"), "100.00000000");
  assert.equal(parseUsdAmount("100.00000001", "100"), null);
  assert.equal(parseUsdAmount("0", "0"), "0");
  assert.equal(parseUsdAmount("0.00000001", "0"), null);
  assert.equal(canonicalUsd("0.00000000"), "0");
  assert.equal(canonicalUsd("1.23000000"), "1.23");
  assert.equal(canonicalUsd("100000"), "100000");
});
test("snapshot accepts decimal numbers or strings without rounding monetary values", () => {
  const parsed = parseAiSpendingSettings(settings);
  assert.deepEqual(parsed, { ...settings, maxBudgetUsd: "100000", maxModelRunUsd: "100" });
  const tiny = parseAiSpendingSettings({ ...settings, accountWeekUsd: 0.00000001, globalDayUsd: 0.00000012, globalWeekUsd: 99999.99999999 });
  assert.equal(tiny.accountWeekUsd, "0.00000001");
  assert.equal(tiny.globalDayUsd, "0.00000012");
  assert.equal(tiny.globalWeekUsd, "99999.99999999");
  assert.equal(parsed.updatedAt, settings.updatedAt);
  assert.equal(parsed.revision, 7);
});
test("legacy, malformed, unsafe revision and out-of-bound responses fail closed", () => {
  for (const patch of [
    { currency: "CREDITS" }, { accountWeekUsd: null }, { accountWeekUsd: -1 }, { accountWeekUsd: -0 },
    { accountWeekUsd: "100000000000.00000000" }, { globalDayUsd: Infinity }, { globalWeekUsd: 1e-9 },
    { maxBudgetUsd: 100001 }, { maxModelRunUsd: 101 }, { revision: -1 }, { revision: 0.1 },
    { revision: "7" }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { spendingEnabled: "false" }, { updatedAt: "bad" },
    { models: null }, { models: [settings.models[0], settings.models[0]] },
    { models: [{ ...settings.models[0], enabled: "false" }] }, { models: [{ ...settings.models[0], model: "" }] },
    { models: [{ ...settings.models[0], maxRunUsd: "100.00000001" }] }
  ]) assert.equal(parseAiSpendingSettings({ ...settings, ...patch }), null, JSON.stringify(patch));
  for (const data of [null, undefined, [], {}, { unit: "CREDITS", limit: 100, epoch: 1 }]) assert.equal(parseAiSpendingSettings(data), null);
});
test("zero budgets and disabled spending pause new platform starts independently of model flags", () => {
  const enabled = parseAiSpendingSettings({ ...settings, spendingEnabled: true });
  assert.equal(platformStartsPaused(enabled), false);
  assert.equal(platformStartsPaused(parseAiSpendingSettings(settings)), true);
  for (const key of ["accountWeekUsd", "globalDayUsd", "globalWeekUsd"]) assert.equal(platformStartsPaused({ ...enabled, [key]: "0.00000000" }), true);
  assert.equal(modelStartsPaused(enabled.models[0]), false);
  assert.equal(modelStartsPaused({ ...enabled.models[0], enabled: false }), true);
  assert.equal(modelStartsPaused({ ...enabled.models[0], maxRunUsd: "0.00000000" }), true);
  assert.notEqual(spendingModelKey({ provider: "a:b", model: "c" }), spendingModelKey({ provider: "a", model: "b:c" }));
});
test("API transports reviewed USD strings and revision, with no reset or automatic write replay", async () => {
  const session = { accessToken: "synthetic-token" };
  const read = await api.getAiSpendingSettings(session);
  assert.equal(read.path, "/api/v2/admin/ai-spending");
  assert.equal(read.options.cache, "no-store");
  assert.equal(read.options.method, undefined);
  assert.equal(read.recovery, true);
  const budgets = { accountWeekUsd: "0.00000001", globalDayUsd: "99999.99999999", globalWeekUsd: "100000.00000000" };
  const write = await api.updateAiSpendingBudgets(session, 7, budgets);
  assert.equal(write.path, read.path);
  assert.equal(write.options.method, "PATCH");
  assert.equal(write.token, session.accessToken);
  assert.equal(write.recovery, false);
  assert.deepEqual(JSON.parse(write.options.body), { ...budgets, expectedRevision: 7 });
  const model = { ...settings.models[0], maxRunUsd: "0.00000000", enabled: false };
  const modelWrite = await api.updateAiSpendingModel(session, 8, model);
  assert.equal(modelWrite.path, "/api/v2/admin/ai-spending/models");
  assert.equal(modelWrite.options.method, "PATCH");
  assert.equal(modelWrite.recovery, false);
  assert.deepEqual(JSON.parse(modelWrite.options.body), { ...model, expectedRevision: 8 });
});
test("newer reads, one mutation, auth recovery and revocation obey session-generation guards", () => {
  const requests = new AdminSettingsRequests();
  requests.setScope("account-one:workspace");
  const stale = requests.beginRead(); const fresh = requests.beginRead();
  assert.equal(requests.acceptsRead(stale), false);
  assert.equal(requests.acceptsRead(fresh), true);
  const mutation = requests.beginMutation();
  assert.equal(requests.acceptsRead(fresh), false);
  assert.equal(requests.beginMutation(), null);
  assert.equal(requests.beginRead(), null);
  assert.equal(requests.setScope("account-one:workspace"), false);
  assert.equal(requests.acceptsMutation(mutation), true);
  requests.setScope(null);
  assert.equal(requests.acceptsMutation(mutation), false);
  requests.setScope("account-two:workspace");
  const nextRead = requests.beginRead(); requests.finishMutation(mutation);
  assert.equal(requests.acceptsRead(nextRead), true);
});
test("new UI cannot mutate legacy credits or enable spending, and dynamic copy is localized", async () => {
  const source = await readFile(new URL("../features/admin/free-usage-admin.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /resetAllFreeUsage|updateFreeUsageLimit|updateFreeModelRate|getFreeUsageSettings|parseFreeUsageLimit|kind: "reset"/);
  assert.doesNotMatch(source, /checked=\{[^}]*spendingEnabled|setSpendingEnabled/);
  assert.match(source, /parseAiSpendingSettings/);
  assert.match(source, /cause.status === 409/);
  assert.match(source, /cause.status === 403/);
  for (const key of ["계정당 주간 예산 (USD)", "전체 일간 예산 (USD)", "전체 주간 예산 (USD)", "예산은 0~{max} USD, 소수점 이하 최대 8자리로 입력해 주세요.", "모델 한도는 0~{max} USD, 소수점 이하 최대 8자리로 입력해 주세요."]) assert.doesNotMatch(translateUi(key, "en", { max: "100" }), /[가-힣]/);
});


test("existing NUMERIC(19,8) budgets remain exactly readable while edits retain the smaller ceiling", async () => {
  const large = { ...settings, accountWeekUsd: "99999999999.99999999", globalDayUsd: "12345678901.23456789", globalWeekUsd: "100000.00000001" };
  const parsed = parseAiSpendingSettings(large);
  assert.equal(parsed.accountWeekUsd, large.accountWeekUsd);
  assert.equal(parsed.globalDayUsd, large.globalDayUsd);
  assert.equal(parsed.globalWeekUsd, large.globalWeekUsd);
  assert.equal(parsed.maxBudgetUsd, "100000");
  for (const key of ["accountWeekUsd", "globalDayUsd", "globalWeekUsd"]) assert.equal(parseUsdAmount(parsed[key], parsed.maxBudgetUsd), null);
  // Even an unchanged over-limit field must be lowered before the combined budget PATCH.
  const partial = { accountWeekUsd: "100000", globalDayUsd: parsed.globalDayUsd, globalWeekUsd: parsed.globalWeekUsd };
  assert.equal(Object.values(partial).every(value => parseUsdAmount(value, parsed.maxBudgetUsd) !== null), false);
  const lowered = { accountWeekUsd: "100000.00000000", globalDayUsd: "99999.99999999", globalWeekUsd: "0.00000001" };
  assert.equal(Object.values(lowered).every(value => parseUsdAmount(value, parsed.maxBudgetUsd) !== null), true);
  const result = await api.updateAiSpendingBudgets({ accessToken: "synthetic" }, parsed.revision, lowered);
  assert.deepEqual(JSON.parse(result.options.body), { ...lowered, expectedRevision: 7 });
  assert.equal(parseAiSpendingSettings({ ...large, accountWeekUsd: "99999999999.999999999" }), null);
  assert.equal(parseAiSpendingSettings({ ...large, accountWeekUsd: "100000000000" }), null);
  // Large JSON numbers cannot preserve eight decimal places; fail closed instead of rounding them.
  assert.equal(parseAiSpendingSettings({ ...large, accountWeekUsd: 12345678901.234568 }), null);
  assert.doesNotMatch(translateUi("수정 상한을 초과한 기존 예산이 남아 있습니다. 저장하려면 세 예산을 모두 0~{max} USD 범위로 조정해 주세요.", "en", { max: "100000" }), /[가-힣]/);
});
