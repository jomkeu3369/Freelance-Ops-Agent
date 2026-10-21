import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// 제어 가능한 React 상태와 API 경계로 실제 컴포넌트 핸들러를 실행한다.
async function harness(file, component, props, api) {
  const slots = [];
  const effects = [];
  const listeners = new Map();
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, position) => value !== slots[index].deps[position])) {
        slots[index]?.cleanup?.(); slots[index] = { deps };
        effects.push(() => { slots[index].cleanup = callback(); });
      }
    },
  };
  const jsx = (type, value, key) => ({ type, props: value ?? {}, key });
  const source = await readFile(new URL(`../features/workspace/settings/${file}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  let nextId = 0;
  vm.runInNewContext(output, {
    exports, crypto: { randomUUID: () => `draft-${++nextId}` },
    window: {
      addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    },
    FormData: class { constructor(form) { this.fields = form.fields; } get(name) { return this.fields[name] ?? null; } },
    require: name => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.endsWith("ui-language")) return { useT: () => value => value };
      if (name.endsWith("/api")) return api;
      if (name.endsWith("formatters")) return { formatMoney: value => String(value) };
      if (name.endsWith("rate-card-folders")) return { rateCardFolderOptions: () => [] };
      if (name === "@phosphor-icons/react") return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    cursor = 0;
    const tree = exports[component](props);
    for (const effect of effects.splice(0)) effect();
    return tree;
  };
  return { props, render, dispatch(type, event) { for (const listener of listeners.get(type) ?? []) listener(event); } };
}
function all(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
const form = tree => all(tree, node => node.type === "form")[0];
const button = (tree, label) => all(tree, node => node.type === "button" && JSON.stringify(node.props.children).includes(label))[0];
const submit = (tree, values = {}) => form(tree).props.onSubmit({ preventDefault() {}, currentTarget: { fields: { name: "Development", unit: "HOUR", currency: "KRW", rate: "100", minimumAmount: "0", ...values } } });
const session = { userId: "user", workspaceId: "workspace" };
const card = (id, name = id) => ({ id, name, workspaceId: "workspace", unit: "HOUR", rate: 100, minimumAmount: 0, currency: "KRW", active: true, version: 1 });
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function rates(saveRateCard, rateCards = []) {
  const props = { session, rateCards, canWrite: true, onChange: value => { props.rateCards = typeof value === "function" ? value(props.rateCards) : value; } };
  return harness("rate-card-manager.tsx", "RateCardManager", props, { saveRateCard });
}

test("a lost create response retries one rate-card identity and explicit New starts another", async () => {
  const calls = [];
  const h = await rates(async (_session, id, input) => {
    calls.push({ id, input });
    if (calls.length === 1) throw new Error("Lost response after persistence");
    return { ...card(id), ...input };
  });
  assert.equal(form(h.render()), undefined);
  button(h.render(), "새 단가").props.onClick();
  await submit(h.render());
  await submit(h.render());
  assert.equal(calls[1].id, calls[0].id, "retry must update the original card instead of creating a duplicate");
  assert.equal(form(h.render()), undefined, "a confirmed creation closes the editor");
  assert.match(JSON.stringify(h.render()), /새 단가를 등록했습니다/);
  button(h.render(), "새 단가").props.onClick();
  await submit(h.render(), { name: "A different service" });
  assert.notEqual(calls[2].id, calls[0].id);
});

test("same-tick repeated submissions issue only one rate-card mutation", async () => {
  const pending = barrier(); const calls = [];
  const h = await rates(async (_session, id) => { calls.push(id); await pending.promise; return card(id); });
  button(h.render(), "새 단가").props.onClick();
  const tree = h.render();
  const first = submit(tree); const second = submit(tree);
  pending.release(); await Promise.all([first, second]);
  assert.equal(calls.length, 1);
});

for (const action of ["새 단가", "second", "닫기"]) test(`dirty rate drafts require confirmation before ${action}`, async () => {
  const calls = [];
  const h = await rates(async (...args) => { calls.push(args); return card("first"); }, [card("first"), card("second")]);
  button(h.render(), "first").props.onClick();
  const initial = form(h.render());
  initial.props.onChange();
  button(h.render(), action).props.onClick();
  assert.equal(form(h.render()).key, initial.key);
  assert.ok(button(h.render(), "변경 버리고 이동"));
  button(h.render(), "계속 편집").props.onClick();
  assert.equal(form(h.render()).key, initial.key);
  assert.equal(button(h.render(), "변경 버리고 이동"), undefined);
  button(h.render(), action).props.onClick();
  button(h.render(), "변경 버리고 이동").props.onClick();
  if (action === "닫기") assert.equal(form(h.render()), undefined);
  else assert.notEqual(form(h.render()).key, initial.key);
  assert.equal(calls.length, 0);
});

test("restarting a dirty new rate requires confirmation and a separate draft identity", async () => {
  const h = await rates(async () => { throw new Error("No save expected"); });
  button(h.render(), "새 단가").props.onClick();
  const initial = form(h.render()); initial.props.onChange();
  button(h.render(), "새 단가").props.onClick();
  button(h.render(), "계속 편집").props.onClick();
  assert.equal(form(h.render()).key, initial.key);
  button(h.render(), "새 단가").props.onClick();
  button(h.render(), "변경 버리고 이동").props.onClick();
  assert.notEqual(form(h.render()).key, initial.key);
});

test("same rate selection and a background replacement keep a dirty editor identity", async () => {
  const h = await rates(async () => { throw new Error("No save expected"); }, [card("first")]);
  button(h.render(), "first").props.onClick();
  const initial = form(h.render()); initial.props.onChange();
  h.props.rateCards = [{ ...card("first", "Refreshed name"), rate: 500, version: 2 }];
  assert.equal(form(h.render()).key, initial.key);
  button(h.render(), "Refreshed name").props.onClick();
  assert.equal(form(h.render()).key, initial.key);
  assert.equal(button(h.render(), "변경 버리고 이동"), undefined);
  button(h.render(), "닫기").props.onClick();
  assert.ok(button(h.render(), "변경 버리고 이동"), "the same selection must not clear dirty state");
});

test("reselecting the current dirty rate cancels a pending switch without discarding its draft", async () => {
  const calls = [];
  const h = await rates(async (...args) => { calls.push(args); return card("first"); }, [card("first"), card("second")]);
  button(h.render(), "first").props.onClick();
  const initial = form(h.render()); initial.props.onChange();
  for (const action of ["second", "새 단가", "닫기"]) {
    button(h.render(), action).props.onClick();
    assert.ok(button(h.render(), "변경 버리고 이동"));
    button(h.render(), "first").props.onClick();
    assert.equal(button(h.render(), "변경 버리고 이동"), undefined, "the current selection cancels the pending destination");
    assert.equal(form(h.render()).key, initial.key, "the dirty form must stay mounted");
    button(h.render(), "second").props.onClick();
    assert.ok(button(h.render(), "변경 버리고 이동"), "a later switch still requires confirmation");
    button(h.render(), "계속 편집").props.onClick();
  }
  assert.equal(calls.length, 0);
});

test("beforeunload only warns while an unsaved rate draft is dirty", async () => {
  const h = await rates(async (_session, id, input) => ({ ...card(id), ...input }));
  const warns = () => {
    let prevented = false;
    const event = { preventDefault() { prevented = true; }, returnValue: undefined };
    h.dispatch("beforeunload", event);
    return prevented;
  };
  h.render(); assert.equal(warns(), false);
  button(h.render(), "새 단가").props.onClick();
  const initial = form(h.render()); assert.equal(warns(), false);
  initial.props.onChange(); h.render(); assert.equal(warns(), true);
  await submit(h.render()); h.render(); assert.equal(warns(), false);
});

test("a pending save locks editor switching and new-card actions", async () => {
  const pending = barrier();
  const h = await rates(async (_session, id, input) => { await pending.promise; return { ...card(id), ...input, version: 2 }; }, [card("first"), card("second")]);
  button(h.render(), "first").props.onClick();
  form(h.render()).props.onChange();
  button(h.render(), "second").props.onClick();
  const discard = button(h.render(), "변경 버리고 이동");
  const originalKey = form(h.render()).key;
  const saving = submit(h.render());
  const busyTree = h.render();
  for (const name of ["새 단가", "first", "second", "닫기", "변경 버리고 이동"]) assert.equal(button(busyTree, name).props.disabled, true, `${name} must not discard a newer draft before an older response arrives`);
  discard.props.onClick();
  assert.equal(form(h.render()).key, originalKey, "a previously rendered confirmation cannot bypass a pending mutation");
  pending.release(); await saving;
});

test("beforeunload also protects a pending save that began without a dirty input", async () => {
  const pending = barrier();
  const h = await rates(async (_session, id) => { await pending.promise; return card(id); }, [card("first")]);
  button(h.render(), "first").props.onClick();
  const saving = submit(h.render()); h.render();
  let prevented = false;
  h.dispatch("beforeunload", { preventDefault() { prevented = true; }, returnValue: undefined });
  assert.equal(prevented, true);
  pending.release(); await saving;
});

test("read-only rates expose the saved list without a write form", async () => {
  const calls = [];
  const h = await rates(async (...args) => { calls.push(args); return card("first"); }, [card("first")]);
  assert.equal(form(h.render()), undefined);
  button(h.render(), "새 단가").props.onClick();
  const writable = h.render();
  h.props.canWrite = false;
  h.render();
  // 이전 React 핸들러는 권한 경계가 아니다. 현재 화면에서도 폼을 제외해야 한다.
  assert.equal(form(h.render()), undefined);
  assert.ok(form(writable));
  assert.equal(calls.length, 0);
});

async function policy(saveEstimationPolicy) {
  const props = { session, policy: { workspaceId: "workspace", defaultTaxRate: .1, defaultRiskBufferRate: .1, maximumDiscountRate: .1, version: 1 }, busy: false,
    setBusy(value) { props.busy = value; }, setError(value) { props.error = value; }, setSaved(value) { props.saved = value; }, onSaved(value) { props.policy = value; } };
  return harness("estimation-policy-form.tsx", "EstimationPolicyForm", props, { saveEstimationPolicy });
}

test("empty policy fields cannot silently replace an existing percentage with zero", async () => {
  const calls = [];
  const h = await policy(async (_session, input) => { calls.push(input); return input; });
  const tree = h.render();
  for (const input of all(tree, node => node.type === "input")) assert.equal(input.props.required, true);
  await submit(tree, { taxRate: "", bufferRate: "10", discountRate: "10" });
  assert.equal(calls.length, 0);
  assert.ok(h.props.error);
  assert.equal(h.props.saved, null);
});

test("policy saves serialize same-tick submissions and preserve valid explicit zero", async () => {
  const pending = barrier(); const calls = [];
  const h = await policy(async (_session, input) => { calls.push(input); await pending.promise; return { ...input, version: 2 }; });
  const tree = h.render();
  const first = submit(tree, { taxRate: "0", bufferRate: "15", discountRate: "20" });
  const second = submit(tree, { taxRate: "0", bufferRate: "15", discountRate: "20" });
  pending.release(); await Promise.all([first, second]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].defaultTaxRate, 0);
  assert.equal(h.props.busy, false);
});
