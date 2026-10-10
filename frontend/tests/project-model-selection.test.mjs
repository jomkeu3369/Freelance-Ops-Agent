import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const compile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const constants = {};
runInNewContext(await compile("../features/workspace/shared/constants.tsx"), { exports: constants, process: { env: {} } });
const selections = {};
// No storage, browser, network or API objects exist in this fixture. Selection
// changes are ephemeral data operations and cannot persist secrets or start work.
runInNewContext(await compile("../features/workspace/project/project-model-selection.ts"), {
  exports: selections, require: name => { assert.equal(name, "../shared/constants"); return constants; }
});
const { createProjectModelSelections, defaultProjectModelSelection, projectModelSelectionKey, updateProjectModelSelection, removeProjectModelSelection, renewProjectModelSelections, reconcileProjectModelSelections } = selections;
const owner = { userId: "user", workspaceId: "workspace" };
const key = (projectId = "a", session = owner, generation = 1) => projectModelSelectionKey(session, projectId, generation);

test("model and credential choices remain together for one project without mutating defaults", () => {
  let state = createProjectModelSelections();
  const revision = state.revision;
  state = updateProjectModelSelection(state, revision, key(), { model: "gpt-5.6-luna" });
  state = updateProjectModelSelection(state, revision, key(), { credentialId: "synthetic-connection" });
  assert.equal(state.values[key()].model, "gpt-5.6-luna");
  assert.equal(state.values[key()].credentialId, "synthetic-connection");
  state = updateProjectModelSelection(state, revision, key(), { credentialId: "" });
  assert.equal(state.values[key()].model, "gpt-5.6-luna");
  assert.equal(defaultProjectModelSelection.model, constants.configuredModelOptions.OPENAI[0]);
  assert.equal(defaultProjectModelSelection.credentialId, "");
});

test("account, workspace, project and login generation have separate selection keys", () => {
  const keys = [key(), key("b"), key("a", { ...owner, userId: "other" }), key("a", { ...owner, workspaceId: "other" }), key("a", owner, 2),
    key("a", { userId: "user:workspace", workspaceId: "" }), key("a", { userId: "user", workspaceId: "workspace:" })];
  assert.equal(new Set(keys).size, keys.length);
  const state = createProjectModelSelections();
  const updated = updateProjectModelSelection(state, state.revision, keys[0], { credentialId: "synthetic-connection" });
  for (const other of keys.slice(1)) assert.equal(updated.values[other], undefined);
});

test("fresh list or login state rejects old callbacks even for a recreated project ID", () => {
  const previous = createProjectModelSelections();
  const current = createProjectModelSelections();
  assert.equal(updateProjectModelSelection(current, previous.revision, key(), { credentialId: "old-connection" }), current);
  assert.equal(current.values[key()], undefined);
});

test("confirmed removal drops only that project's choices", () => {
  let state = createProjectModelSelections();
  for (const project of ["a", "b"]) state = updateProjectModelSelection(state, state.revision, key(project), { model: "gpt-5.6-luna" });
  const removed = removeProjectModelSelection(state, key());
  assert.equal(removed.values[key()], undefined);
  assert.equal(removed.values[key("b")].model, "gpt-5.6-luna");
  assert.equal(state.values[key()].model, "gpt-5.6-luna", "updates never mutate an earlier React snapshot");
});

test("creating B preserves A's personal connection while a recreated target ID rejects its old selection", () => {
  let state = createProjectModelSelections();
  const revision = state.revision;
  state = updateProjectModelSelection(state, revision, key(), { model: "gpt-5.6-luna", credentialId: "personal-a" });
  const created = renewProjectModelSelections(state, key("b"));
  assert.equal(created.values[key()].credentialId, "personal-a");
  assert.equal(created.values[key("b")], undefined);
  assert.equal(updateProjectModelSelection(created, revision, key("b"), { credentialId: "stale-b" }), created);
  const recreated = renewProjectModelSelections(created, key());
  assert.equal(recreated.values[key()], undefined);
  assert.equal(updateProjectModelSelection(recreated, created.revision, key(), { credentialId: "personal-a" }), recreated);
});

test("authoritative refresh retains owned live choices, prunes removed IDs and invalidates old callbacks", () => {
  let state = createProjectModelSelections();
  for (const target of [key(), key("b"), key("a", { ...owner, userId: "other" }), key("a", { ...owner, workspaceId: "other" }), key("a", owner, 0)]) {
    state = updateProjectModelSelection(state, state.revision, target, { model: "gpt-5.6-luna", credentialId: "chosen" });
  }
  const refreshed = reconcileProjectModelSelections(state, owner, ["a", "c"], 1);
  assert.deepEqual(Object.keys(refreshed.values), [key()]);
  assert.equal(refreshed.values[key()].credentialId, "chosen");
  assert.equal(updateProjectModelSelection(refreshed, state.revision, key(), { credentialId: "stale" }), refreshed);
  const recreated = reconcileProjectModelSelections(refreshed, owner, ["a", "b", "c"], 1);
  assert.equal(recreated.values[key("b")], undefined, "an ID observed missing never recovers its old selection");
  const login = reconcileProjectModelSelections(recreated, owner, ["a", "b"], 2);
  assert.equal(Object.keys(login.values).length, 0);
});

