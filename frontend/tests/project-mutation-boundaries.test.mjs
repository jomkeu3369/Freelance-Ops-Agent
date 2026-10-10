import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { parseWorkspacePath, buildWorkspacePath } from "../app/lib/workspace-navigation.mjs";

const compile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const shellSource = await compile("../features/workspace/workspace-shell.tsx");
const reconciler = {};
runInNewContext(await compile("../features/workspace/projects/reconcile-project.ts"), { exports: reconciler });
const modelSelectionHelpers = {};
runInNewContext(await compile("../features/workspace/project/project-model-selection.ts"), {
  exports: modelSelectionHelpers, require: () => ({ configuredModelOptions: { OPENAI: ["default-model"] } })
});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const project = (id, overrides = {}) => ({ id, workspaceId: "workspace", title: `Project ${id}`, requirementText: "Synthetic requirements", status: "LEAD", updatedAt: "2026-10-01T00:00:00Z", ...overrides });
const edited = (value, title = "Saved A") => ({ ...value, title, updatedAt: "2026-10-02T00:00:00Z" });
class ApiError extends Error { constructor(message, status, code) { super(message); Object.assign(this, { status, code }); } }

function fixture() {
  const state = { session: { userId: "user", workspaceId: "workspace", accessToken: "synthetic", refreshToken: "synthetic", accessTokenExpiresAt: "2099-01-01" }, generation: 1,
    projects: [project("a"), project("b")], listReads: [], creates: [], edits: [], deletes: [], reads: [], latestReads: [], starts: [], routes: [], runByProject: {}, mutation: deferred(), read: null };
  const states = [], refs = [], effects = [], memoized = [];
  let cursor = 0, tree, dirty = true, sessionRecovery;
  const browser = new EventTarget();
  Object.assign(browser, { location: { pathname: "/workspace/projects/a/intake", search: "" }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), setTimeout: () => 1, clearTimeout() {}, scrollTo() {} });
  const react = {
    useState(value) { const i = cursor++; if (!(i in states)) states[i] = typeof value === "function" ? value() : value; return [states[i], value => { const next = typeof value === "function" ? value(states[i]) : value; if (!Object.is(next, states[i])) dirty = true; states[i] = next; }]; },
    useRef(value) { const i = cursor++; return refs[i] ??= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!memoized[i] || deps.some((value, j) => value !== memoized[i].deps[j])) memoized[i] = { value: fn(), deps }; return memoized[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((value, j) => value !== effects[i].deps[j])) { effects[i]?.cleanup?.(); effects[i] = { fn, deps, pending: true }; } },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); }
  };
  const api = {
    ApiError, loadSession: () => state.session, currentSessionGeneration: () => state.generation,
    saveSession(value) { if (value.userId !== state.session?.userId) state.generation++; state.session = value; },
    clearSession() { state.session = null; state.generation++; }, revokeAuthSession: async () => {},
    subscribeToSessionRecovery: listener => { sessionRecovery = listener; return () => {}; }, subscribeToFreeUsageExhausted: () => () => {},
    getMe: async () => ({ displayName: "Fixture", workspaces: [{ workspaceId: state.session.workspaceId, effectivePermissions: ["project.read", "project.write", "project.delete", "agent.run"] }] }),
    listProjects: async owner => { state.listReads.push(owner.workspaceId); const snapshot = state.projects.map(value => ({ ...value })); const barrier = state.nextListRead; state.nextListRead = null; if (barrier) await barrier.promise; return snapshot; }, listClients: async () => [],
    getLatestProjectAgentRun: async (_session, id) => { state.latestReads.push(id); return state.runByProject[id] ?? null; },
    updateProjectDetails: async (owner, target, input) => { state.edits.push({ owner, target, input }); return state.mutation.promise; },
    createProject: async (owner, input) => { const created = project(state.createdProjectId ?? "c", { ...input, workspaceId: owner.workspaceId }); state.creates.push(created); state.projects = [...state.projects.filter(value => value.id !== created.id), created]; return created; },
    deleteProject: async (owner, id) => { state.deletes.push({ owner, id }); return state.mutation.promise; },
    readProject: async (owner, id) => { state.reads.push({ owner, id }); if (state.read) return state.read.promise; const value = state.projects.find(value => value.id === id); if (!value) throw new ApiError("missing", 404); return value; },
    startAgentRun: async (_session, target) => { const run = { runId: `new-${target.id}`, status: "RUNNING" }; state.starts.push(target.id); state.runByProject[target.id] = run; return run; },
    getAgentRun: async (_session, id) => Object.values(state.runByProject).find(value => value.runId === id),
    streamRunEvents: async () => {}, isFreeUsageExhausted: () => false,
    isCreditQuoteRefreshRequired: () => false, isPlatformSpendUnavailable: () => false
  };
  const router = Object.fromEntries(["push", "replace"].map(kind => [kind, path => { state.routes.push({ kind, path }); if (!state.deferNavigation) browser.location.pathname = path; dirty = true; }]));
  class PendingRunStore { getOrCreate(input) { return { ...input, id: "synthetic-run-key" }; } settle() {} retries() { return []; } clear() {} }
  const imports = {
    react, "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "next/navigation": { usePathname: () => browser.location.pathname, useRouter: () => router },
    "next-themes": { useTheme: () => ({ resolvedTheme: "light", setTheme() {} }) },
    "./workspace-context": { WorkspaceContext: { Provider: "Provider" } },
    "./projects/reconcile-project": reconciler,
    "./project/project-model-selection": modelSelectionHelpers,
    "../../app/lib/api": api, "../../app/lib/pending-run-store": { PendingRunStore },
    "../../app/lib/ui-language": { useT: () => value => value },
    "../../app/lib/workspace-navigation.mjs": { parseWorkspacePath, buildWorkspacePath },
    "../../app/lib/session-timing.mjs": { sessionRefreshDelay: () => 999999 },
    "../../app/lib/stream-retry.mjs": { isActiveStreamStatus: value => value === "RUNNING", streamReconnectDelay: () => 99999 },
    "../../app/components/live-workflow": { snapshotFromEvents: () => ({}) },
    "./shared/constants": { terminalStatuses: new Set(["COMPLETED"]) },
    "./workspace-chrome": { WorkspaceChrome: "Chrome" },
    "./project/dialogs/project-dialog": { ProjectDialog: "ProjectDialog" },
    "@/app/lib/project-intake-draft.mjs": { createProjectIntakeDraft: () => ({}), projectIntakeDraftScope: session => `${session.userId}:${session.workspaceId}` },
    "./auth/auth-gate": { AuthGate: "AuthGate" }
  };
  const exports = {};
  runInNewContext(shellSource, { exports, require: name => imports[name] ?? {}, window: browser, AbortController,
    document: { activeElement: null, querySelector: () => null }, HTMLElement: class {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, CSS: { escape: value => value }, Date, Promise, Set });
  function find(type, node) {
    if (!node || typeof node !== "object") return null;
    if (node.type === type) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = find(type, child); if (found) return found; }
    return null;
  }
  async function settle() {
    for (let i = 0; i < 25; i++) {
      if (dirty) { dirty = false; cursor = 0; tree = exports.WorkspaceShell({ children: "screen" }); }
      for (const effect of effects) if (effect?.pending) { effect.pending = false; effect.cleanup = effect.fn(); }
      await Promise.resolve();
    }
  }
  const screens = () => find("Provider", tree).props.value;
  const chrome = () => find("Chrome", tree).props;
  return { state, settle, screens, chrome, browser,
    async select(id) { chrome().onSelectProject(screens().projects.projects.find(value => value.id === id)); await settle(); },
    async start() { await screens().project.onRun("OPENAI", "fixture-model"); await settle(); },
    async create(id) { state.createdProjectId = id; screens().projects.onCreate(); await settle(); await find("ProjectDialog", tree).props.onCreate({ title: `Created ${id}` }); await settle(); },
    async authenticate(value) { await find("AuthGate", tree).props.onAuthenticated(value); await settle(); },
    async commitRoute() { browser.location.pathname = state.routes.at(-1).path; state.deferNavigation = false; dirty = true; await settle(); },
    popNow(path) { browser.location.pathname = path; browser.dispatchEvent(new Event("popstate")); dirty = true; },
    async pop(path) { this.popNow(path); await settle(); },
    async account(value) { state.session = value; state.generation++; sessionRecovery(value); await settle(); },
    async rotateTokens() { state.session = { ...state.session, accessToken: "rotated-synthetic-access", refreshToken: "rotated-synthetic-refresh" }; sessionRecovery(state.session); await settle(); },
    text: () => JSON.stringify(tree)
  };
}

