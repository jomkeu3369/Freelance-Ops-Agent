import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const directory = await mkdtemp(join(tmpdir(), "specification-api-"));
after(() => rm(directory, { recursive: true, force: true }));
const source = await readFile(new URL("../features/workspace/project/specification/specification-api.ts", import.meta.url), "utf8");
let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } });
outputText = outputText.replace('"../../../../app/lib/api"', '"./api.mjs"').replace('"../../../../app/lib/query-cache"', '"./cache.mjs"');
await writeFile(join(directory, "spec-api.mjs"), outputText);
await writeFile(join(directory, "api.mjs"), 'export const request = (...args) => globalThis.__specRequest(...args);');
await writeFile(join(directory, "cache.mjs"), 'export const invalidateQueries = prefix => globalThis.__specInvalidated.push(prefix);');
const api = await import(pathToFileURL(join(directory, "spec-api.mjs")));
const session = { workspaceId: "workspace", accessToken: "token" }, spec = { id: "revision", contentHash: "a".repeat(64) };
after(() => { delete globalThis.__specRequest; delete globalThis.__specInvalidated; });
test("specification confirmation sends an explicit hash-bound action and invalidates all affected document caches", async () => {
  globalThis.__specInvalidated = [];
  globalThis.__specRequest = async (path, input, token) => {
    assert.equal(path, "/api/v2/workspaces/workspace/projects/project/specifications/revision/confirm");
    assert.deepEqual(JSON.parse(input.body), { expectedContentHash: spec.contentHash, confirmation: "CONFIRM_SPECIFICATION" });
    assert.equal(token, "token"); return { id: "confirmed" };
  };
  assert.deepEqual(await api.confirmSpecification(session, "project", spec), { id: "confirmed" });
  assert.deepEqual(globalThis.__specInvalidated, ["documents:workspace", "document:workspace:"]);
});
test("actual PDF bytes use binary decoding and reject an HTML/error body", async () => {
  globalThis.__specRequest = async (path, init, token, recovery, type) => {
    assert.equal(type, "blob"); assert.equal(recovery, true); assert.equal(token, "token");
    assert.equal(path.endsWith("/revision/pdf"), true);
    return new Blob(["%PDF-1.7\nfixture"], { type: "application/pdf" });
  };
  assert.equal(await (await api.downloadSpecificationPdf(session, "project", spec)).text(), "%PDF-1.7\nfixture");
  for (const blob of [new Blob(["<html>error</html>"], { type: "text/html" }), new Blob(["corrupt"], { type: "application/pdf" })]) {
    globalThis.__specRequest = async () => blob;
    await assert.rejects(api.downloadSpecificationPdf(session, "project", spec), /유효한 PDF/);
  }
});
