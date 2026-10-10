import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const flush = () => new Promise(resolve => setImmediate(resolve));
function barrier() {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  return { entered, release, async wait() { enter(); await released; } };
}
function all(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
const form = tree => all(tree, node => node.type === "form")[0];
const button = (tree, label) => all(tree, node => node.type === "button" && JSON.stringify(node.props.children)?.includes(label))[0];
const field = (tree, name) => all(tree, node => node.type === "input" && node.props.name === name)[0].props.defaultValue;
const submit = (tree, fields) => form(tree).props.onSubmit({ preventDefault() {}, currentTarget: { fields } });
const card = (id, name = id) => ({ id, name, workspaceId: "workspace", unit: "HOUR", rate: 100, minimumAmount: 0, currency: "KRW", active: true, version: 1 });
const rateInput = { name: "Saved service", rate: "250", minimumAmount: "0", unit: "HOUR", currency: "KRW" };
const policyInput = { taxRate: "25", bufferRate: "15", discountRate: "20" };

// Run the actual page, parent/child handlers, API and query cache. Only React's
// scheduling/JSX and network are replaced, so every interleaving is deterministic.
async function settings() {
  let now = Date.now(), current, panelIdentity;
  const instances = new Map(), modules = new Map();
  const nextReads = new Map(), nextWrites = new Map();
  const server = {
    cards: [card("one", "Original service")],
    policy: { workspaceId: "workspace", defaultTaxRate: .1, defaultRiskBufferRate: .1, maximumDiscountRate: .1, version: 1 },
    profile: { displayName: "Test", email: "test@example.invalid", status: "ACTIVE", workspaces: [{ workspaceId: "workspace", name: "Test workspace" }] },
    writes: [],
  };
  const props = { session: { userId: "user", workspaceId: "workspace", accessToken: "token-1", refreshToken: "refresh-1" }, permissions: new Set(["quotation.read", "quotation.write"]), projectCount: 1, canCreateProject: true, onCreateProject() {}, onOpenPipeline() {} };
  const react = {
    useState(initial) {
      const index = current.cursor++, slots = current.slots;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = current.cursor++; return current.slots[index] ??= { current: initial }; },
    useEffect(callback, deps) {
      const index = current.cursor++, slots = current.slots;
      if (!slots[index] || deps.some((value, position) => value !== slots[index].deps[position])) {
        slots[index]?.cleanup?.(); slots[index] = { deps };
        current.effects.push(() => { slots[index].cleanup = callback(); });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const browserStore = new Map();
  const window = { sessionStorage: { getItem: key => browserStore.get(key) ?? null, setItem: (key, value) => browserStore.set(key, value), removeItem: key => browserStore.delete(key) }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  const fetch = async (url, init) => {
    const route = new URL(url).pathname;
    const resource = route.endsWith("/me") ? "profile" : route.includes("/rate-cards") ? "cards" : "policy";
    const method = init.method ?? "GET";
    if (method === "GET") {
      const snapshot = structuredClone(server[resource]);
      const pending = nextReads.get(resource); nextReads.delete(resource);
      if (pending) await pending.wait();
      if (pending?.error) return new Response(JSON.stringify({ message: pending.error }), { status: 503 });
      return new Response(JSON.stringify(snapshot));
    }
    const input = JSON.parse(init.body); server.writes.push({ resource, input });
    const pending = nextWrites.get(resource); nextWrites.delete(resource);
    if (pending) await pending.wait();
    if (pending?.error) return new Response(JSON.stringify({ message: pending.error }), { status: 503 });
    if (resource === "policy") {
      server.policy = { ...server.policy, ...input, version: server.policy.version + 1 };
      return new Response(JSON.stringify(server.policy));
    }
    const id = route.split("/").at(-1), prior = server.cards.find(item => item.id === id);
    const saved = { ...card(id), ...input, version: (prior?.version ?? 0) + 1 };
    server.cards = server.cards.filter(item => item.id !== id).concat(saved);
    return new Response(JSON.stringify(saved));
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const source = readFileSync(file, "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(output, {
      exports, Date: class extends Date { static now() { return now; } }, process: { env: {} }, window, fetch, Headers, Response, Error,
      crypto: { randomUUID: () => "created-card" },
      FormData: class { constructor(form) { this.fields = form.fields; } get(name) { return this.fields[name] ?? null; } },
      require(name) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "@phosphor-icons/react") return {};
        if (name.endsWith("ui-language")) return { useT: () => value => value };
        if (name.endsWith("workspace-context")) return { useWorkspace: () => ({ settings: props }) };
        if (name.endsWith("constants")) return { accountStatusLabels: { ACTIVE: "ACTIVE" } };
        if (name.endsWith("formatters")) return { formatMoney: value => String(value) };
        if (["free-usage-status", "analysis-return-link", "ai-connection-settings"].some(value => name.endsWith(value))) return {};
        let resolved = path.resolve(path.dirname(file), name);
        if (!path.extname(resolved)) resolved += /(?:settings-panel|rate-card-manager|estimation-policy-form)$/.test(name) ? ".tsx" : ".ts";
        return load(resolved);
      },
    }, { filename: file });
    return exports;
  }
  const api = load(path.join(root, "app/lib/api.ts"));
  const { default: Page } = load(path.join(root, "app/workspace/settings/page.tsx"));
  api.saveSession(props.session);
  function render(component, props, identity) {
    const state = instances.get(identity) ?? { slots: [] }; instances.set(identity, state);
    state.cursor = 0; state.effects = []; current = state;
    const tree = component(props); current = null;
    for (const effect of state.effects) effect();
    return tree;
  }
  function panel() {
    const node = Page(), identity = String(node.key);
    if (panelIdentity !== identity) {
      for (const instance of instances.values()) for (const slot of instance.slots) slot?.cleanup?.();
      instances.clear(); panelIdentity = identity;
    }
    return render(node.type, node.props, identity);
  }
  function child(name) {
    const node = all(panel(), node => node.type?.name === name)[0];
    assert.ok(node, `Missing ${name}`);
    return render(node.type, node.props, `${panelIdentity}:${name}`);
  }
  function hold(resource, error, write = false) {
    const pending = Object.assign(barrier(), { error });
    (write ? nextWrites : nextReads).set(resource, pending);
    return pending;
  }
  function refresh(overrides = {}) {
    now += 16_000;
    props.session = { ...props.session, accessToken: `${props.session.accessToken}-refresh`, ...overrides };
    api.saveSession(props.session); panel();
  }
  panel(); await flush();
  return { server, props, api, panel, hold, refresh, rate: () => child("RateCardManager"), policy: () => child("EstimationPolicyForm") };
}

test("a delayed policy GET cannot undo a saved policy or contaminate the next save", async () => {
  const h = await settings(), held = h.hold("policy");
  try {
    h.refresh(); await held.entered;
    await submit(h.policy(), policyInput);
    assert.equal(field(h.policy(), "taxRate"), 25);
  } finally { held.release(); }
  await flush();
  assert.equal(field(h.policy(), "taxRate"), 25);
  assert.equal(form(h.policy()).key, 2);
  assert.equal((await h.api.getEstimationPolicy(h.props.session)).defaultTaxRate, .25);
  await submit(h.policy(), { ...policyInput, taxRate: String(field(h.policy(), "taxRate")), discountRate: "30" });
  assert.equal(h.server.policy.defaultTaxRate, .25);
});

for (const create of [false, true]) test(`a delayed rate GET preserves a confirmed ${create ? "create" : "edit"}`, async () => {
  const h = await settings();
  if (!create) button(h.rate(), "Original service").props.onClick();
  const held = h.hold("cards");
  try {
    h.refresh(); await held.entered;
    await submit(h.rate(), rateInput);
    assert.equal(field(h.rate(), "rate"), 250);
  } finally { held.release(); }
  await flush();
  assert.equal(field(h.rate(), "name"), "Saved service");
  assert.equal(field(h.rate(), "rate"), 250);
  const list = all(h.rate(), node => node.props.className === "rate-card-list")[0];
  assert.equal(all(list, node => node.type === "button").length, create ? 2 : 1);
  // A later activation change must not submit the reverted original price.
  button(h.rate(), "비활성화").props.onClick();
  button(h.rate(), "비활성화").props.onClick();
  await flush();
  assert.equal(h.server.cards.find(item => item.name === "Saved service").rate, 250);
});

for (const resource of ["policy", "cards"]) test(`a delayed ${resource} read error is superseded by its confirmed save`, async () => {
  const h = await settings(), held = h.hold(resource, `Stale ${resource} read failed`);
  try {
    h.refresh(); await held.entered;
    await submit(resource === "policy" ? h.policy() : h.rate(), resource === "policy" ? policyInput : rateInput);
  } finally { held.release(); }
  await flush();
  assert.doesNotMatch(JSON.stringify(h.panel()), /Stale .* read failed/);
});

test("a policy save does not hide an independent rate read error or update", async () => {
  const h = await settings(), held = h.hold("cards", "Current rate read failed");
  try { h.refresh(); await held.entered; await submit(h.policy(), policyInput); }
  finally { held.release(); }
  await flush();
  assert.match(JSON.stringify(h.panel()), /Current rate read failed/);
  h.server.cards = [card("new-from-server", "Fresh server service")];
  h.refresh(); await flush();
  assert.match(JSON.stringify(h.rate()), /Fresh server service/);
  assert.doesNotMatch(JSON.stringify(h.panel()), /Current rate read failed/);
});

test("a rate save preserves newer unrelated cards loaded while the save was pending", async () => {
  const h = await settings(); button(h.rate(), "Original service").props.onClick();
  const held = h.hold("cards", undefined, true), saving = submit(h.rate(), rateInput);
  try {
    await held.entered;
    h.server.cards.push(card("two", "Newly loaded service"));
    h.refresh(); await flush();
    assert.match(JSON.stringify(h.rate()), /Newly loaded service/);
  } finally { held.release(); }
  await saving;
  assert.match(JSON.stringify(h.rate()), /Newly loaded service/);
  assert.equal(field(h.rate(), "rate"), 250);
});

test("newer reads after a save are accepted, including read-only settings", async () => {
  const h = await settings();
  await submit(h.policy(), policyInput);
  await submit(h.rate(), rateInput);
  h.server.policy = { ...h.server.policy, defaultTaxRate: .4, version: 3 };
  h.server.cards = h.server.cards.map(item => ({ ...item, rate: 500, version: item.version + 1 }));
  h.refresh(); await flush();
  assert.equal(field(h.policy(), "taxRate"), 40);
  assert.equal(field(h.rate(), "rate"), 500);
  h.props.permissions = new Set(["quotation.read"]);
  assert.equal(form(h.rate()), undefined);
  const policySection = all(h.panel(), node => node.props.id === "estimation-policy")[0];
  assert.equal(all(policySection, node => node.type === "dd")[0].props.children.join(""), "40%");
});

test("failed writes do not supersede a legitimate read or remount the failed form", async () => {
  const h = await settings(), held = h.hold("policy"), failure = h.hold("policy", "Policy write failed", true);
  const key = form(h.policy()).key;
  try {
    h.refresh(); await held.entered;
    const saving = submit(h.policy(), policyInput); await failure.entered; failure.release(); await saving;
    assert.equal(form(h.policy()).key, key);
  } finally { held.release(); failure.release(); }
  await flush();
  assert.equal(form(h.policy()).key, key);
  assert.match(JSON.stringify(h.panel()), /Policy write failed/);
});

for (const resource of ["policy", "cards"]) test(`newer ${resource} reads preserve the submitted form through a failed write`, async () => {
  const h = await settings();
  if (resource === "cards") button(h.rate(), "Original service").props.onClick();
  const tree = () => resource === "policy" ? h.policy() : h.rate();
  const key = form(tree()).key;
  const held = h.hold(resource, "Write failed", true);
  const saving = submit(tree(), resource === "policy" ? policyInput : rateInput);
  try {
    await held.entered;
    h.server.policy = { ...h.server.policy, defaultTaxRate: .4, version: 2 };
    h.server.cards = h.server.cards.map(item => ({ ...item, rate: 500, version: 2 }));
    h.refresh(); await flush();
    assert.equal(form(tree()).key, key, "pending inputs must not remount to the background version");
  } finally { held.release(); }
  await saving;
  assert.equal(form(tree()).key, key, "failed inputs must stay mounted for retry");
  assert.match(JSON.stringify(resource === "policy" ? h.panel() : h.rate()), /Write failed/);
  await submit(tree(), resource === "policy" ? policyInput : rateInput);
  assert.notEqual(form(tree()).key, key, "confirmed retry may replace the form with saved values");
  assert.equal(field(tree(), resource === "policy" ? "taxRate" : "rate"), resource === "policy" ? 25 : 250);
});

for (const overrides of [{ workspaceId: "other-workspace" }, { userId: "other-user", refreshToken: "other-refresh" }]) test(`settings ownership resets only on ${Object.keys(overrides)[0]} change`, async () => {
  const h = await settings(); button(h.rate(), "Original service").props.onClick();
  const original = form(h.rate()).key;
  h.refresh(); await flush();
  assert.equal(form(h.rate()).key, original, "token refresh keeps the current form identity");
  h.refresh(overrides);
  assert.equal(h.panel().props.className, "section-loading", "old workspace/account values are never rendered for the new owner");
  await flush();
  assert.equal(field(h.rate(), "name"), "", "old owner editor is discarded");
});

test("revoking quotation reads hides policy immediately and after a late save", async () => {
  const h = await settings(), held = h.hold("policy", undefined, true);
  const saving = submit(h.policy(), policyInput);
  const policySection = () => all(h.panel(), node => node.props.id === "estimation-policy")[0];
  try {
    await held.entered;
    h.props.permissions = new Set();
    assert.equal(all(policySection(), node => node.type === "dl").length, 0);
    await flush();
  } finally { held.release(); }
  await saving;
  assert.equal(all(policySection(), node => node.type === "dl").length, 0);
  assert.equal(all(policySection(), node => node.type?.name === "EstimationPolicyForm").length, 0);
  assert.match(JSON.stringify(policySection()), /계산 기준을 볼 권한이 없습니다/);
});

for (const operation of ["toggle", "retry"]) test(`a rate ${operation} after a failed draft uses the latest saved status and fields`, async () => {
  const h = await settings(); button(h.rate(), "Original service").props.onClick();
  const failed = h.hold("cards", "Write failed", true), saving = submit(h.rate(), rateInput);
  try {
    await failed.entered;
    h.server.cards = [{ ...h.server.cards[0], name: "Fresh server service", rate: 500, active: operation === "toggle", version: 2 }];
    h.refresh(); await flush();
  } finally { failed.release(); }
  await saving;
  if (operation === "toggle") {
    button(h.rate(), "비활성화").props.onClick();
    button(h.rate(), "비활성화").props.onClick();
    await flush();
    assert.equal(h.server.cards[0].rate, 500);
    assert.equal(h.server.cards[0].name, "Fresh server service");
  } else {
    await submit(h.rate(), rateInput);
    assert.equal(h.server.cards[0].rate, 250);
  }
  assert.equal(h.server.cards[0].active, false);
});
