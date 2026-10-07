import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const dir = new URL("../features/workspace/skills/", import.meta.url);
const agentDir = new URL("../../agent/resources/builtin-skills/", import.meta.url);
const json = async url => JSON.parse(await readFile(url, "utf8"));
const catalog = await json(new URL("catalog.json", dir));
const routing = await json(new URL("routing.json", dir));
const categories = await json(new URL("categories.json", dir));
let source = await readFile(new URL("skill-selection.ts", dir), "utf8");
source = source.replace('import catalog from "./catalog.json";', `const catalog = ${JSON.stringify(catalog)};`).replace('import rules from "./routing.json";', `const rules = ${JSON.stringify(routing)};`);
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } }).outputText;
const { normalizeSkillSelection, resolveSkills, skillSelectionSignature } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const auto = () => normalizeSkillSelection(null);
const cases = (await json(new URL("acceptance-cases.json", agentDir))).cases;

test("frontend index and routing exactly match the agent's pinned 60-skill contract", async () => {
  assert.deepEqual(catalog, await json(new URL("builtin-skills.index.json", agentDir)));
  assert.deepEqual(routing, await json(new URL("routing.json", agentDir)));
  assert.equal(catalog.skills.length, 60);
  assert.equal(new Set(catalog.skills.map(skill => skill.id)).size, 60);
  assert.deepEqual(Object.keys(routing), catalog.skills.map(skill => skill.id));
  for (const skill of catalog.skills) {
    assert.ok(categories.some(category => category.id === skill.category));
    for (const locale of ["ko", "en"]) { assert.ok(skill.name[locale]); assert.ok(skill.summary[locale]); }
  }
});
for (const example of cases.filter(value => value.kind === "routing")) {
  test(`browser resolver matches shared acceptance case: ${example.id}`, () => {
    const { selected, deferred } = resolveSkills(example.prompt, auto());
    assert.equal(selected[0] ?? null, example.expected_primary);
    assert.ok(selected.every(id => !example.must_not_select.includes(id)));
    assert.ok(selected.slice(1).every(id => example.allowed_supporting.includes(id)));
    assert.ok(selected.length <= example.max_selected);
    assert.deepEqual(deferred, []);
  });
}
test("Auto stages all requested work without loading more than three skills", () => {
  const example = cases.find(value => value.kind === "staging");
  const result = resolveSkills(example.prompt, auto());
  assert.equal(result.selected.length, 3);
  assert.deepEqual(new Set([...result.selected, ...result.deferred]), new Set(example.required_across_stages));
  assert.deepEqual(result.deferred, ["ops-milestone-plan"]);
});
test("manual overrides and empty selection stay fixed despite task mismatch or exclusions", () => {
  const text = "Prepare a proposal";
  assert.deepEqual(resolveSkills(text, { ...auto(), mode: "MANUAL" }), { selected: [], deferred: [] });
  const chosen = ["research-data-cleaning", "dev-bug-triage", "translation-subtitles"];
  const value = normalizeSkillSelection({ ...auto(), mode: "MANUAL", manualIds: chosen, excludedIds: chosen });
  assert.deepEqual(resolveSkills(text, value), { selected: chosen, deferred: [] });
  value.manualIds.pop();
  assert.equal(chosen.length, 3, "normalization never mutates the caller's array");
});
test("Auto exclusions affect only exact known choices; restoring a choice re-enables it", () => {
  const text = "Prepare a proposal";
  assert.deepEqual(resolveSkills(text, auto()).selected, ["writing-proposal"]);
  assert.deepEqual(resolveSkills(text, { ...auto(), excludedIds: ["writing-proposal"] }), { selected: [], deferred: [] });
  assert.deepEqual(resolveSkills(text, { ...auto(), excludedIds: ["dev-bug-triage"] }).selected, ["writing-proposal"]);
  assert.deepEqual(resolveSkills(text, auto()).selected, ["writing-proposal"]);
});
test("selection validation rejects invalid shape, authority fields, unknown IDs, duplicates and over-three manual selections", () => {
  const ids = catalog.skills.map(skill => skill.id);
  for (const value of [false, "AUTO", 0, [], { ...auto(), mode: "MAGIC" }, { ...auto(), catalogVersion: "latest" }, { ...auto(), tools: ["admin"] }, { ...auto(), manualIds: ids.slice(0,4) }, { ...auto(), manualIds: [ids[0], ids[0]] }, { ...auto(), excludedIds: [ids[0], ids[0]] }, { ...auto(), excludedIds: ["../../secret"] }, { ...auto(), manualIds: [null] }]) assert.throws(() => normalizeSkillSelection(value));
  assert.equal(normalizeSkillSelection({ ...auto(), excludedIds: ids }).excludedIds.length, 60);
});
test("selection signatures keep legacy omission distinct from Auto and manual-empty choices", () => {
  assert.notEqual(skillSelectionSignature(), skillSelectionSignature(auto()));
  assert.notEqual(skillSelectionSignature(auto()), skillSelectionSignature({ ...auto(), mode: "MANUAL" }));
  const first = auto(); first.excludedIds.push("writing-proposal");
  assert.deepEqual(auto().excludedIds, []);
});
