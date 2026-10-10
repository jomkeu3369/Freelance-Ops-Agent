import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

async function harness() {
  const slots = [];
  let cursor = 0, queued = [], reads = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useId() { return "pet"; },
    useEffect(callback, dependencies) { const i = cursor++; if (!slots[i] || dependencies.some((value, j) => value !== slots[i].dependencies[j])) { slots[i]?.cleanup?.(); slots[i] = { dependencies }; queued.push(() => { slots[i].cleanup = callback(); }); } },
  };
  const collection = { pets: [], selectedPetId: null, maxActivePets: 2, maxStoredPets: 3, maxPromptLength: 500, maxPreferenceRequests: 6 };
  const state = { fail: true };
  const api = { listAgentPets: async () => { reads++; if (state.fail) throw new Error("Synthetic read failure"); return collection; }, ApiError: class extends Error {} };
  const source = await readFile(new URL("../features/workspace/pets/pet-customizer.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.endsWith("ui-language")) return { useT: () => value => value };
    if (name.endsWith("/api")) return api;
    if (name.endsWith("pet-library-events")) return { petLibraryRevision: () => 0, publishPetLibrary() {} };
    if (name.endsWith("pet-art") || name.endsWith("pet-profile")) return {};
    throw new Error(`Unexpected import: ${name}`);
  } });
  const props = { session: { userId: "user", workspaceId: "workspace" }, disabled: false };
  const render = () => { cursor = 0; queued = []; const tree = exports.PetCustomizer(props); for (const effect of queued) effect(); return tree; };
  return { render, state, reads: () => reads };
}
function all(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
const text = tree => JSON.stringify(tree);
const tick = () => new Promise(resolve => setImmediate(resolve));

test("successful pet reload removes the prior read error and re-enables editing", async () => {
  const h = await harness(); h.render(); await tick();
  const failed = h.render();
  assert.match(text(failed), /펫을 불러오지 못했습니다/);
  assert.equal(all(failed, node => node.type === "textarea")[0].props.disabled, true);
  h.state.fail = false;
  all(failed, node => node.type === "button" && node.props.children === "목록 다시 불러오기")[0].props.onClick();
  h.render(); await tick();
  const recovered = h.render();
  assert.equal(h.reads(), 2);
  assert.equal(all(recovered, node => node.type === "textarea")[0].props.disabled, false);
  assert.doesNotMatch(text(recovered), /펫을 불러오지 못했습니다/);
});
