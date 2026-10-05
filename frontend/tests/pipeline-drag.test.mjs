import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const compiled = async name => ts.transpileModule(await readFile(new URL(`../features/workspace/projects/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const dragSource = await compiled("use-pipeline-drag");
const storeSource = await compiled("pipeline-move-store");
const columns = [
  { key: "inquiry", statuses: ["LEAD"], moveTo: "LEAD" },
  { key: "quoting", statuses: ["QUOTING"], moveTo: "QUOTING" },
  { key: "negotiating", statuses: ["NEGOTIATING", "ACCEPTED"], moveTo: "NEGOTIATING" }
];

function fixture() {
  const refs = [], states = [], effects = [], callbacks = [];
  const listeners = new Map();
  let cursor = 0, now = 1000;
  const removed = [];
  class Element {
    constructor() { this.style = {}; this.children = []; this.attributes = {}; }
    closest() { return this.blocked ? this : null; }
    contains(node) { return node === this || this.children.includes(node); }
    cloneNode() { return new Element(); }
    removeAttribute(key) { delete this.attributes[key]; }
    setAttribute(key, value) { this.attributes[key] = value; }
    appendChild(node) { this.children.push(node); }
    remove() { removed.push(this); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 150 }; }
  }
  const react = {
    useRef(value) { const i = cursor++; return refs[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useCallback(fn, deps) { const i = cursor++; if (!callbacks[i] || deps.some((dep, index) => dep !== callbacks[i].deps[index])) callbacks[i] = { fn, deps }; return callbacks[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!effects[i] || deps.some((dep, index) => dep !== effects[i].deps[index])) { effects[i]?.cleanup?.(); effects[i] = { fn, deps, pending: true }; } }
  };
  const exports = {};
  runInNewContext(dragSource, { exports, require: name => name === "react" ? react : { pipelineColumns: columns }, Element, Node: Element, Date: { now: () => now }, window: {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }
  } });
  const moves = [];
  let props = { enabled: true, projects: [{ id: "one", status: "LEAD" }], onMove: (project, status) => moves.push({ id: project.id, status }) };
  function render(update = {}) { props = { ...props, ...update }; cursor = 0; const hook = exports.usePipelineDrag(props); for (const effect of effects) if (effect?.pending) { effect.pending = false; effect.cleanup = effect.fn(); } return hook; }
  const source = new Element(); source.parentElement = new Element();
  function event(target = source) { const values = new Map(); return { target, currentTarget: source, clientX: 10, clientY: 20, prevented: false, preventDefault() { this.prevented = true; }, dataTransfer: { setData: (key, value) => values.set(key, value), getData: key => values.get(key) ?? "", setDragImage(ghost) { this.ghost = ghost; } } }; }
  return { render, moves, source, event, removed, projects: props.projects, dispatch: (name, e = {}) => listeners.get(name)?.forEach(fn => fn(e)), advance: ms => { now += ms; }, unmount: () => effects.forEach(effect => effect?.cleanup?.()), listeners };
}

test("drag target previews a valid move and synchronously consumes repeated drops", () => {
  const f = fixture(); let hook = f.render(); const event = f.event();
  hook.start(event, f.projects[0]); hook = f.render();
  assert.equal(hook.draggingId, "one"); assert.equal(hook.canOpen(), false);
  assert.equal(event.dataTransfer.ghost.inert, true);
  hook.over(event, columns[1]); hook = f.render(); assert.equal(hook.targetKey, "quoting");
  hook.drop(event, columns[1]); hook.drop(event, columns[2]);
  assert.deepEqual(f.moves, [{ id: "one", status: "QUOTING" }]);
  hook = f.render(); assert.equal(hook.draggingId, null); assert.equal(hook.targetKey, null); assert.equal(f.removed.length, 1);
  assert.equal(hook.canOpen(), false); f.advance(351); assert.equal(hook.canOpen(), true);
});

test("dropping Accepted in its Negotiating column preserves Accepted without a write", () => {
  const f = fixture(); const project = { id: "one", status: "ACCEPTED" }; const hook = f.render({ projects: [project] }); const event = f.event();
  hook.start(event, project); hook.over(event, columns[2]); assert.equal(event.dataTransfer.dropEffect, "none"); hook.drop(event, columns[2]); assert.equal(f.moves.length, 0);
});

test("Escape, outside drop, blur and unmount clean up previews without saving", () => {
  for (const name of ["keydown", "drop", "blur", "dragend"]) {
    const f = fixture(); let hook = f.render(); const event = f.event(); hook.start(event, f.projects[0]);
    f.dispatch(name, { key: "Escape" }); hook.drop(event, columns[1]); hook = f.render();
    assert.equal(hook.draggingId, null); assert.equal(f.moves.length, 0); assert.equal(f.removed.length, 1);
    f.unmount(); assert.ok([...f.listeners.values()].every(set => set.size === 0));
  }
  const f = fixture(); const hook = f.render(); hook.start(f.event(), f.projects[0]); f.unmount(); assert.equal(f.removed.length, 1);
});

test("permissions, pending saves, form controls and external drags cannot start a move", () => {
  const f = fixture(); let hook = f.render({ enabled: false }); let event = f.event(); hook.start(event, f.projects[0]); assert.equal(event.prevented, true); hook.drop(event, columns[1]);
  hook = f.render({ enabled: true }); event = f.event(); event.target.blocked = true; hook.start(event, f.projects[0]); assert.equal(event.prevented, true); event.target.blocked = false;
  hook.drop(f.event(), columns[1]); assert.equal(f.moves.length, 0);
});

test("stale or missing source and a responsive/permission change cancel the active drag", () => {
  for (const update of [{ enabled: false }, { projects: [] }, { projects: [{ id: "one", status: "ACCEPTED" }] }]) {
    const f = fixture(); let hook = f.render(); const event = f.event(); hook.start(event, f.projects[0]); hook = f.render(update); hook.drop(event, columns[1]);
    hook = f.render(); assert.equal(hook.draggingId, null); assert.equal(f.moves.length, 0); assert.equal(f.removed.length, 1);
  }
});

function moveStore() {
  const exports = {};
  runInNewContext(storeSource, { exports, require: () => ({ useSyncExternalStore: (_subscribe, snapshot) => snapshot() }) });
  return exports.usePipelineMoveState;
}

test("workspace save lock survives route remount and rejects synchronous double submission", () => {
  const readMoveState = moveStore(); const oldBoard = readMoveState("user:workspace");
  const first = oldBoard.begin("one", "QUOTING"); assert.ok(first);
  assert.equal(oldBoard.begin("one", "ACCEPTED"), null);
  const returnedBoard = readMoveState("user:workspace"); assert.equal(returnedBoard.pending.status, "QUOTING"); assert.equal(returnedBoard.begin("two", "LEAD"), null);
  oldBoard.finish(first, null, { title: "Project", status: "QUOTING" });
  const completed = readMoveState("user:workspace"); assert.equal(completed.pending, null); assert.equal(completed.notice.status, "QUOTING");
  const second = completed.begin("one", "ACCEPTED"); assert.ok(second);
  oldBoard.finish(first, "Obsolete failure", null); assert.equal(readMoveState("user:workspace").pending.status, "ACCEPTED");
});

test("failed save/reconciliation unlocks for retry and does not leak between workspaces", () => {
  const readMoveState = moveStore(); const board = readMoveState("user:one"); const operation = board.begin("one", "QUOTING");
  assert.equal(readMoveState("user:two").pending, null);
  board.finish(operation, "Could not verify; refresh", null);
  const returned = readMoveState("user:one"); assert.equal(returned.pending, null); assert.equal(returned.error, "Could not verify; refresh");
  assert.ok(returned.begin("one", "QUOTING")); assert.equal(readMoveState("user:one").error, null);
});

const reconcileSource = await compiled("reconcile-project");
const reconciler = {};
runInNewContext(reconcileSource, { exports: reconciler });

test("delayed status and recovery snapshots never replace newer edited project details", () => {
  const statusResponse = { id: "one", title: "Old title", status: "QUOTING", updatedAt: "2026-10-04T00:00:00.100001Z" };
  const newerDetails = { ...statusResponse, title: "New title", updatedAt: "2026-10-04T00:00:00.100002Z" };
  assert.equal(reconciler.reconcileProject(newerDetails, statusResponse), newerDetails);
  assert.equal(reconciler.reconcileProject(statusResponse, newerDetails), newerDetails);
  assert.equal(reconciler.reconcileProject(newerDetails, { ...statusResponse, updatedAt: "2026-10-03T00:00:00Z" }), newerDetails);
  assert.equal(reconciler.reconcileProject(newerDetails, { ...statusResponse, updatedAt: "invalid" }), newerDetails);
});

const boardSource = ts.transpileModule(await readFile(new URL("../features/workspace/projects/pipeline-board.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function boardFixture() {
  const states = [], refs = [];
  let cursor = 0, onDrop, preferences = { search: "", activeColumn: "all", preferredView: "board", sort: "updated" };
  let projects = [{ id: "one", title: "Fixture", status: "LEAD", updatedAt: "2026-10-01T00:00:00Z" }];
  const state = { writes: [], reads: 0, updates: [], fail: false, readFail: false, lost: false, wait: null };
  const readMoveState = moveStore();
  const react = {
    useRef(value) { const i = cursor++; return refs[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in states)) states[i] = typeof value === "function" ? value() : value; return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useCallback: fn => fn, useEffect() {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot()
  };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  runInNewContext(boardSource, {
    exports, require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.endsWith("ui-language")) return { useT: () => (key, values = {}) => key?.replace(/\{(\w+)\}/g, (_all, key) => values[key]) ?? "" };
      if (name.endsWith("pipeline-move-store")) return { usePipelineMoveState: readMoveState };
      if (name.endsWith("use-pipeline-drag")) return { usePipelineDrag: ({ onMove }) => { onDrop = onMove; return { canOpen: () => true }; } };
      if (name.endsWith("shared/constants")) return { pipelineColumns: columns.map(column => ({ ...column, title: column.key, caption: "Stage" })), pipelineStatusLabels: { LEAD: "LEAD", QUOTING: "QUOTING" } };
      if (name.endsWith("shared/formatters")) return { projectClientLabel: () => "Client" };
      if (name.endsWith("app/lib/api")) return {
        async updateProject(_session, current, status) {
          state.writes.push({ status });
          if (state.wait) await state.wait;
          if (state.lost) projects = [{ ...current, status }];
          if (state.fail || state.lost) throw Error("Write failed");
          return { ...current, status };
        },
        async readProject() { state.reads++; if (state.readFail) throw Error("Read failed"); return projects[0]; }
      };
      return {};
    },
    window: { matchMedia: () => ({ matches: false }) },
    document: { activeElement: {} }, HTMLSelectElement: class {}, requestAnimationFrame: fn => fn(),
  });
  function render() {
    cursor = 0;
    return exports.PipelineBoard({ session: { userId: "test", workspaceId: "local" }, projects, clients: [], displayName: "Fixture", canWrite: true, preferences,
      onPreferencesChange(fn) { preferences = fn(preferences); }, onProjectUpdated(project) { state.updates.push(project); projects = [project]; },
      onCreate() {}, onSelect() {}
    });
  }
  render();
  return { state, render, drop: status => onDrop(projects[0], status), current: () => projects[0], move: () => readMoveState("test:local") };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("board optimistically shows a single in-flight write, then accepts the authoritative response", async () => {
  const f = boardFixture(); let release; f.state.wait = new Promise(resolve => { release = resolve; });
  f.drop("QUOTING"); f.drop("NEGOTIATING");
  assert.equal(f.move().pending.status, "QUOTING"); assert.equal(f.state.writes.length, 1); assert.equal(f.current().status, "LEAD");
  release(); await settle(); assert.equal(f.current().status, "QUOTING"); assert.equal(f.move().pending, null); assert.equal(f.move().error, null);
});

test("failed board save reconciles latest state, removes optimistic state and permits retry", async () => {
  const f = boardFixture(); f.state.fail = true; f.drop("QUOTING"); await settle();
  assert.equal(f.state.reads, 1); assert.equal(f.current().status, "LEAD"); assert.equal(f.move().pending, null); assert.match(f.move().error, /최신 상태/);
  f.state.fail = false; f.render(); f.drop("QUOTING"); await settle(); assert.equal(f.current().status, "QUOTING"); assert.equal(f.move().error, null);
});

test("lost board response reads the saved state without repeating the mutation", async () => {
  const f = boardFixture(); f.state.lost = true; f.drop("QUOTING"); await settle();
  assert.equal(f.state.reads, 1); assert.equal(f.state.writes.length, 1); assert.equal(f.current().status, "QUOTING"); assert.equal(f.move().error, null); assert.equal(f.move().notice.status, "QUOTING");
});

test("unavailable reconciliation rolls back locally and reports uncertainty without exposing server errors", async () => {
  const f = boardFixture(); f.state.fail = f.state.readFail = true; f.drop("QUOTING"); await settle();
  assert.equal(f.current().status, "LEAD"); assert.equal(f.move().pending, null); assert.match(f.move().error, /새로고침/); assert.doesNotMatch(f.move().error, /Write failed|Read failed/);
});