test("late edit of A reconciles its list entry without clearing B's current execution", async () => {
  const f = fixture(); await f.settle();
  const pending = f.screens().project.onSaveProject({ title: "Saved A" });
  await f.select("b"); await f.start();
  f.state.mutation.resolve(edited(f.state.projects[0])); await pending; await f.settle();
  assert.equal(f.screens().project.project.id, "b"); assert.equal(f.screens().project.runId, "new-b");
  assert.equal(f.screens().projects.projects.find(value => value.id === "a").title, "Saved A");
  assert.equal(f.state.edits.length, 1);
});

test("A→B→A and a newer same-view run both survive an old edit completion", async () => {
  for (const returnToA of [true, false]) {
    const f = fixture(); await f.settle(); const pending = f.screens().project.onSaveProject({ title: "Saved A" });
    if (returnToA) { await f.select("b"); await f.select("a"); }
    await f.start(); const reads = f.state.latestReads.length;
    f.state.mutation.resolve(edited(f.state.projects[0])); await pending; await f.settle();
    assert.equal(f.screens().project.runId, "new-a"); assert.equal(f.screens().project.project.title, "Saved A");
    assert.equal(f.state.latestReads.length, reads, "detail reconciliation must not reload/reset execution");
  }
});

test("late delete removes A without clearing or navigating away from B", async () => {
  const f = fixture(); await f.settle(); const pending = f.screens().project.onDelete();
  await f.select("b"); await f.start(); const routes = f.state.routes.length;
  f.state.mutation.resolve(); await pending; await f.settle();
  assert.equal(f.screens().project.project.id, "b"); assert.equal(f.screens().project.runId, "new-b");
  assert.equal(f.screens().projects.projects.some(value => value.id === "a"), false);
  assert.equal(f.state.routes.length, routes); assert.equal(f.state.deletes.length, 1);
});

