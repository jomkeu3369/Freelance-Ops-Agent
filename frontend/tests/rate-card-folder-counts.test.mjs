import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../features/workspace/settings/rate-card-folders.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
const { rateCardFolderRateCounts } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const folder = (id, parentId = null) => ({ id, parentId, name: id, workspaceId: "workspace", version: 0 });
const card = (id, folderId, active = true) => ({ id, folderId, active });

test("folder totals include direct rates and every nested descendant, including inactive rates", () => {
  const folders = [folder("root"), folder("child", "root"), folder("leaf", "child"), folder("other"), folder("empty")];
  const cards = [card("direct", "root"), card("nested", "child", false), card("deep", "leaf"), card("separate", "other"), card("unclassified", null)];
  assert.deepEqual(Object.fromEntries(rateCardFolderRateCounts(folders, cards)), { root: 3, child: 2, leaf: 1, other: 1, empty: 0 });
});

test("duplicate rate identities and cyclic folder ancestry never count the same rate twice", () => {
  const folders = [folder("first", "second"), folder("second", "first"), folder("child", "second")];
  const cards = [card("one", "first"), card("one", "first"), card("two", "second"), card("three", "child")];
  assert.deepEqual(Object.fromEntries(rateCardFolderRateCounts(folders, cards)), { first: 3, second: 3, child: 1 });
});

test("missing ancestors stop accumulation without inventing folders or merging unrelated branches", () => {
  const folders = [folder("root"), folder("orphan", "missing"), folder("child", "orphan")];
  const cards = [card("known", "root"), card("nested", "child"), card("missing-folder", "missing")];
  assert.deepEqual(Object.fromEntries(rateCardFolderRateCounts(folders, cards)), { root: 1, orphan: 1, child: 1 });
});

test("empty lists and self-referencing folders have finite, predictable totals", () => {
  assert.deepEqual([...rateCardFolderRateCounts([], [card("unknown", "missing")])], []);
  assert.deepEqual(Object.fromEntries(rateCardFolderRateCounts([folder("empty")], [])), { empty: 0 });
  assert.deepEqual(Object.fromEntries(rateCardFolderRateCounts([folder("self", "self")], [card("one", "self")])), { self: 1 });
});
