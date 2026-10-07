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


test("short paste keeps native insertion at exact remaining capacity and captures one UTF-16 unit over", async () => {
  const text = "😀\r\n끝 ";
  assert.equal(pastedTextFile(text, 8000, text.length), null);
  const overflow = pastedTextFile(text, 8000, text.length - 1);
  assert.ok(overflow);
  assert.deepEqual(Buffer.from(await overflow.arrayBuffer()), Buffer.from(text));
  assert.equal(pastedTextFile("", 8000, 0), null);
  assert.ok(pastedTextFile("😀".repeat(4000), 8000));
  assert.equal(pastedTextFile("😀".repeat(3999), 8000), null);
});

test("paste thresholds reject noninteger, nonfinite and out-of-range configuration", () => {
  for (const value of ["", " ", "NaN", "Infinity", "8000.5", "999", "-1000", "50001"]) assert.equal(pasteThreshold(value), 8000, value);
  assert.equal(pasteThreshold("50000"), 50000);
  assert.equal(pasteThreshold("8001"), 8001);
});

test("attachment validation is atomic and accepts the exact byte and count boundaries", () => {
  const sized = (name, size) => new File([new Uint8Array(size)], name);
  const full = Array.from({ length: 4 }, (_, index) => sized(`boundary-${index}.txt`, 2 * 1024 * 1024));
  validateAttachments(full.slice(0, 3), full.slice(3));
  assert.throws(() => validateAttachments(full, [sized("one-more.txt", 1)]), /8 MiB/);
  const existing = Array.from({ length: 5 }, (_, index) => sized(`existing-${index}.txt`, 1));
  const incoming = [sized("last.txt", 1)];
  validateAttachments(existing, incoming);
  const before = [...existing];
  assert.throws(() => validateAttachments(existing, [...incoming, sized("extra.txt", 1)]), /6개/);
  assert.deepEqual(existing, before);
  assert.deepEqual(incoming.map(file => file.name), ["last.txt"]);
});

test("unsupported names and control characters fail while supported uppercase extensions survive", () => {
  for (const name of ["bad\u0000.txt", "bad\n.txt", "bad\u007f.txt", "a:b.txt", "a\\b.txt", "a/b.txt", `${"a".repeat(177)}.txt`, "archive.txt.exe"]) {
    assert.throws(() => validateAttachments([], [new File(["x"], name)]), undefined, name);
  }
  for (const name of ["sample.TXT", "sample.CSV", "sample.PDF", "sample.JPG", "sample.JPEG", "sample.PNG", "sample.GIF", `${"a".repeat(176)}.txt`]) {
    validateAttachments([], [new File(["x"], name)]);
  }
});

test("oversize multibyte paste is rejected without modifying the original bytes", async () => {
  const text = "고".repeat(700000) + "\r\n😀 trailing  ";
  const pasted = pastedTextFile(text, 8000);
  assert.throws(() => validateAttachments([], [pasted]), /2 MiB/);
  assert.deepEqual(Buffer.from(await pasted.arrayBuffer()), Buffer.from(text));
});
