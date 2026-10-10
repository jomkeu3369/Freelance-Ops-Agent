import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Execute real component handlers with deterministic React state and API boundaries.
async function harness(file, component, props, api) {
  const slots = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
  };
  const jsx = (type, value, key) => ({ type, props: value ?? {}, key });
  const source = await readFile(new URL(`../features/workspace/settings/${file}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  let nextId = 0;
  vm.runInNewContext(output, {
    exports, crypto: { randomUUID: () => `draft-${++nextId}` },
    FormData: class { constructor(form) { this.fields = form.fields; } get(name) { return this.fields[name] ?? null; } },
    require: name => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.endsWith("ui-language")) return { useT: () => value => value };
      if (name.endsWith("/api")) return api;
      if (name.endsWith("formatters")) return { formatMoney: value => String(value) };
      if (name === "@phosphor-icons/react") return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => { cursor = 0; return exports[component](props); };
  return { props, render };
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
  const props = { session, rateCards, canWrite: true, onChange: value => { props.rateCards = value; } };
  return harness("rate-card-manager.tsx", "RateCardManager", props, { saveRateCard });
}

test("a lost create response retries one rate-card identity and explicit New starts another", async () => {
  const calls = [];
  const h = await rates(async (_session, id, input) => {
    calls.push({ id, input });
    if (calls.length === 1) throw new Error("Lost response after persistence");
    return { ...card(id), ...input };
  });
  await submit(h.render());
  await submit(h.render());
  assert.equal(calls[1].id, calls[0].id, "retry must update the original card instead of creating a duplicate");
  button(h.render(), "새 단가").props.onClick();
  await submit(h.render(), { name: "A different service" });
  assert.notEqual(calls[2].id, calls[0].id);
});

test("same-tick repeated submissions issue only one rate-card mutation", async () => {
  const pending = barrier(); const calls = [];
  const h = await rates(async (_session, id) => { calls.push(id); await pending.promise; return card(id); });
  const tree = h.render();
  const first = submit(tree); const second = submit(tree);
  pending.release(); await Promise.all([first, second]);
  assert.equal(calls.length, 1);
});

test("explicit New resets an unsaved rate form even when already creating a card", async () => {
  const h = await rates(async () => { throw new Error("No save expected"); });
  const before = form(h.render()).key;
  button(h.render(), "새 단가").props.onClick();
  assert.notEqual(form(h.render()).key, before);
});

test("a pending save locks editor switching and new-card actions", async () => {
  const pending = barrier();
  const h = await rates(async (_session, id, input) => { await pending.promise; return { ...card(id), ...input, version: 2 }; }, [card("first"), card("second")]);
  button(h.render(), "first").props.onClick();
  const saving = submit(h.render());
  const busyTree = h.render();
  for (const name of ["새 단가", "first", "second"]) assert.equal(button(busyTree, name).props.disabled, true, `${name} must not discard a newer draft before an older response arrives`);
  pending.release(); await saving;
});

test("read-only rates expose the saved list without a write form", async () => {
  const calls = [];
  const h = await rates(async (...args) => { calls.push(args); return card("first"); }, [card("first")]);
  const writable = h.render();
  h.props.canWrite = false;
  h.render();
  // A stale React handler is not a security boundary; the current visible tree must omit the form.
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