const workbenchSource = await compile("../features/workspace/project/project-workbench.tsx");
const usagePresentation = {};
runInNewContext(await compile("../app/lib/ai-usage-presentation.ts"), { exports: usagePresentation });
const availableModel = { provider: "OPENAI", model: "gpt-5.6-luna", catalogued: true, enabled: true, available: true, maxRunUsd: "1", reasoningEfforts: ["LOW"] };
const availableUsage = { spendingEnabled: true, remainingUsd: "10", models: [availableModel] };
function workbench(modelSelection, connections = [], connectionError = false, { permissions = ["agent.run"], usage = availableUsage } = {}) {
  const starts = [], changes = [];
  let stateIndex = 0;
  const overrides = [connections, connectionError];
  const imports = {
    react: {
      useState(initial) { const index = stateIndex++; return [index in overrides ? overrides[index] : typeof initial === "function" ? initial() : initial, () => {}]; },
      useRef: current => ({ current }), useEffect() {}, useCallback: fn => fn
    },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "../../../app/lib/ui-language": { useT: () => value => value },
    "../../../app/lib/api": { isSupportedProvider: provider => provider === "OPENAI" },
    "../../../app/lib/byok-presentation.mjs": { byokCostEstimate: () => ({ maxUsd: "1" }) },
    "../../../app/lib/ai-usage-presentation": usagePresentation,
    "../shared/constants": constants,
    "../shared/formatters": { projectClientLabel: () => "Synthetic client" },
    "../shared/use-dialog-focus-trap": { useDialogFocusTrap() {} },
    "../skills/skill-selector": { useSkillSelection: () => [{ mode: "AUTO" }, () => {}] },
    "../usage/use-ai-usage": { useAiUsage: () => ({ data: usage, loading: false }) },
    "./analysis/analysis-step": { AnalysisStep: "AnalysisStep" },
    "./analysis/chat-model-controls": { ChatModelControls: "ChatModelControls" }
  };
  const exports = {};
  runInNewContext(workbenchSource, { exports, require: name => imports[name] ?? {} });
  const tree = exports.ProjectWorkbench({ session: owner, project: { id: "a", title: "Synthetic", status: "LEAD" }, clients: [],
    run: null, runId: null, events: [], busy: false, streamState: "idle", snapshot: {}, permissions: new Set(permissions), initialStep: "agent",
    modelSelection, onModelSelectionChange: patch => changes.push(patch), pendingRetries: [], onRun: async (...args) => { starts.push(args); return true; } });
  function find(node, type) {
    if (!node || typeof node !== "object") return null;
    if (node.type === type) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const match = find(child, type); if (match) return match; }
    return null;
  }
  const analysis = find(tree, "AnalysisStep").props;
  const controls = find(analysis.composerTools, "ChatModelControls")?.props;
  return { analysis, controls, starts, changes };
}

test("restored missing, retired or unreadable personal connections remain explicit and cannot fall back", async () => {
  for (const [connections, failed] of [[[], false], [[{ id: "chosen", provider: "GEMINI", model: "retired" }], false], [[{ id: "chosen", provider: "OPENAI", model: "gpt-5.6-luna" }], true]]) {
    const f = workbench({ provider: "OPENAI", model: "gpt-5.6-luna", credentialId: "chosen" }, connections, failed);
    assert.equal(f.controls.credentialId, "chosen");
    assert.equal(f.analysis.modelAvailable, false);
    assert.equal(f.analysis.canSendAI, false);
    assert.equal(await f.analysis.onSendMessage("Synthetic message"), false);
    assert.equal(f.starts.length, 0);
    assert.equal(f.changes.length, 0);
  }
});

test("restored choices invoke nothing until explicit send and use the selected model/connection", async () => {
  for (const credentialId of ["", "chosen"]) {
    const f = workbench({ provider: "OPENAI", model: "gpt-5.6-luna", credentialId }, [{ id: "chosen", provider: "OPENAI", model: "gpt-5.6-sol" }]);
    assert.equal(f.analysis.canSendAI, true);
    f.controls.onModelChange("gpt-6-sol");
    f.controls.onCredentialChange("chosen");
    assert.equal(f.changes.length, 2);
    assert.equal(f.starts.length, 0);
    assert.equal(await f.analysis.onSendMessage("Synthetic message"), true);
    assert.deepEqual(Array.from(f.starts[0].slice(0, 3)), ["OPENAI", credentialId ? "gpt-5.6-sol" : "gpt-5.6-luna", credentialId || undefined]);
  }
});

test("a restored unavailable model remains selected and blocked instead of silently picking another", async () => {
  for (const models of [[], [{ ...availableModel, available: false }], [{ ...availableModel, enabled: false }], [{ ...availableModel, catalogued: false }]]) {
    const f = workbench({ provider: "OPENAI", model: "gpt-5.6-luna", credentialId: "" }, [], false, { usage: { ...availableUsage, models } });
    assert.equal(f.controls.model, "gpt-5.6-luna");
    assert.equal(f.analysis.canSendAI, false);
    await assert.rejects(f.analysis.onSendMessage("Synthetic message"));
    assert.equal(f.starts.length, 0);
    assert.equal(f.changes.length, 0);
  }
});

test("losing agent.run permission blocks restored model and personal-key choices without executing or resetting them", async () => {
  for (const credentialId of ["", "chosen"]) {
    const selection = { provider: "OPENAI", model: "gpt-5.6-luna", credentialId };
    const connections = [{ id: "chosen", provider: "OPENAI", model: "gpt-5.6-sol" }];
    const f = workbench(selection, connections, false, { permissions: [] });
    assert.equal(f.analysis.canRun, false);
    assert.equal(f.analysis.canSendAI, false);
    assert.equal(f.analysis.composerTools, null);
    assert.equal(await f.analysis.onSendMessage("Synthetic message"), false);
    assert.equal(f.starts.length, 0);
    assert.equal(f.changes.length, 0);
    const restored = workbench(selection, connections);
    assert.equal(restored.controls.model, selection.model);
    assert.equal(restored.controls.credentialId, credentialId);
    assert.equal(restored.starts.length, 0);
  }
});
