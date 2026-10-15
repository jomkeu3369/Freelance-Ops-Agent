import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
const cursorToken = "older+/=opaque";
const item = (title = "Saved item") => ({ rateCardId: null, title, description: "", quantity: 2, unit: "HOUR", unitRate: 100, discountRate: 0, basis: { type: "ASSUMPTION", content: "Agreed scope", sourceType: null, sourceReference: null, sourceTitle: null, retrievedAt: null } });
const quote = (number, overrides = {}) => ({ id: `quote-${number}`, workspaceId: "workspace", projectId: "project", seriesId: `series-${number}`, previousVersionId: null, versionNumber: number, scenario: "RECOMMENDED", status: "PUBLISHED", currency: "KRW", subtotal: 200, discountTotal: 0, riskBufferRate: 0, riskBufferAmount: 0, taxRate: .1, taxAmount: 20, total: 220, validUntil: null, items: [item()], publishedAt: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, number)).toISOString(), version: 1, ...overrides });
const outcome = { id: "outcome", workspaceId: "workspace", projectId: "project", approvedQuotationId: "quote-5", totalRevenue: 300, actualCost: 100, actualHours: 3, profitMargin: .67, completedOn: null, changeReason: "Recorded", workItems: [] };
function all(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
const select = tree => all(tree, node => node.type === "select" && node.props.name === "approvedQuotationId")[0];
const loadMore = tree => all(tree, node => node.type === "button" && node.props.children === "이전 견적 더 보기")[0];
function barrier() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

// 실제 API·캐시·이력 훅·소비자 핸들러를 실행한다. React 스케줄러·JSX,
// 브라우저 저장소, 네트워크만 순서를 제어할 수 있는 대역으로 바꾼다.
function harness(kind = "builder", { draft = null, canReadQuotations = true, savedOutcome = outcome } = {}) {
  const slots = [], modules = new Map(), storage = new Map(), timers = new Map();
  let slotIndex = 0, effects = [], timerId = 0;
  const server = {
    first: Array.from({ length: 50 }, (_, index) => quote(100 - index)),
    older: Array.from({ length: 50 }, (_, index) => quote(50 - index)),
    details: new Map([["quote-5", quote(5)]]),
    outcome: savedOutcome, reads: [], writes: [], failMore: false, failDetail: false, holdMore: null, holdDetail: null, conflict: false,
    latest: quote(6, { seriesId: "series-5", previousVersionId: "quote-5" }),
  };
  const props = {
    session: { userId: "user", workspaceId: "workspace", accessToken: "token", refreshToken: "refresh" },
    project: { id: "project", workspaceId: "workspace", currency: "KRW" },
    permissions: new Set(["quotation.write", "quotation.publish", "outcome.read", "outcome.write", ...(canReadQuotations ? ["quotation.read"] : [])]),
    quotationDraft: null, quotationDrafts: [], modelSelection: null,
  };
  const react = {
    useState(initial) { const index = slotIndex++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = slotIndex++; return slots[index] ??= { current: initial }; },
    useMemo(callback, deps) { const index = slotIndex++; if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = { deps, value: callback() }; return slots[index].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const index = slotIndex++; if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) { slots[index]?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = callback(); }); } },
  };
  const window = {
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, confirm: () => true,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
  };
  const fetch = async (url, init) => {
    const parsed = new URL(url), route = parsed.pathname, method = init.method ?? "GET";
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
    if (method === "GET") {
      server.reads.push(parsed);
      if (route.endsWith("/quotations/page")) {
        assert.equal(parsed.searchParams.get("limit"), "50");
        if (parsed.searchParams.has("cursor")) {
          assert.equal(parsed.searchParams.get("cursor"), cursorToken);
          const snapshot = structuredClone(server.older);
          if (server.holdMore) await server.holdMore.promise;
          if (server.failMore) return json({ message: "Older page unavailable" }, 503);
          return json({ items: snapshot, nextCursor: null });
        }
        return json({ items: server.first, nextCursor: cursorToken });
      }
      if (route.endsWith("/rate-cards")) return json([]);
      if (route.endsWith("/outcome")) return json(server.outcome);
      if (route.endsWith("/latest")) return json(server.latest);
      const selected = server.details.get(route.split("/").at(-1));
      if (selected) {
        if (server.holdDetail) await server.holdDetail.promise;
        return server.failDetail ? json({ message: "Selected quotation unavailable" }, 503) : json(selected);
      }
      throw new Error(`Unexpected or unbounded read: ${url}`);
    }
    const input = init.body ? JSON.parse(init.body) : null;
    server.writes.push({ route, input });
    if (route.endsWith("/revisions")) return server.conflict ? json({ message: "Conflict" }, 409) : json(quote(101, { ...input, seriesId: "series-5" }));
    if (route.endsWith("/publish")) return json(quote(100, { status: "PUBLISHED" }));
    if (route.endsWith("/quotations")) return json(quote(101, input));
    if (route.endsWith("/outcome")) return json({ ...server.outcome, ...input });
    throw new Error(`Unexpected write: ${route}`);
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const jsx = (type, props, key) => ({ type, props, key });
    vm.runInNewContext(output, {
      exports, window, fetch, Headers, Response, URL, URLSearchParams, Error, process: { env: {} },
      FormData: class { constructor(form) { this.fields = form.fields; } get(key) { return this.fields[key] ?? null; } },
      require(name) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        if (name === "@phosphor-icons/react") return {};
        if (name.endsWith("ui-language")) return { useT: () => value => value };
        if (name.endsWith("formatters")) return { formatMoney: value => String(value) };
        let resolved = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
        if (!path.extname(resolved)) resolved += existsSync(`${resolved}.ts`) ? ".ts" : ".tsx";
        return load(resolved);
      },
    }, { filename: file });
    return exports;
  }
  const api = load(path.join(root, "app/lib/api.ts"));
  api.saveSession(props.session);
  const draftTools = load(path.join(root, "app/lib/quotation-draft.mjs"));
  const draftKey = draftTools.quotationDraftKey("user", "workspace", "project");
  if (draft) storage.set(draftKey, JSON.stringify(draftTools.createQuotationDraft({ workspaceId: "workspace", projectId: "project", scenario: "RECOMMENDED", baseQuotationId: "quote-5", taxRate: .1, validUntil: "", items: [item("Restored working draft")], ...draft })));
  const component = kind === "builder"
    ? load(path.join(root, "features/workspace/project/quotation/use-quote-builder.ts")).useQuoteBuilder
    : load(path.join(root, "features/workspace/project/outcome/outcome-review.tsx")).OutcomeReview;
  const render = () => { slotIndex = 0; effects = []; const result = component(props); for (const effect of effects) effect(); return result; };
  const pages = () => server.reads.filter(url => url.pathname.endsWith("/quotations/page"));
  render();
  return { api, server, props, render, pages, storage, draftKey, persist() { for (const callback of timers.values()) callback(); timers.clear(); } };
}

