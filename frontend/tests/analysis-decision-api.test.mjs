import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
let directory, api;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "analysis-decision-api-"));
  await writeFile(join(directory, "shared-api.mjs"), 'export const calls = []; export const state = { source: null }; export async function request(path, options, token) { const call = {path, options, token}; calls.push(call); return path.endsWith("/sources/latest") ? state.source : call; }');
  await writeFile(join(directory, "query-cache.mjs"), "export const invalidated = []; export function invalidateQueries(prefix) { invalidated.push(prefix); }");
  const source = await readFile(new URL("../features/workspace/project/decisions/analysis-decisions-api.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } }).outputText;
  await writeFile(join(directory, "api.mjs"), output.replace('"@/app/lib/api"', '"./shared-api.mjs"').replace('"@/app/lib/query-cache"', '"./query-cache.mjs"'));
  api = await import(pathToFileURL(join(directory, "api.mjs")));
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
const session = { workspaceId: "workspace-one", accessToken: "synthetic-session-only" };
const base = "/api/v2/workspaces/workspace-one/projects/project-one/analysis-decisions";
test("source and historical reads reuse session recovery transport without cache or provider work", async () => {
  for (const [call, suffix] of [[() => api.listAnalysisDecisions(session, "project-one"), ""], [() => api.getLatestConfirmedDecision(session, "project-one"), "/latest-confirmed"], [() => api.getAnalysisDecision(session, "project-one", "decision-one"), "/decision-one"], [() => api.getLatestDecisionRevision(session, "project-one", "decision-one"), "/decision-one/latest-revision"]]) {
    const result = await call(); assert.equal(result.path, `${base}${suffix}`); assert.equal(result.options.cache, "no-store");
    assert.equal(result.options.method, undefined); assert.equal(result.options.body, undefined); assert.equal(result.token, session.accessToken);
  }
});
test("create sends only selected server source IDs and revision sends exact reviewed hash plus user text", async () => {
  const input = { requestId: "request-one", sourceRunId: "run-one", expectedProjectVersion: 4, selectedOpinionIds: ["run-one:LEAN"] };
  const created = await api.createAnalysisDecision(session, "project-one", input);
  assert.equal(created.path, base); assert.equal(created.options.method, "POST"); assert.deepEqual(JSON.parse(created.options.body), input);
  const revision = { requestId: "request-two", expectedContentHash: "a".repeat(64), bodyText: "사용자 수정\r\n😀  " };
  const revised = await api.reviseAnalysisDecision(session, "project-one", "decision-one", revision);
  assert.equal(revised.path, `${base}/decision-one/revisions`); assert.deepEqual(JSON.parse(revised.options.body), revision);
});
test("confirmation cannot transmit a replacement body or unsupported client-generated opinions", async () => {
  const reviewed = { id: "decision-one", contentHash: "a".repeat(64), bodyText: "ignored by confirmation", selectedOpinionIds: ["untrusted"] };
  const result = await api.confirmAnalysisDecision(session, "project-one", reviewed);
  assert.equal(result.path, `${base}/decision-one/confirm`);
  assert.deepEqual(JSON.parse(result.options.body), { expectedContentHash: reviewed.contentHash, confirmation: "CONFIRM_ANALYSIS_DECISION" });
  assert.equal(result.token, session.accessToken);
  const cache = await import(pathToFileURL(join(directory, "query-cache.mjs")));
  assert.deepEqual(cache.invalidated, ["documents:workspace-one", "document:workspace-one:"]);
});

test("nullable and valid bound source responses are readable while malformed protocol data fails closed", async () => {
  const transport = await import(pathToFileURL(join(directory, "shared-api.mjs")));
  transport.state.source = null;
  assert.equal(await api.getLatestAnalysisSource(session, "project-one"), null);
  const source = { runId: "run-one", sourceProjectVersion: 0, sourceCurrent: true, view: { runId: "run-one", status: "COMPLETED", result: null } };
  transport.state.source = source;
  assert.equal(await api.getLatestAnalysisSource(session, "project-one"), source);
  assert.deepEqual(transport.calls.at(-1), { path: `${base}/sources/latest`, options: { cache: "no-store" }, token: session.accessToken });
  for (const invalid of [[], {}, { ...source, sourceProjectVersion: -1 }, { ...source, sourceProjectVersion: "0" }, { ...source, sourceCurrent: undefined },
    { ...source, view: null }, { ...source, view: { runId: "another-run", status: "COMPLETED" } },
    { ...source, view: { runId: "run-one", status: "UNKNOWN" } }]) {
    transport.state.source = invalid;
    await assert.rejects(api.getLatestAnalysisSource(session, "project-one"), /분석 출처 응답/);
  }
});
