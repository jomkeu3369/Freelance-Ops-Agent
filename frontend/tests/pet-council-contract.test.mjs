import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as petState from "../features/workspace/pets/pet-state.mjs";

const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => ({ type, props });
function all(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
const content = node => JSON.stringify(node);
const button = (tree, label) => all(tree, node => node.type === "button" && node.props.children === label)[0];
const task = (title = "Recorded work") => ({ title, description: "Recorded source description", quantity: 1, unit: "HOUR", rateCardHint: "Synthetic rate", basis: { type: "ASSUMPTION", content: "Recorded assumption", sourceReference: null, sourceTitle: null } });
const draft = (scenario = "RECOMMENDED", title = "Recorded work", opinion = null) => ({ scenario, items: [task(title)], petPerspective: opinion });

async function harness() {
  const profileExports = {};
  vm.runInNewContext(transpile(await readFile(new URL("../features/workspace/pets/pet-profile.ts", import.meta.url), "utf8")), { exports: profileExports, require: () => petState });
  const slots = []; let cursor = 0;
  const calls = [], changes = [];
  const model = { availableAIDrafts: [draft()], petProfiles: [], rateCards: [], project: { id: "project-one", currency: "KRW" }, items: [task("Current work")], canWrite: true, busy: false, taxRate: .1, scenario: "RECOMMENDED", validUntil: "", saved: null, setItems: value => changes.push(value), setSelectedBasisIndex() {} };
  const session = { workspaceId: "workspace-one" };
  const exports = {};
  vm.runInNewContext(transpile(await readFile(new URL("../features/workspace/pets/pet-council.tsx", import.meta.url), "utf8")), {
    exports, structuredClone, require(name) {
      if (name === "react") return { useId: () => "source-test", useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; } };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.endsWith("ui-language")) return { useT: () => value => value };
      if (name.endsWith("/api")) return { async previewQuotation(session, project, input) { calls.push({ session, project, input }); return { total: input.items.length * 1000, riskBufferAmount: 0, taxAmount: 0 }; } };
      if (name.endsWith("formatters")) return { formatMoney: String };
      if (name.endsWith("quotation-helpers")) return { quotationDraftItems: value => value.items.map(item => ({ ...item, rateCardId: "rate-one" })) };
      if (name.endsWith("pet-profile")) return profileExports;
      if (name.endsWith("pet-state.mjs")) return petState;
      if (name.endsWith("pet-art")) return { PetArt: () => null };
      throw new Error(`Unexpected import ${name}`);
    }
  });
  return { model, calls, changes, render: () => { cursor = 0; return exports.PetCouncil({ model, session }); } };
}

test("council matches a personal pet only to its recorded perspective and identifies one analysis", async () => {
  const h = await harness(); h.model.availableAIDrafts = [draft("LEAN"), draft("RECOMMENDED"), draft("EXPANDED")];
  h.model.petProfiles = [{ petId: "personal", slot: "RECOMMENDED", name: "My custom pet", animal: "cat", color: "sky", accessory: "none", valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED" }];
  const tree = h.render(), cards = all(tree, node => node.type === "article");
  assert.match(content(cards[0]), /차근/); assert.doesNotMatch(content(cards[0]), /My custom pet/);
  assert.match(content(cards[1]), /My custom pet/); assert.match(content(cards[2]), /든든/); assert.doesNotMatch(content(cards[2]), /My custom pet/);
  assert.match(content(tree), /하나의 분석에서 나온 범위별 제안/);
  for (const label of Object.values(petState.petPerspectiveLabels)) assert.ok(content(tree).includes(label));
});

test("missing recorded opinions show a missing-opinion note, never a fabricated proposal", async () => {
  const h = await harness(), tree = h.render();
  assert.match(content(tree), /이전 분석에는 동료의 의견이 기록되어 있지 않습니다/);
  assert.equal(all(tree, node => node.type === "h4").length, 0); assert.equal(h.calls.length, 0);
  h.model.availableAIDrafts = []; assert.equal(h.render(), null);
});

test("a selected source item cannot silently transfer to replacement draft content", async () => {
  const h = await harness(); let tree = h.render();
  all(tree, node => node.type === "input")[0].props.onChange(); tree = h.render();
  assert.equal(all(tree, node => node.type === "input")[0].props.checked, true); assert.equal(button(tree, "변경 미리보기").props.disabled, false);
  h.model.availableAIDrafts = [draft("RECOMMENDED", "Different recorded work")]; tree = h.render();
  assert.equal(all(tree, node => node.type === "input")[0].props.checked, false); assert.equal(button(tree, "변경 미리보기").props.disabled, true); assert.equal(h.calls.length, 0);
});

test("selection and amount preview do not apply, save, or issue work until explicit review", async () => {
  const h = await harness(); let tree = h.render();
  all(tree, node => node.type === "input")[0].props.onChange(); tree = h.render(); button(tree, "변경 미리보기").props.onClick();
  await new Promise(resolve => setImmediate(resolve)); tree = h.render();
  assert.equal(h.calls.length, 2); assert.equal(h.changes.length, 0);
  button(tree, "확인한 작업으로 편집 초안 변경").props.onClick();
  assert.equal(h.changes.length, 1); assert.equal(h.changes[0][0].title, "Recorded work");
  assert.match(content(h.render()), /검토용 초안 저장/);
});

test("read-only access and duplicate source work disable preview without API calls", async () => {
  const h = await harness(); h.model.canWrite = false; let tree = h.render();
  assert.equal(all(tree, node => node.type === "fieldset")[0].props.disabled, true); assert.equal(button(tree, "변경 미리보기").props.disabled, true);
  h.model.canWrite = true; h.model.availableAIDrafts = [draft("LEAN"), draft("RECOMMENDED")]; tree = h.render();
  all(tree, node => node.type === "input").forEach(input => input.props.onChange()); tree = h.render();
  assert.equal(button(tree, "변경 미리보기").props.disabled, true); assert.match(content(tree), /같은 작업이 중복 선택/); assert.equal(h.calls.length, 0);
});