test("quote builder reads one bounded page; explicit older-page loads preserve the current selection and draft", async () => {
  const h = harness(); await tick();
  let model = h.render();
  assert.equal(h.pages().length, 1);
  assert.equal(h.pages()[0].searchParams.has("cursor"), false);
  assert.equal(model.quotations.length, 50);
  model.setItems([item("Unsaved current draft")]); model = h.render();
  await model.loadMoreQuotations(); model = h.render();
  assert.equal(h.pages().length, 2);
  assert.match(h.pages()[1].search, /cursor=older%2B%2F%3Dopaque/);
  assert.equal(model.quotations.length, 100);
  assert.equal(model.saved.id, "quote-100");
  assert.equal(model.items[0].title, "Unsaved current draft");
  assert.equal(model.hasUnsavedDraft, true);
  model.loadQuotation(model.quotations.at(-1));
  assert.equal(h.render().saved.id, "quote-1");
  await h.render().loadMoreQuotations();
  assert.equal(h.pages().length, 2);
});

test("restoring an older quotation draft fetches its base by ID without scanning pages and revises that base", async () => {
  const h = harness("builder", { draft: {} }); await tick();
  const model = h.render();
  assert.equal(model.saved.id, "quote-5");
  assert.equal(model.items[0].title, "Restored working draft");
  assert.equal(model.hasUnsavedDraft, true);
  assert.equal(model.quotations.length, 51);
  assert.equal(h.pages().length, 1);
  assert.equal(h.server.reads.filter(url => url.pathname.endsWith("/quotations/quote-5")).length, 1);
  h.persist();
  assert.equal(JSON.parse(h.storage.get(h.draftKey)).baseQuotationId, "quote-5");
  await model.save();
  assert.match(h.server.writes[0].route, /\/quote-5\/revisions$/);
  assert.equal(h.render().items[0].title, "Restored working draft");
});