test("late delete after returning to A leaves an unavailable view, preserving newer run and route", async () => {
  const f = fixture(); await f.settle(); const pending = f.screens().project.onDelete();
  await f.select("b"); await f.select("a"); await f.start(); const routes = f.state.routes.length;
  f.state.mutation.resolve(); await pending; await f.settle();
  assert.equal(f.screens().project.runId, "new-a"); assert.equal(f.state.routes.length, routes);
  assert.match(f.text(), /이 프로젝트는 삭제되어/);
  await f.select("b"); assert.equal(f.screens().project.project.id, "b"); assert.doesNotMatch(f.text(), /이 프로젝트는 삭제되어/);
  await f.pop("/workspace/projects/a/intake"); assert.equal(f.browser.location.pathname, "/workspace/projects");
});

test("normal confirmed edit resets old analysis and normal delete returns to the list", async () => {
  for (const kind of ["edit", "delete"]) {
    const f = fixture(); await f.settle(); await f.start();
    const pending = kind === "edit" ? f.screens().project.onSaveProject({}) : f.screens().project.onDelete();
    f.state.mutation.resolve(kind === "edit" ? edited(f.state.projects[0]) : undefined); await pending; await f.settle();
    assert.equal(f.screens().project?.runId ?? null, null);
    if (kind === "delete") assert.equal(f.browser.location.pathname, "/workspace/projects");
  }
});

