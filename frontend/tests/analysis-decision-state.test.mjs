import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourceText = await readFile(new URL("../features/workspace/project/decisions/analysis-decision-state.ts", import.meta.url), "utf8");
const output = ts.transpileModule(sourceText, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 } }).outputText;
const { selectableOpinions, opinionLabel, latestFamilyDecision, DecisionRequestKeys, decisionStorageKey, restoredDecisionDraft } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const draft = scenario => ({ scenario, petPerspective: { proposal: "선택 제안", rationale: "근거", tradeoff: "범위 차이" }, items: [{ title: "원본 작업", quantity: 1, unit: "DAY", basis: { type: "EVIDENCE", content: "원문 근거" } }] });
const source = () => ({ runId: "source-run", sourceProjectVersion: 4, view: { status: "COMPLETED", result: { quotationDrafts: [draft("EXPANDED"), draft("LEAN"), draft("RECOMMENDED")] } } });

test("only a version-bound complete three-perspective analysis is selectable in canonical order", () => {
  const value = source();
  assert.deepEqual(selectableOpinions(value, 4).map(opinion => opinion.id), ["source-run:LEAN", "source-run:RECOMMENDED", "source-run:EXPANDED"]);
  assert.deepEqual(selectableOpinions(null, 4), []);
  assert.deepEqual(selectableOpinions(value, undefined), []);
  assert.deepEqual(selectableOpinions(value, 5), []);
  for (const status of ["QUEUED", "RUNNING", "WAITING_FOR_USER", "PARTIAL", "FAILED", "CANCELLED"]) {
    value.view.status = status; assert.deepEqual(selectableOpinions(value, 4), [], status);
  }
});
test("malformed or duplicate opinions reject the entire source rather than hide missing provenance", () => {
  for (const alter of [value => value.view.result.quotationDrafts.pop(), value => value.view.result.quotationDrafts[0].scenario = "LEAN",
    value => value.view.result.quotationDrafts[0].petPerspective.tradeoff = "  ", value => value.view.result.quotationDrafts[0].items = [], value => value.view.result.quotationDrafts[0].petPerspective.proposal = 3,
    value => value.view.result.quotationDrafts = {}, value => value.view.result.quotationDrafts[0].items[0].basis = null]) {
    const value = source(); alter(value); assert.deepEqual(selectableOpinions(value, 4), []);
  }
});
test("labels describe recorded plans and latest revision is scoped to one family", () => {
  assert.deepEqual(["LEAN", "RECOMMENDED", "EXPANDED"].map(opinionLabel), ["핵심 범위 관점", "권장 범위 관점", "확장 범위 관점"]);
  const base = { id: "one", familyId: "family", versionNumber: 1 };
  const newer = { id: "two", familyId: "family", versionNumber: 2 };
  assert.equal(latestFamilyDecision([{ id: "other", familyId: "other", versionNumber: 99 }, newer], base), newer);
});
test("ambiguous retries and reload retain an exact operation key but new bodies get new keys", () => {
  const keys = new DecisionRequestKeys(), input = { sourceRunId: "one", selectedOpinionIds: ["one:LEAN"] };
  const id = keys.requestId("create", input);
  assert.equal(keys.requestId("create", input), id);
  const restored = new DecisionRequestKeys(JSON.parse(JSON.stringify(keys.snapshot())));
  assert.equal(restored.requestId("create", input), id);
  assert.notEqual(restored.requestId("revise", input), id);
  assert.notEqual(restored.requestId("create", { ...input, selectedOpinionIds: ["one:EXPANDED"] }), id);
  restored.settle("create", input); assert.notEqual(restored.requestId("create", input), id);
  const invalid = new DecisionRequestKeys([[JSON.stringify(["create", input]), "-".repeat(36)]]);
  assert.notEqual(invalid.requestId("create", input), "-".repeat(36));
});
test("local unsaved drafts restore only against the exact reviewed artifact hash and bounded body", () => {
  const decision = { id: "one", contentHash: "a".repeat(64) }, bodyText = "사용자 수정\r\n원문😀  ";
  assert.equal(restoredDecisionDraft({ baseId: "one", baseHash: decision.contentHash, bodyText }, decision), bodyText);
  for (const invalid of [null, { baseId: "other", baseHash: decision.contentHash, bodyText }, { baseId: "one", baseHash: "b".repeat(64), bodyText },
    { baseId: "one", baseHash: decision.contentHash, bodyText: "x".repeat(100001) }]) assert.equal(restoredDecisionDraft(invalid, decision), null);
  assert.notEqual(decisionStorageKey("user", "workspace", "project"), decisionStorageKey("other", "workspace", "project"));
  assert.notEqual(decisionStorageKey("a:b", "c", "d"), decisionStorageKey("a", "b:c", "d"));
});
