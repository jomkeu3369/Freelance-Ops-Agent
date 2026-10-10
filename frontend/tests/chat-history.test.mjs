import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { originalInputPresentation } from "../app/lib/chat-presentation.mjs";
import { englishUi } from "../app/lib/ui-english.mjs";

const unavailable = "이 요청의 원문을 불러올 수 없습니다.";
const partialAttachments = "일부 첨부 자료 정보를 불러올 수 없습니다.";
const partialInput = "이 요청의 원본 입력 일부를 불러올 수 없습니다.";
const text = "  Exact saved text · 원문\nSecond line  ";

test("healthy and legacy history preserve exact text without a warning", () => {
  for (const metadata of [{}, { originalInputStatus: "AVAILABLE", originalInputIssue: null }]) {
    assert.deepEqual(originalInputPresentation({ requirementText: text, ...metadata }), { text, notices: [] });
    assert.deepEqual(originalInputPresentation({ requirementText: "", ...metadata }), { text: "", notices: [] });
  }
});

test("unavailable inputs never become fabricated user messages or suppress run metadata", () => {
  for (const originalInputIssue of ["MISSING_START", "MALFORMED_PAYLOAD", "MISSING_INPUT", "INVALID_REQUIREMENT_TEXT"]) {
    const item = Object.freeze({ runId: "saved-run", status: "COMPLETED", createdAt: "2026-10-01T00:00:00Z", requirementText: null, originalInputStatus: "UNAVAILABLE", originalInputIssue });
    assert.deepEqual(originalInputPresentation(item), { text: null, notices: [unavailable] });
    assert.equal(item.runId, "saved-run");
    assert.equal(item.status, "COMPLETED");
    assert.equal(item.createdAt, "2026-10-01T00:00:00Z");
  }
  assert.deepEqual(originalInputPresentation({ requirementText: text, originalInputStatus: "UNAVAILABLE" }), { text: null, notices: [unavailable] });
  assert.deepEqual(originalInputPresentation({ requirementText: null }), { text: null, notices: [unavailable] });
});

test("partial attachment metadata keeps valid text and safe summaries", () => {
  const attachments = Object.freeze([{ name: "brief.txt", status: "COMPLETE", notice: "Saved summary" }]);
  const item = Object.freeze({ requirementText: text, originalInputStatus: "PARTIAL", originalInputIssue: "INVALID_ATTACHMENTS", attachments });
  assert.deepEqual(originalInputPresentation(item), { text, notices: [partialAttachments] });
  assert.equal(item.attachments, attachments);
  assert.deepEqual(originalInputPresentation({ ...item, requirementText: null }), { text: null, notices: [unavailable, partialAttachments] });
});

test("partial missing text keeps its distinct explanation, and unknown partial reasons still warn", () => {
  assert.deepEqual(originalInputPresentation({ requirementText: null, originalInputStatus: "PARTIAL", originalInputIssue: "INVALID_REQUIREMENT_TEXT" }), { text: null, notices: [unavailable] });
  assert.deepEqual(originalInputPresentation({ requirementText: text, originalInputStatus: "PARTIAL", originalInputIssue: null }), { text, notices: [partialInput] });
  for (const notice of [unavailable, partialAttachments, partialInput]) assert.equal(typeof englishUi[notice], "string", notice);
  assert.notEqual(englishUi[unavailable], englishUi[partialAttachments]);
});