test("workspace switches and new-account generations reject old responses even for the same project ID", async () => {
  for (const change of ["workspace", "account", "relogin", "logout"]) {
    const f = fixture(); await f.settle(); const pending = f.screens().project.onSaveProject({});
    if (change === "workspace") {
      f.state.projects = [project("a", { workspaceId: "other", title: "Other workspace A" })];
      await f.chrome().onSwitchWorkspace("other"); await f.settle();
    } else await f.account(change === "logout" ? null : { ...f.state.session, userId: change === "account" ? "other" : "user" });
    f.state.mutation.resolve(edited(project("a"))); await pending; await f.settle();
    if (change !== "logout") assert.notEqual(f.screens().projects.projects[0]?.title, "Saved A");
    assert.equal(f.state.reads.length, 0);
  }
});

test("same-ID replacement after workspace return is freshly read, never overwritten or removed by old completion", async () => {
  for (const kind of ["edit", "delete"]) {
    const f = fixture(); await f.settle(); const pending = kind === "edit" ? f.screens().project.onSaveProject({}) : f.screens().project.onDelete();
    f.state.projects = [project("a", { workspaceId: "other" })]; await f.chrome().onSwitchWorkspace("other"); await f.settle();
    f.state.projects = [project("a", { title: "Recreated A", updatedAt: "2026-10-03T00:00:00Z" })]; await f.chrome().onSwitchWorkspace("workspace"); await f.settle();
    await f.select("a"); await f.start(); const routes = f.state.routes.length;
    f.state.mutation.resolve(kind === "edit" ? edited(project("a")) : undefined); await pending; await f.settle();
    assert.equal(f.state.reads.length, 1); assert.equal(f.screens().project.project.title, "Recreated A");
    assert.equal(f.screens().project.runId, "new-a"); assert.equal(f.state.routes.length, routes);
  }
});

test("uncertain delete is reported once and never automatically retried or removed", async () => {
  const f = fixture(); await f.settle(); const pending = f.screens().project.onDelete();
  f.state.mutation.reject(new Error("synthetic lost response")); await assert.rejects(pending, /lost response/); await f.settle();
  assert.equal(f.state.deletes.length, 1); assert.equal(f.screens().projects.projects.length, 2); assert.equal(f.state.reads.length, 0);
});


test("a late delete cannot redirect a newer route while its Next navigation is still pending", async () => {
  for (const target of ["a", "b"]) {
    const f = fixture(); await f.settle(); const pending = f.screens().project.onDelete();
    f.state.deferNavigation = true;
    if (target === "a") f.screens().project.onStepChange("quote");
    else f.chrome().onSelectProject(f.screens().projects.projects[1]);
    await f.settle(); const routes = f.state.routes.length;
    f.state.mutation.resolve(); await pending; await f.settle();
    assert.equal(f.state.routes.length, routes);
    await f.commitRoute(); assert.equal(f.state.routes.length, routes);
    if (target === "a") assert.match(f.text(), /이 프로젝트는 삭제되어/);
    else assert.equal(f.screens().project.project.id, "b");
  }
});

test("logout and a fresh same-ID login clear the unavailable project marker", async () => {
  const f = fixture(); await f.settle(); const owner = { ...f.state.session };
  const pending = f.screens().project.onDelete(); await f.select("b"); await f.select("a");
  f.state.mutation.resolve(); await pending; await f.settle(); assert.match(f.text(), /이 프로젝트는 삭제되어/);
  await f.chrome().logout(); await f.settle();
  f.state.projects = [project("a", { title: "Recreated A" })]; await f.authenticate(owner);
  assert.equal(f.screens().project.project.title, "Recreated A"); assert.doesNotMatch(f.text(), /이 프로젝트는 삭제되어/);
});

test("a freshness read cannot contaminate a different account or a later workspace load", async () => {
  for (const change of ["account", "workspace"]) {
    const f = fixture(); await f.settle(); const pending = f.screens().project.onDelete();
    await f.chrome().onSwitchWorkspace("other"); await f.settle();
    await f.chrome().onSwitchWorkspace("workspace"); await f.settle();
    f.state.read = deferred(); f.state.mutation.resolve(); await f.settle(); assert.equal(f.state.reads.length, 1);
    if (change === "account") await f.account({ ...f.state.session, userId: "new-user" });
    else { await f.chrome().onSwitchWorkspace("other"); await f.settle(); }
    f.state.read.resolve(project("a", { title: "Stale verification" })); await pending; await f.settle();
    assert.notEqual(f.screens().projects.projects[0].title, "Stale verification");
  }
});