test("page failures preserve loaded rows, selected quotation and edits; retry clears the error and ignores repeated clicks", async () => {
  const h = harness(); await tick();
  h.render().setItems([item("Do not discard")]);
  h.server.failMore = true;
  await h.render().loadMoreQuotations();
  let model = h.render();
  assert.equal(model.historyError, "Older page unavailable");
  assert.equal(model.quotations.length, 50);
  assert.equal(model.nextCursor, cursorToken);
  assert.equal(model.loadingMore, false);
  assert.equal(model.items[0].title, "Do not discard");
  assert.equal(model.saved.id, "quote-100");
  h.server.failMore = false; h.server.holdMore = barrier();
  const retry = model.loadMoreQuotations();
  await model.loadMoreQuotations();
  assert.equal(h.pages().length, 3);
  assert.equal(h.render().loadingMore, true);
  h.server.holdMore.release(); await retry;
  model = h.render();
  assert.equal(model.historyError, null);
  assert.equal(model.quotations.length, 100);
  assert.equal(model.items[0].title, "Do not discard");
});

test("late overlapping pages cannot undo publication or introduce duplicate quotation rows", async () => {
  const h = harness(); h.server.first[0].status = "DRAFT"; await tick();
  h.server.older.unshift(quote(100, { status: "DRAFT" }));
  h.server.holdMore = barrier();
  const pending = h.render().loadMoreQuotations();
  await h.render().publishSavedQuotation();
  h.server.holdMore.release(); await pending;
  const model = h.render();
  assert.equal(model.saved.status, "PUBLISHED");
  assert.equal(model.quotations.find(row => row.id === "quote-100").status, "PUBLISHED");
  assert.equal(model.quotations.length, 100);
});

test("late pages from the previous project are ignored", async () => {
  const h = harness(); await tick();
  h.server.holdMore = barrier(); const pending = h.render().loadMoreQuotations();
  h.props.project = { ...h.props.project, id: "next-project" };
  h.server.first = [quote(200, { projectId: "next-project" })];
  h.render(); await tick();
  h.server.holdMore.release(); await pending;
  const model = h.render();
  assert.equal(model.quotations.length, 1);
  assert.equal(model.saved.id, "quote-200");
  assert.equal(model.loadingMore, false);
});

test("revision conflict resolves the exact series with one bounded latest lookup without touching the draft", async () => {
  const h = harness("builder", { draft: {} }); h.server.conflict = true; await tick();
  await h.render().save();
  const model = h.render();
  assert.equal(model.conflictLatest.id, "quote-6");
  assert.equal(model.saved.id, "quote-5");
  assert.equal(model.items[0].title, "Restored working draft");
  assert.equal(h.pages().length, 1);
  assert.equal(h.server.reads.filter(url => url.pathname.endsWith("/quote-5/latest")).length, 1);
});

test("outcome preserves an approved quotation outside the first page and keeps a user selection while loading older pages", async () => {
  const h = harness("outcome"); await tick();
  let tree = h.render();
  assert.equal(select(tree).props.value, "quote-5");
  assert.ok(all(tree, node => node.type === "option" && node.props.value === "quote-5").length);
  assert.equal(h.pages().length, 1);
  assert.equal(h.server.reads.filter(url => url.pathname.endsWith("/quotations/quote-5")).length, 1);
  select(tree).props.onChange({ target: { value: "quote-90" } }); tree = h.render();
  await loadMore(tree).props.onClick(); await tick(); tree = h.render();
  assert.equal(select(tree).props.value, "quote-90");
  assert.equal(all(tree, node => node.type === "option" && node.props.value === "quote-5").length, 1);
  assert.equal(all(tree, node => node.type === "option").length, 101);
  assert.equal(all(tree, node => node.type === "input" && node.props.name === "totalRevenue")[0].props.defaultValue, 300);
});

test("outcome pagination errors retain the saved reference and editable fields", async () => {
  const h = harness("outcome"); await tick(); h.server.failMore = true;
  await loadMore(h.render()).props.onClick(); await tick();
  const tree = h.render();
  assert.equal(select(tree).props.value, "quote-5");
  assert.match(JSON.stringify(tree), /Older page unavailable/);
  assert.ok(loadMore(tree));
  assert.equal(all(tree, node => node.type === "input" && node.props.name === "totalRevenue")[0].props.defaultValue, 300);
});

test("outcome without quotation read permission keeps the previously saved reference without listing quotations", async () => {
  const h = harness("outcome", { canReadQuotations: false }); await tick();
  const tree = h.render();
  assert.equal(select(tree).props.value, "quote-5");
  assert.equal(all(tree, node => node.type === "option" && node.props.value === "quote-5")[0].props.children, "저장된 기준 견적");
  assert.equal(h.pages().length, 0);
});

