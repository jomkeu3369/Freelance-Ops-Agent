import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

let directory, api, format;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "admin-members-api-"));
  await writeFile(join(directory, "api.mjs"), "export async function request(path, options, token) { return {path, options, token}; }");
  for (const [name, path] of [["admin-members-api", "app/lib/admin-members-api.ts"], ["member-usage-format", "features/admin/member-usage-format.ts"]]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 } });
    await writeFile(join(directory, `${name}.mjs`), outputText.replace('"./api"', '"./api.mjs"'));
  }
  api = await import(pathToFileURL(join(directory, "admin-members-api.mjs")));
  format = await import(pathToFileURL(join(directory, "member-usage-format.mjs")));
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

const session = { accessToken: "synthetic-token" };
test("admin USD reads select one encoded member and carry cancellation with no cache or mutation", async () => {
  const controller = new AbortController();
  const result = await api.getMemberUsage(session, "synthetic/member", controller.signal);
  assert.equal(result.path, "/api/v2/admin/members/synthetic%2Fmember/ai-usage");
  assert.equal(result.options.signal, controller.signal);
  assert.equal(result.options.cache, "no-store");
  assert.equal(result.options.method, undefined);
  assert.equal(result.options.body, undefined);
  assert.equal(result.token, session.accessToken);
});
test("history preserves opaque cursors without querying another subject", async () => {
  const cursor = "timestamp|run+id/=test";
  const result = await api.getMemberUsageHistory(session, "member-one", cursor);
  const url = new URL(result.path, "https://example.invalid");
  assert.equal(url.pathname, "/api/v2/admin/members/member-one/ai-usage/history");
  assert.equal(url.searchParams.get("cursor"), cursor);
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(result.options.cache, "no-store");
  const first = await api.getMemberUsageHistory(session, "member-one", null);
  assert.equal(new URL(first.path, "https://example.invalid").searchParams.has("cursor"), false);
});
test("USD display retains eight decimal ledger precision without converting product credits", () => {
  assert.equal(format.formatAdminUsd(0.00000001), "$0.00000001");
  assert.equal(format.formatAdminUsd(0.12345678), "$0.12345678");
  assert.equal(format.formatAdminUsd(1.11654322), "$1.11654322");
  assert.equal(format.formatAdminUsd(1.25), "$1.25");
  assert.equal(format.formatAdminUsd(0), "$0.00");
});
