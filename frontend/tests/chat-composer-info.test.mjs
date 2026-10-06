import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { parseChatPolicyIntent } from "../app/lib/chat-policy-intent.mjs";

// Execute the actual inline presentation callback with the effective submission
// context. Hooks, effects and child components are not needed to inspect props.
async function composerInfo(credentialId) {
  const source = await readFile(new URL("../features/workspace/project/project-workbench.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("project-workbench.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "composerInfo") callback = node.initializer.expression.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback, "Workbench must provide the composer notice");
  const { outputText } = ts.transpileModule(`export const info = ${callback};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  const node = (type, props) => ({ type, props });
  vm.runInNewContext(outputText, { exports, require: name => { assert.equal(name, "react/jsx-runtime"); return { jsx: node, jsxs: node, Fragment: "fragment" }; }, parseChatPolicyIntent,
    CreditCostNote: "cost", ByokCostNotice: "byok", AiUsageMeter: "usage", creditReviewRequired: false, runInProgress: false, retryCandidates: [], chatModel: { provider: "OPENAI", model: "gpt-6-luna", credentialId }, ledgerBlocker: "paused", ledgerMessage: "spending paused", ledger: { loading: false, refresh() {} }, session: {}, t: value => value });
  return exports.info;
}
function flatten(value) {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== "object") return [];
  return [value, ...flatten(value.props?.children)];
}

for (const credentialId of [undefined, "personal-key"]) test(`policy-like text with attachments shows ${credentialId ? "personal-key cost" : "platform spending guard"}, never a free settings notice`, async () => {
  const info = await composerInfo(credentialId);
  const nodes = flatten(info("기본 세율 10%로 변경", undefined, false));
  assert.equal(nodes.find(node => node.type === "cost").props.policy, false);
  if (credentialId) assert.ok(nodes.some(node => node.type === "byok"));
  else assert.ok(nodes.some(node => node.props?.role === "status"));
});

test("a standalone settings command retains its no-AI-charge notice", async () => {
  const info = await composerInfo();
  const nodes = flatten(info("기본 세율 10%로 변경", undefined, true));
  assert.equal(nodes.find(node => node.type === "cost").props.policy, true);
});
