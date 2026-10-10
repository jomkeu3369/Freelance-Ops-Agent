import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { supportedLocales, translateUi } from "../app/lib/ui-locale.mjs";
import { parseChatPolicyIntent } from "../app/lib/chat-policy-intent.mjs";

const base = new URL("../", import.meta.url);
const auto = { mode: "AUTO", manualIds: [], excludedIds: [], catalogVersion: "1.0.0" };
const draft = "Keep this exact request";
const retry = { id: "pending-one", userId: "user", workspaceId: "workspace", projectId: "project", provider: "OPENAI", model: "test-model", workflowMode: "AD_HOC", message: draft, attachmentIds: [], skillSelection: auto };

async function compile(path, modules) {
  const source = await readFile(new URL(path, base), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: name => { assert.ok(name in modules, `Unmocked import: ${name}`); return modules[name]; } });
  return exports;
}

async function render({ selection = auto, attachmentIds = [], ready = true, hasAttachments = attachmentIds.length > 0, message = draft, candidates = [retry], canRun = true, canSendAI = false, modelAvailable = true, locale = "ko", prepareResult = false, onSend = () => false } = {}) {
  let states = 0;
  const node = (type, props) => ({ type, props });
  const noop = () => {};
  const calls = { reads: 0, sends: 0 };
  const attachments = { prepare: async () => { calls.reads++; return prepareResult; }, items: hasAttachments ? [{}] : [], ids: attachmentIds, ready, confirmed: true, reading: false, error: "", tooLarge: false };
  const modules = {
    "react/jsx-runtime": { jsx: node, jsxs: node, Fragment: "fragment" },
    react: { useState: value => [states++ === 0 ? message : value, noop], useRef: value => ({ current: value }), useMemo: fn => fn(), useEffect: noop, useLayoutEffect: noop, useSyncExternalStore: () => true },
    "../../shared/chat-markdown": { ChatMarkdown: "ChatMarkdown" },
    "../../../../app/lib/ui-language": { useT: () => value => translateUi(value, locale), useUiLocale: () => locale },
    "../../../../app/lib/api": {},
    "@phosphor-icons/react": Object.fromEntries(["ChatCircleText", "ArrowUp", "ArrowDown", "ArrowUpRight", "CheckCircle", "CircleNotch", "WarningCircle", "WifiSlash", "ListChecks"].map(name => [name, name])),
    "./chat-settings-button": { ChatSettingsButton: "ChatSettingsButton" },
    "../../../../app/lib/chat-presentation.mjs": { chatState: () => ({ tone: "idle", label: "idle" }) },
    "../../../../app/lib/chat-policy-intent.mjs": { parseChatPolicyIntent },
    "../../shared/constants": {},
    "../../shared/activity-presentation": {},
    "../../skills/skill-selector": { useSkillSelection: () => [selection, noop], SkillNames: "SkillNames" },
    "./chat-attachments": { useChatAttachments: () => attachments, ChatAttachmentButton: "ChatAttachmentButton", ChatAttachments: "ChatAttachments" },
  };
  // Execute the actual matcher and component decision, with only effects and APIs stubbed.
  {
    const skillModule = await compile("features/workspace/skills/skill-selection.ts", {
      "./catalog.json": { default: JSON.parse(await readFile(new URL("features/workspace/skills/catalog.json", base), "utf8")) },
      "./routing.json": { default: JSON.parse(await readFile(new URL("features/workspace/skills/routing.json", base), "utf8")) },
    });
    modules["./chat-retry"] = await compile("features/workspace/project/analysis/chat-retry.ts", { "../../skills/skill-selection": skillModule, "../../../../app/lib/ui-locale.mjs": { supportedLocales, translateUi } });
  }
  const { AgentChat } = await compile("features/workspace/project/analysis/agent-chat.tsx", modules);
  let noticeRetry, noticePolicy;
  const tree = AgentChat({ session: { userId: "user", workspaceId: "workspace" }, projectId: "project", run: null, runId: null, events: [], busy: false, canRun, canEditPolicy: false, canCancel: true, modelAvailable, streamState: "idle", clarification: null, retryCandidates: candidates, canSendAI, onSend: async (...args) => { calls.sends++; return onSend(...args); }, composerInfo: (_, value, policy) => { noticeRetry = value; noticePolicy = policy; return null; } });
  function find(value, predicate) {
    if (Array.isArray(value)) return value.flatMap(child => find(child, predicate));
    if (!value || typeof value !== "object") return [];
    return [...(predicate(value) ? [value] : []), ...find(value.props?.children, predicate)];
  }
  return { send: find(tree, value => value.type === "button" && value.props.type === "submit")[0].props, noticeRetry, noticePolicy, calls, submit: async () => { find(tree, value => value.type === "form")[0].props.onSubmit({ preventDefault: noop }); await new Promise(setImmediate); } };
}

test("changing skills cannot present a new request as an authorized retry while spending is paused", async () => {
  const { send, noticeRetry } = await render({ selection: { ...auto, mode: "MANUAL", manualIds: [] } });
  assert.equal(send.disabled, true);
  assert.equal(noticeRetry, undefined);
});

test("changing or removing extracted attachments cannot inherit an earlier request's retry state", async () => {
  for (const attachmentIds of [[], ["different-attachment"]]) {
    const { send } = await render({ candidates: [{ ...retry, attachmentIds: ["original-attachment"] }], attachmentIds });
    assert.equal(send.disabled, true);
  }
});

