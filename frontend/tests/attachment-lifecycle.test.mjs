import assert from "node:assert/strict";
import test from "node:test";
import { File } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const hour = 60 * 60 * 1000;
const file = name => new File([`Synthetic contents: ${name}`], name, { type: "text/plain" });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function harness({ response } = {}) {
  let now = Date.parse("2026-10-10T00:00:00Z"), cursor = 0, generation = 0;
  const slots = [], effects = [], timers = new Map(), reads = [], removals = [];
  const window = new EventTarget();
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(fn, dependencies) {
      const index = cursor++;
      if (!same(slots[index]?.dependencies, dependencies)) slots[index] = { dependencies, fn };
      return slots[index].fn;
    },
    useEffect(fn, dependencies) {
      const index = cursor++;
      if (!same(slots[index]?.dependencies, dependencies)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { dependencies, cleanup: fn() };
      });
    },
  };
  const context = {
    File, AbortController, Array, Error, process: { env: {} }, window,
    crypto: { randomUUID }, Date: class extends Date { static now() { return now; } },
    setInterval: fn => { const id = randomUUID(); timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id),
  };
  async function compile(path, modules) {
    const source = await readFile(new URL(path, root), "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports = {};
    vm.runInNewContext(output, { ...context, exports, require: name => { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; } });
    return exports;
  }
  const draft = await compile("features/workspace/project/analysis/attachment-draft.ts", {});
  const { useChatAttachments } = await compile("features/workspace/project/analysis/chat-attachments.tsx", {
    react, "react/jsx-runtime": {}, "@phosphor-icons/react": {}, "./chat-attachments.css": {},
    "../../../../app/lib/ui-language": {}, "./attachment-draft": draft,
    "../../../../app/lib/api": {
      currentSessionGeneration: () => generation,
      readChatAttachment: async (session, projectId, original, encoding, delimiter, signal) => {
        reads.push({ session, projectId, file: original, signal });
        if (response) return response.promise;
        return { id: `preview-${reads.length}`, expiresAt: new Date(now + 30 * 60 * 1000).toISOString(), extraction: { text: "Synthetic extraction", status: "COMPLETE" } };
      },
      removeChatAttachment: async (session, projectId, id) => { removals.push({ session, projectId, id }); },
    },
  });
  const session = { userId: "owner", workspaceId: "space", accessToken: "synthetic-token" };
  function useHarness() {
    cursor = 0;
    const state = useChatAttachments(session, "project");
    while (effects.length) effects.shift()();
    return state;
  }
  function useRemount() { slots.length = 0; return useHarness(); }
  return { render: useHarness, reads, removals, remount: useRemount, changeSession: () => { generation++; window.dispatchEvent(new Event("freelance-ops-session-cleared")); }, advance: value => { now += value; }, tick: () => { for (const fn of timers.values()) fn(); }, unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
}

test("an expired local draft cannot upload when a background cleanup timer has not fired", async () => {
  const h = await harness();
  h.render().add([file("expired.txt")]);
  h.advance(hour);
  assert.equal(await h.render().prepare(), false);
  assert.equal(h.reads.length, 0);
  assert.equal(h.render().items.length, 0);
  assert.match(h.render().error, /1시간 만료/);
});

test("adding a new file cannot revive an expired local draft before its cleanup timer", async () => {
  const h = await harness();
  h.render().add([file("expired.txt")]);
  h.advance(hour + 1);
  h.render().add([file("new.txt")]);
  assert.deepEqual(Array.from(h.render().items, item => item.file.name), ["new.txt"]);
  assert.match(h.render().error, /1시간 만료/);
  assert.equal(h.reads.length, 0);
});

test("changing options cannot renew an expired reviewed draft", async () => {
  const h = await harness();
  h.render().add([file("expired.txt")]);
  await h.render().prepare();
  h.render().setConfirmed(true);
  const item = h.render().items[0];
  h.advance(hour);
  h.render().options(item, "cp949", "auto");
  assert.equal(h.render().items.length, 0);
  assert.equal(h.render().confirmed, false);
  assert.equal(h.reads.length, 1);
});

test("reading just before expiry retains the original and still requires separate review", async () => {
  const h = await harness();
  const original = file("fresh.txt");
  h.render().add([original]);
  h.advance(hour - 1);
  assert.equal(await h.render().prepare(), false);
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0].file, original);
  assert.equal(h.render().ready, true);
  assert.equal(h.render().confirmed, false);
});

test("cancellation rejects a late successful preview, cleans known staging, and retains the original", async () => {
  const response = deferred();
  const h = await harness({ response });
  const original = file("cancelled.txt");
  h.render().add([original]);
  const reading = h.render().prepare();
  assert.equal(await h.render().prepare(), false);
  assert.equal(h.reads.length, 1);
  h.render().cancel();
  assert.equal(h.reads[0].signal.aborted, true);
  response.resolve({ id: "late-preview", extraction: { text: "Must never be restored", status: "COMPLETE" } });
  assert.equal(await reading, false);
  assert.equal(h.render().items[0].file, original);
  assert.equal(h.render().ready, false);
  assert.equal(h.render().confirmed, false);
  assert.deepEqual(h.removals.map(item => item.id), ["late-preview"]);
});

test("expiry invalidates confirmation before a reviewed Send or exact retry can reuse staging IDs", async () => {
  const h = await harness();
  h.render().add([file("reviewed.txt")]);
  await h.render().prepare();
  h.render().setConfirmed(true);
  assert.equal(h.render().confirmed, true);
  h.advance(hour);
  assert.equal(await h.render().prepare(), false);
  assert.equal(h.render().confirmed, false);
  assert.equal(h.render().ids.length, 0);
  assert.equal(h.reads.length, 1);
});


test("logging out away from chat cannot restore an earlier session's local attachments", async () => {
 const h = await harness();
 h.render().add([file("prior-login-private.txt")]);
 h.unmount();
 h.changeSession();
 assert.equal(h.remount().items.length, 0);
});


test("ordinary unmount and remount preserve files within the same login", async () => {
 const h = await harness();
 const original = file("same-login.txt");
 h.render().add([original]);
 h.unmount();
 assert.equal(h.remount().items[0].file, original);
 assert.equal(h.render().confirmed, false);
 assert.equal(h.reads.length, 0);
});

test("logout while reading clears the local draft and rejects its late successful staging response", async () => {
 const response = deferred();
 const h = await harness({ response });
 h.render().add([file("logged-out.txt")]);
 const reading = h.render().prepare();
 h.changeSession();
 assert.equal(h.render().items.length, 0);
 assert.equal(h.reads[0].signal.aborted, true);
 response.resolve({ id: "prior-session-preview", extraction: { text: "Old private result", status: "COMPLETE" } });
 await reading;
 assert.equal(h.render().items.length, 0);
 assert.deepEqual(h.removals.map(item => item.id), ["prior-session-preview"]);
 h.unmount();
 assert.equal(h.remount().items.length, 0);
});