test("input warnings are separate from user text and keep result fetch, retry, and opening paths", async () => {
  const chat = await readFile(new URL("../features/workspace/project/analysis/agent-chat.tsx", import.meta.url), "utf8");
  assert.match(chat, /originalInputPresentation\(item\)/);
  assert.match(chat, /originalInput\.text && <div className="agent-chat-message user"/);
  assert.match(chat, /originalInput\.notices\.map\(notice => <p className="agent-chat-input-notice"/);
  assert.match(chat, /if \(cancelled\) return;\s*setHistory\(items\)/);
  assert.match(chat, /onOpenResult\(view\)/);
  assert.match(chat, /setHistoryRevision\(value => value \+ 1\)/);
  assert.match(chat, /a\.createdAt\.localeCompare\(b\.createdAt\)/);
});

// Execute the real effect with controlled API promises and state setters. This
// catches lifecycle ordering without copying the implementation into a model.
const chatSource = await readFile(new URL("../features/workspace/project/analysis/agent-chat.tsx", import.meta.url), "utf8");
const effectStart = chatSource.indexOf("  useEffect(() => {\n    if (!canRun) return;");
assert.ok(effectStart >= 0);
const effectSource = chatSource.slice(effectStart, chatSource.indexOf("  const turns =", effectStart));
const effect = ts.transpileModule(effectSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const saved = (runId) => ({ runId, requirementText: `Original ${runId}`, status: "COMPLETED", createdAt: "2026-10-01T00:00:00Z" });
const view = (runId) => ({ runId, status: "COMPLETED", result: { projectSummary: `Result ${runId}` } });

function historyHarness() {
  const state = { history: [], pastRuns: {}, resultReads: {}, loading: false, error: null };
  const reads = [];
  const writes = [];
  const setter = (name) => value => { state[name] = typeof value === "function" ? value(state[name]) : value; writes.push(name); };
  function start({ history, results = {}, projectId = "project-one", session = { userId: "user-one", workspaceId: "space-one" }, runId = "current" }) {
    let cleanup;
    const dependencies = {
      useEffect: callback => { cleanup = callback(); }, canRun: true,
      listProjectAgentRunHistory: () => history, session, projectId, runId,
      getAgentRun: (_session, id) => { reads.push({ session, projectId, runId: id }); return results[id]?.() ?? Promise.resolve(view(id)); },
      setHistory: setter("history"), setPastRuns: setter("pastRuns"), setResultReads: setter("resultReads"),
      setLoading: setter("loading"), setError: setter("error"), t: value => value, historyRevision: 0,
    };
    Function(...Object.keys(dependencies), effect)(...Object.values(dependencies));
    return cleanup;
  }
  return { state, reads, writes, start };
}

test("history and ready results hydrate before a slow result, with independent failed-result state", async () => {
  const fixture = historyHarness();
  const slow = deferred();
  const items = [saved("healthy"), { ...saved("slow"), requirementText: null, originalInputStatus: "UNAVAILABLE" }, saved("failed"), saved("current")];
  const cleanup = fixture.start({ history: Promise.resolve(items), results: { slow: () => slow.promise, failed: () => Promise.reject(new Error("Temporary result outage")) } });
  await flush();
  assert.deepEqual(fixture.state.history, items);
  assert.deepEqual(fixture.state.pastRuns, { healthy: view("healthy") });
  assert.deepEqual(fixture.state.resultReads, { slow: "loading", failed: "failed" });
  assert.equal(fixture.state.loading, false);
  assert.equal(fixture.state.error, null);
  assert.deepEqual(fixture.reads.map(item => item.runId), ["healthy", "slow", "failed"]);
  slow.resolve(view("slow"));
  await flush();
  assert.equal(fixture.state.pastRuns.slow.result.projectSummary, "Result slow");
  assert.deepEqual(fixture.state.resultReads, { failed: "failed" });
  cleanup();
});

test("failed refreshes preserve readable history and results, without orphaned loading states", async () => {
  const fixture = historyHarness();
  const slow = deferred();
  const items = [saved("healthy"), saved("slow")];
  const cleanup = fixture.start({ history: Promise.resolve(items), results: { slow: () => slow.promise } });
  await flush();
  cleanup();
  const retryCleanup = fixture.start({ history: Promise.reject(new Error("History outage")) });
  await flush();
  assert.deepEqual(fixture.state.history, items);
  assert.deepEqual(fixture.state.pastRuns, { healthy: view("healthy") });
  assert.deepEqual(fixture.state.resultReads, { slow: "failed" });
  assert.equal(fixture.state.error, "History outage");
  const writeCount = fixture.writes.length;
  slow.resolve(view("slow"));
  await flush();
  assert.equal(fixture.writes.length, writeCount);
  retryCleanup();
  const resultRetryCleanup = fixture.start({ history: Promise.resolve(items), results: { healthy: () => Promise.reject(new Error("Result outage")) } });
  await flush();
  assert.deepEqual(fixture.state.history, items);
  assert.deepEqual(fixture.state.pastRuns, { healthy: view("healthy"), slow: view("slow") });
  assert.deepEqual(fixture.state.resultReads, { healthy: "failed" });
  assert.equal(fixture.state.error, null);
  resultRetryCleanup();
});

test("out-of-order results preserve the history list and duplicate identities read only once", async () => {
  const fixture = historyHarness();
  const first = deferred(), second = deferred();
  const items = [saved("first"), saved("second"), { ...saved("first"), requirementText: "Last duplicate wins in the timeline" }];
  const cleanup = fixture.start({ history: Promise.resolve(items), results: { first: () => first.promise, second: () => second.promise } });
  await flush();
  assert.deepEqual(fixture.reads.map(item => item.runId), ["first", "second"]);
  second.resolve(view("second"));
  await flush();
  assert.deepEqual(fixture.state.history, items);
  assert.deepEqual(fixture.state.pastRuns, { second: view("second") });
  assert.deepEqual(fixture.state.resultReads, { first: "loading" });
  first.resolve(view("first"));
  await flush();
  assert.deepEqual(fixture.state.history, items);
  assert.deepEqual(fixture.state.pastRuns, { second: view("second"), first: view("first") });
  cleanup();
});

test("immediate unmount prevents even scheduled loading and result-read startup", async () => {
  const fixture = historyHarness();
  const cleanup = fixture.start({ history: Promise.resolve([saved("obsolete")]) });
  cleanup();
  await flush();
  assert.deepEqual(fixture.reads, []);
  assert.deepEqual(fixture.writes, []);
});

for (const outcome of ["resolve", "reject"]) {
  test(`an obsolete history ${outcome} does not launch result reads or update current state`, async () => {
    const fixture = historyHarness();
    const old = deferred();
    const cleanup = fixture.start({ history: old.promise });
    await flush();
    cleanup();
    const nextCleanup = fixture.start({ history: Promise.resolve([saved("new")]), projectId: "project-two", session: { userId: "user-two", workspaceId: "space-two" } });
    await flush();
    const writeCount = fixture.writes.length;
    old[outcome](outcome === "resolve" ? [saved("obsolete")] : new Error("Obsolete failure"));
    await flush();
    assert.deepEqual(fixture.reads.map(item => item.runId), ["new"]);
    assert.deepEqual(fixture.state.history, [saved("new")]);
    assert.equal(fixture.writes.length, writeCount);
    nextCleanup();
  });
}

for (const outcome of ["resolve", "reject"]) {
  test(`late result ${outcome} cannot cross project/account scope or replace a newer same-project retry`, async () => {
    const fixture = historyHarness();
    const old = deferred();
    const cleanup = fixture.start({ history: Promise.resolve([saved("same-run")]), results: { "same-run": () => old.promise } });
    await flush();
    cleanup();
    const middleCleanup = fixture.start({ history: Promise.resolve([saved("other-run")]), projectId: "project-two", session: { userId: "user-two", workspaceId: "space-two" } });
    await flush();
    middleCleanup();
    const newest = { ...view("same-run"), result: { projectSummary: "Newer result" } };
    const nextCleanup = fixture.start({ history: Promise.resolve([saved("same-run")]), results: { "same-run": () => Promise.resolve(newest) } });
    await flush();
    const writeCount = fixture.writes.length;
    old[outcome](outcome === "resolve" ? view("same-run") : new Error("Obsolete failure"));
    await flush();
    assert.deepEqual(fixture.state.pastRuns, { "same-run": newest });
    assert.deepEqual(fixture.state.resultReads, {});
    assert.equal(fixture.writes.length, writeCount);
    nextCleanup();
  });
}
