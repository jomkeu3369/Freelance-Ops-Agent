import assert from "node:assert/strict";
import { test } from "node:test";
import { File } from "node:buffer";
import { readFile } from "node:fs/promises";
import ts from "typescript";
globalThis.File ??= File;
const source = await readFile(new URL("../features/workspace/project/analysis/attachment-draft.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 } }).outputText;
const { pastedTextFile, pasteThreshold, validateAttachments } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

test("large paste preserves exact UTF-8 bytes, BOM, CRLF, emoji and trailing whitespace", async () => {
  const text = "\uFEFF  고객\r\n😀" + "a".repeat(9000) + " \n";
  const file = pastedTextFile(text, 8000);
  assert.equal(file.name, "pasted-text.txt");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(text, "utf8"));
});
test("threshold boundary, invalid configuration and textarea overflow", () => {
  assert.equal(pasteThreshold(undefined), 8000);
  assert.equal(pasteThreshold("1000"), 1000);
  assert.equal(pasteThreshold("0"), 8000);
  assert.equal(pasteThreshold("50001"), 8000);
  assert.equal(pastedTextFile("a".repeat(7999), 8000), null);
  assert.ok(pastedTextFile("a".repeat(8000), 8000));
  assert.ok(pastedTextFile("12345", 8000, 3));
});
test("count, per-file, total byte, empty and path-like names fail closed", () => {
  const file = (name = "a.txt", size = 10) => new File([new Uint8Array(size)], name);
  assert.throws(() => validateAttachments([], Array.from({ length: 7 }, () => file())));
  assert.throws(() => validateAttachments([], [file("a.txt", 2097153)]));
  assert.throws(() => validateAttachments([], Array.from({ length: 5 }, () => file("a.txt", 2097152))));
  assert.throws(() => validateAttachments([], [file("a.txt", 0)]));
  assert.throws(() => validateAttachments([], [file("../x.txt")]));
  assert.throws(() => validateAttachments([], [file("a.html")]));
  validateAttachments([], [file("sample.CSV")]);
});