test("delete completion between Back/Forward and React effects cannot redirect or render B under A", async () => {
  const f = fixture(); await f.settle(); const pending = f.screens().project.onDelete();
  await f.select("b"); await f.start(); const routes = f.state.routes.length;
  f.popNow("/workspace/projects/a/intake"); f.state.mutation.resolve(); await pending; await f.settle();
  assert.equal(f.browser.location.pathname, "/workspace/projects/a/intake"); assert.equal(f.state.routes.length, routes);
  assert.match(f.text(), /이 프로젝트는 삭제되어/); assert.equal(f.chrome().selectedProjectId, null);
  assert.equal(f.screens().project.runId, "new-b");
  await f.select("b"); assert.doesNotMatch(f.text(), /이 프로젝트는 삭제되어/); assert.equal(f.screens().project.runId, "new-b");
});


test("an older edit response does not replace newer details or reset their current execution", async () => {
  const f = fixture(); await f.settle(); await f.start(); const pending = f.screens().project.onSaveProject({});
  const newer = project("a", { title: "Newer details", updatedAt: "2026-10-03T00:00:00Z" });
  f.screens().projects.onProjectUpdated(newer); await f.settle();
  f.state.mutation.resolve(edited(project("a"))); await pending; await f.settle();
  assert.equal(f.screens().project.project.title, "Newer details"); assert.equal(f.screens().project.runId, "new-a");
});

test("confirmed deletion across a reload verifies absence, while a failed verification never retries the write", async () => {
  for (const missing of [true, false]) {
    const f = fixture(); await f.settle(); const pending = f.screens().project.onDelete();
    await f.chrome().onSwitchWorkspace("other"); await f.settle();
    await f.chrome().onSwitchWorkspace("workspace"); await f.settle(); await f.select("a");
    f.state.read = deferred(); f.state.mutation.resolve(); await f.settle();
    f.state.read.reject(new ApiError(missing ? "missing" : "offline", missing ? 404 : 503)); await pending; await f.settle();
    assert.equal(f.state.deletes.length, 1); assert.equal(f.state.reads.length, 1);
    if (missing) { assert.match(f.text(), /이 프로젝트는 삭제되어/); assert.equal(f.screens().projects.projects.some(value => value.id === "a"), false); }
    else { assert.match(f.text(), /프로젝트 변경은 완료됐지만/); assert.equal(f.screens().projects.projects.some(value => value.id === "a"), true); }
  }
});

test("a deletion completing during a pending return from B to A follows the requested route", async () => {
  const f = fixture(); await f.settle(); const pending = f.screens().project.onDelete();
  await f.select("b"); f.state.deferNavigation = true; await f.select("a"); const routes = f.state.routes.length;
  f.state.mutation.resolve(); await pending; await f.settle();
  assert.match(f.text(), /이 프로젝트는 삭제되어/); assert.equal(f.state.routes.length, routes);
  await f.commitRoute(); assert.equal(f.browser.location.pathname, "/workspace/projects/a/agent");
  assert.match(f.text(), /이 프로젝트는 삭제되어/); assert.equal(f.state.routes.length, routes);
});


test("a workspace list requested before confirmed deletion cannot later resurrect that project", async () => {
  const f = fixture(); await f.settle(); const pending = f.screens().project.onDelete();
  await f.chrome().onSwitchWorkspace("other"); await f.settle();
  const oldList = f.state.nextListRead = deferred(); const reload = f.chrome().onSwitchWorkspace("workspace"); await f.settle();
  f.state.projects = [project("b")]; f.state.mutation.resolve(); await pending; await f.settle();
  oldList.resolve(); await reload; await f.settle();
  assert.equal(f.screens().projects.projects.some(value => value.id === "a"), false);
  assert.equal(f.state.deletes.length, 1);
});


