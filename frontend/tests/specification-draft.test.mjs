import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const directory = await mkdtemp(join(tmpdir(), "specification-draft-"));
after(() => rm(directory, { recursive: true, force: true }));
const source = await readFile(new URL("../features/workspace/project/specification/specification-draft.ts", import.meta.url), "utf8");
await writeFile(join(directory, "draft.mjs"), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } }).outputText);
const draft = await import(pathToFileURL(join(directory, "draft.mjs")));
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
const specification = { title: "확정 제목", bodyText: "원문 내용", contentHash: "a".repeat(64) };
test("unsaved edits recover only within the exact user, project and immutable source hash", () => {
  const store = storage(), key = draft.specificationDraftKey("user", "workspace", "project", "revision");
  draft.writeSpecificationDraft(store, key, specification, { title: "수정", bodyText: "한글 <script>literal</script>  " });
  assert.equal(draft.readSpecificationDraft(store, key, specification).bodyText, "한글 <script>literal</script>  ");
  assert.deepEqual(draft.readSpecificationDraft(store, key, { ...specification, contentHash: "b".repeat(64) }), { title: specification.title, bodyText: specification.bodyText });
  assert.notEqual(draft.specificationDraftKey("other-user", "workspace", "project", "revision"), key);
  draft.forgetSpecificationDraft(store, key);
  assert.equal(draft.readSpecificationDraft(store, key, specification).bodyText, specification.bodyText);
});
test("ambiguous retries reuse the same ID while a different edit gets its own ID", () => {
  const store = storage(), first = draft.specificationRequestId(store, "user-project", "edit:a");
  assert.equal(draft.specificationRequestId(store, "user-project", "edit:a"), first);
  assert.notEqual(draft.specificationRequestId(store, "user-project", "edit:b"), first);
});
test("unavailable storage does not prevent reading the saved specification or editing", () => {
  const store = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  assert.equal(draft.readSpecificationDraft(store, "key", specification).bodyText, specification.bodyText);
  assert.doesNotThrow(() => draft.writeSpecificationDraft(store, "key", specification, { title: "x", bodyText: "y" }));
  assert.doesNotThrow(() => draft.forgetSpecificationDraft(store, "key"));
});
