import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const source = await readFile(new URL("../features/workspace/project/dialogs/project-edit-dialog.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX }
});

function render(project = {}) {
  const errors = [];
  const noSave = () => assert.fail("Budget validation must not save a project");
  const modules = {
    "react/jsx-runtime": jsxRuntime,
    react: { useRef: value => ({ current: value }), useState: value => [value, next => { if (typeof next === "string") errors.push(next); }] },
    "../../../../app/lib/ui-language": { useT: () => value => value },
    "../../shared/use-dialog-focus-trap": { useDialogFocusTrap: () => {} },
    "../../../../app/lib/api": { updateProjectDetails: noSave },
    "@phosphor-icons/react": { Warning: "span", CircleNotch: "span", CheckCircle: "span" }
  };
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; },
    FormData: class { constructor(form) { return new Map(Object.entries(form)); } }
  });
  const tree = exports.ProjectEditDialog({
    project: { id: "synthetic-project", title: "Synthetic title", requirementText: "Synthetic request", currency: "USD", budgetMin: 1.25, budgetMax: 2.75, ...project },
    clients: [], onClose: () => {}, onSave: noSave, onUpdated: noSave,
    session: { accessToken: "synthetic-only" }
  });
  function find(node, predicate) {
    if (node == null || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const result = find(child, predicate);
      if (result) return result;
    }
    return null;
  }
  return { errors, field: name => find(tree, node => node.type === "input" && node.props.name === name)?.props, form: find(tree, node => node.type === "form")?.props };
}

test("project edits preserve decimal budgets without imposing currency-specific increments", () => {
  for (const currency of ["USD", "KRW", "JPY"]) {
    const { field } = render({ currency });
    for (const [name, value] of [["budgetMin", 1.25], ["budgetMax", 2.75]]) {
      assert.equal(field(name).type, "number");
      assert.equal(field(name).min, "0");
      assert.equal(field(name).step, "any", `${currency} ${name} must accept existing decimal values`);
      assert.equal(field(name).defaultValue, value);
    }
  }
});

test("project edit budgets remain optional and preserve zero", () => {
  const { field } = render({ budgetMin: 0, budgetMax: null });
  assert.equal(field("budgetMin").defaultValue, 0);
  assert.equal(field("budgetMax").defaultValue, "");
  assert.equal(Boolean(field("budgetMin").required), false);
  assert.equal(Boolean(field("budgetMax").required), false);
});

test("decimal input support retains the minimum-to-maximum validation before saving", async () => {
  const { form, errors } = render();
  await form.onSubmit({ preventDefault() {}, currentTarget: { budgetMin: "2.75", budgetMax: "1.25" } });
  assert.deepEqual(errors, ["최소 예산은 최대 예산보다 클 수 없습니다."]);
});