test("explicit models and connection IDs live above step remounts and remain project-scoped", async () => {
  const f = fixture(); await f.settle();
  f.screens().project.onModelSelectionChange({ model: "chosen-model", credentialId: "chosen-connection" }); await f.settle();
  for (const step of ["agent", "intake", "quote", "agent"]) {
    f.screens().project.onStepChange(step); await f.settle();
    assert.equal(f.screens().project.modelSelection.model, "chosen-model");
    assert.equal(f.screens().project.modelSelection.credentialId, "chosen-connection");
  }
  await f.select("b"); assert.equal(f.screens().project.modelSelection.model, "default-model");
  f.screens().project.onModelSelectionChange({ model: "model-b" }); await f.settle();
  await f.select("a"); assert.equal(f.screens().project.modelSelection.credentialId, "chosen-connection");
  assert.equal(f.state.starts.length, 0); assert.equal(f.state.edits.length, 0);
});

test("new list and login incarnations reject stale model-selection callbacks even with the same project ID", async () => {
  for (const change of ["workspace", "login"]) {
    const f = fixture(); await f.settle(); const owner = { ...f.state.session };
    const oldSelection = f.screens().project.onModelSelectionChange;
    oldSelection({ model: "old-model", credentialId: "old-connection" }); await f.settle();
    if (change === "workspace") {
      await f.chrome().onSwitchWorkspace("other"); await f.settle();
      await f.chrome().onSwitchWorkspace("workspace"); await f.settle(); await f.select("a");
    } else { await f.chrome().logout(); await f.settle(); await f.authenticate(owner); }
    oldSelection({ model: "stale-model", credentialId: "stale-connection" }); await f.settle();
    assert.equal(f.screens().project.modelSelection.model, "default-model");
    assert.equal(f.screens().project.modelSelection.credentialId, "");
    f.screens().project.onModelSelectionChange({ model: "new-model" }); await f.settle();
    assert.equal(f.screens().project.modelSelection.model, "new-model");
  }
});

test("confirmed removal drops only that project's model selection and rejects its stale callbacks", async () => {
  const f = fixture(); await f.settle(); const oldSelection = f.screens().project.onModelSelectionChange;
  oldSelection({ model: "model-a", credentialId: "connection-a" }); await f.settle();
  const pending = f.screens().project.onDelete(); await f.select("b");
  f.screens().project.onModelSelectionChange({ model: "model-b", credentialId: "connection-b" }); await f.settle();
  f.state.mutation.resolve(); await pending; await f.settle();
  oldSelection({ model: "stale-model" }); await f.settle();
  assert.equal(f.screens().project.modelSelection.model, "model-b");
  assert.equal(f.screens().project.modelSelection.credentialId, "connection-b");
  assert.equal(f.screens().projects.projects.some(project => project.id === "a"), false);
});


test("creating an unrelated project preserves A's explicit connection but a recreated A starts clean", async () => {
  const f = fixture(); await f.settle();
  f.screens().project.onModelSelectionChange({ model: "model-a", credentialId: "connection-a" }); await f.settle();
  const oldSelection = f.screens().project.onModelSelectionChange;
  await f.create("c"); assert.equal(f.screens().project.modelSelection.credentialId, "");
  await f.select("a"); assert.equal(f.screens().project.modelSelection.credentialId, "connection-a");
  await f.create("a"); assert.equal(f.screens().project.modelSelection.credentialId, "");
  oldSelection({ credentialId: "stale-connection" }); await f.settle();
  assert.equal(f.screens().project.modelSelection.credentialId, ""); assert.equal(f.state.starts.length, 0);
});


test("ordinary token recovery preserves explicit model and connection without starting a list reload", async () => {
  const f = fixture(); await f.settle();
  f.screens().project.onModelSelectionChange({ model: "chosen-model", credentialId: "chosen-connection" }); await f.settle();
  const generation = f.state.generation, reads = f.state.listReads.length; await f.rotateTokens();
  assert.equal(f.state.listReads.length, reads);
  assert.equal(f.state.generation, generation);
  assert.equal(f.screens().project.modelSelection.model, "chosen-model");
  assert.equal(f.screens().project.modelSelection.credentialId, "chosen-connection");
  assert.equal(f.state.starts.length, 0);
});