test("an unread file permits only free reading and cannot inherit a text-only request's retry state", async () => {
  const { send, noticeRetry, calls, submit } = await render({ ready: false, hasAttachments: true });
  assert.equal(send["aria-label"], "파일 읽고 확인");
  assert.equal(send.disabled, false);
  assert.equal(noticeRetry, undefined);
  await submit();
  assert.deepEqual(calls, { reads: 1, sends: 0 });
});

for (const modelAvailable of [false, true]) {
  test(`free attachment reading does not require spending or a selected model (${modelAvailable})`, async () => {
    const { send, calls, submit } = await render({ ready: false, hasAttachments: true, candidates: [], modelAvailable });
    assert.equal(send.disabled, false);
    await submit();
    assert.deepEqual(calls, { reads: 1, sends: 0 });
  });
  test(`reviewed attachments cannot start paid work while spending is blocked (${modelAvailable})`, async () => {
    const { send, calls, submit } = await render({ attachmentIds: ["reviewed"], candidates: [], modelAvailable });
    assert.equal(send.disabled, true);
    await submit();
    assert.deepEqual(calls, { reads: 0, sends: 0 });
  });
}

test("free attachment reading still requires agent.run permission", async () => {
  const { send, calls, submit } = await render({ ready: false, hasAttachments: true, candidates: [], canRun: false });
  assert.equal(send.disabled, true);
  await submit();
  assert.deepEqual(calls, { reads: 0, sends: 0 });
});

test("an exact retry remains available while spending is paused", async () => {
  const { send, noticeRetry } = await render();
  assert.equal(send.disabled, false);
  assert.equal(noticeRetry, retry);
});


test("an attachment-only exact retry uses the same fallback message as submission", async () => {
  const original = { ...retry, message: "첨부 자료의 읽기 범위와 내용을 확인해 주세요.", attachmentIds: ["original-attachment"] };
  const { send, noticeRetry } = await render({ message: "", attachmentIds: original.attachmentIds, candidates: [original] });
  assert.equal(send.disabled, false);
  assert.equal(noticeRetry, original);
});

test("legacy omission, manual-empty, exclusions and attachment order remain distinct", async () => {
  for (const changed of [
    { ...retry, skillSelection: undefined },
    { ...retry, skillSelection: { ...auto, mode: "MANUAL" } },
    { ...retry, skillSelection: { ...auto, excludedIds: ["writing-proposal"] } },
    { ...retry, attachmentIds: ["two", "one"] },
  ]) {
    const { send, noticeRetry } = await render({ candidates: [changed], attachmentIds: changed.attachmentIds.length ? ["one", "two"] : [] });
    assert.equal(send.disabled, true);
    assert.equal(noticeRetry, undefined);
  }
});


test("composer notices receive the same attachment-aware policy classification as submission", async () => {
  const message = "기본 세율 10%로 변경";
  assert.equal((await render({ message, candidates: [] })).noticePolicy, true);
  assert.equal((await render({ message, candidates: [], hasAttachments: true, ready: false })).noticePolicy, false);
  assert.equal((await render({ message, candidates: [], attachmentIds: ["reviewed"] })).noticePolicy, false);
});


for (const locale of ["ko", "en"]) for (const canSendAI of [false, true]) {
  test(`attachment-only retry preserves its authorized message after switching to ${locale} (spending=${canSendAI})`, async () => {
    const original = { ...retry, message: translateUi("첨부 자료의 읽기 범위와 내용을 확인해 주세요.", locale === "ko" ? "en" : "ko"), attachmentIds: ["original-attachment"] };
    let submitted;
    const { send, noticeRetry, submit } = await render({ message: "", attachmentIds: original.attachmentIds, candidates: [original], locale, canSendAI, prepareResult: true, onSend: (...args) => { submitted = args; return false; } });
    assert.equal(send.disabled, false);
    assert.equal(noticeRetry, original);
    await submit();
    assert.equal(submitted[0], original.message);
    assert.deepEqual(submitted[1], original.attachmentIds);
    assert.deepEqual(submitted[2], original.skillSelection);
  });
}


test("locale fallback recovery cannot match changed content, files, skills, or another scope", async () => {
  const original = { ...retry, message: "첨부 자료의 읽기 범위와 내용을 확인해 주세요.", attachmentIds: ["one", "two"] };
  for (const changed of [
    { message: "New typed request" },
    { attachmentIds: ["two", "one"] },
    { attachmentIds: ["replacement"] },
    { attachmentIds: [] },
    { ready: false, hasAttachments: true },
    { selection: { ...auto, mode: "MANUAL", manualIds: [] } },
    { selection: { ...auto, excludedIds: ["writing-proposal"] } },
    { candidates: [{ ...original, message: "An arbitrary earlier request" }] },
    { candidates: [{ ...original, userId: "different-user" }] },
    { candidates: [{ ...original, workspaceId: "different-workspace" }] },
    { candidates: [{ ...original, projectId: "different-project" }] },
  ]) {
    const { noticeRetry, calls, submit } = await render({ message: "", attachmentIds: original.attachmentIds, candidates: [original], locale: "en", prepareResult: true, ...changed });
    assert.equal(noticeRetry, undefined);
    await submit();
    assert.equal(calls.sends, 0);
  }
});

test("a locale-preserved retry still requires current run permission and an available model", async () => {
  const original = { ...retry, message: "첨부 자료의 읽기 범위와 내용을 확인해 주세요.", attachmentIds: ["original-attachment"] };
  for (const blocked of [{ canRun: false }, { modelAvailable: false }]) {
    const { send, calls, submit } = await render({ message: "", attachmentIds: original.attachmentIds, candidates: [original], locale: "en", prepareResult: true, ...blocked });
    if (blocked.canRun === false) assert.equal(send.disabled, true);
    await submit();
    assert.equal(calls.sends, 0);
  }
});