test("failed off-page draft-base lookup restores and persists the draft but prevents accidental save-as-new", async () => {
  const h = harness("builder", { draft: {} }); h.server.failDetail = true; await tick();
  let model = h.render();
  assert.equal(model.items[0].title, "Restored working draft");
  assert.equal(model.saved, null);
  assert.equal(model.canSave, false);
  assert.match(model.error, /원본 견적을 불러오지 못했습니다/);
  await model.save();
  assert.equal(h.server.writes.length, 0);
  model.setItems([item("Continued editing safely")]); h.render(); h.persist();
  const persisted = JSON.parse(h.storage.get(h.draftKey));
  assert.equal(persisted.baseQuotationId, "quote-5");
  assert.equal(persisted.items[0].title, "Continued editing safely");
  model = h.render(); model.resetQuotation();
  h.render().setItems([item("Explicit new quotation")]); model = h.render();
  assert.equal(model.canSave, true);
  await model.save();
  assert.match(h.server.writes[0].route, /\/projects\/project\/quotations$/);
});

test("failed optional outcome-detail lookup keeps the saved outcome, reference, and work items", async () => {
  const h = harness("outcome", { savedOutcome: { ...outcome, workItems: [{ title: "Recorded task", actualHours: 2, actualCost: 100, notes: "Keep notes" }] } });
  h.server.failDetail = true;
  await tick();
  const tree = h.render();
  assert.equal(select(tree).props.value, "quote-5");
  assert.equal(all(tree, node => node.type === "input" && node.props.name === "totalRevenue")[0].props.defaultValue, 300);
  assert.match(JSON.stringify(tree), /Recorded task/);
  assert.match(JSON.stringify(tree), /Keep notes/);
  assert.match(JSON.stringify(tree), /Selected quotation unavailable/);
});

for (const wrongScope of [{ projectId: "another-project" }, { workspaceId: "another-workspace" }]) {
  test(`off-page draft bases in ${JSON.stringify(wrongScope)} cannot become a revision target`, async () => {
    const h = harness("builder", { draft: {} }); h.server.details.set("quote-5", quote(5, wrongScope)); await tick();
    const model = h.render();
    assert.equal(model.saved, null);
    assert.equal(model.canSave, false);
    assert.equal(model.items[0].title, "Restored working draft");
    assert.equal(model.quotations.some(row => row.id === "quote-5"), false);
    await model.save();
    assert.equal(h.server.writes.length, 0);
  });
  test(`off-page outcome references in ${JSON.stringify(wrongScope)} cannot appear as project quotations`, async () => {
    const h = harness("outcome"); h.server.details.set("quote-5", quote(5, wrongScope)); await tick();
    const tree = h.render();
    assert.equal(select(tree).props.value, "quote-5");
    assert.equal(all(tree, node => node.type === "option" && node.props.value === "quote-5")[0].props.children, "저장된 기준 견적");
    assert.match(JSON.stringify(tree), /프로젝트에 속한 견적을 확인할 수 없습니다/);
  });
}

test("fresh empty AI-draft props cannot restart restoration or reset unsaved edits and loaded pages", async () => {
  const h = harness("builder", { draft: {} }); await tick();
  await h.render().loadMoreQuotations();
  h.render().setItems([item("Edited before the autosave timer")]);
  h.props.quotationDrafts = [];
  h.render(); await tick();
  const model = h.render();
  assert.equal(model.items[0].title, "Edited before the autosave timer");
  assert.equal(model.saved.id, "quote-5");
  assert.equal(model.quotations.length, 100);
  assert.equal(model.hasUnsavedDraft, true);
  assert.equal(h.pages().length, 2);
  assert.equal(h.server.reads.filter(url => url.pathname.endsWith("/quotations/quote-5")).length, 1);
});

test("fresh empty AI-draft props during an off-page detail read do not cancel and repeat restoration", async () => {
  const h = harness("builder", { draft: {} }); h.server.holdDetail = barrier(); await tick();
  h.props.quotationDrafts = [];
  h.render(); await tick();
  assert.equal(h.server.reads.filter(url => url.pathname.endsWith("/quotations/quote-5")).length, 1);
  h.server.holdDetail.release(); await tick();
  const model = h.render();
  assert.equal(model.saved.id, "quote-5");
  assert.equal(model.items[0].title, "Restored working draft");
  assert.equal(model.canSave, true);
});

test("a stable single AI draft with fresh empty multi-draft props also preserves current edits", async () => {
  const h = harness(); await tick();
  h.props.quotationDraft = { scenario: "RECOMMENDED", items: [item("Generated item")] };
  h.render(); await tick();
  h.render().setItems([item("Edited generated draft")]);
  h.props.quotationDrafts = [];
  h.render(); await tick();
  assert.equal(h.render().items[0].title, "Edited generated draft");
  assert.equal(h.render().hasUnsavedDraft, true);
});
