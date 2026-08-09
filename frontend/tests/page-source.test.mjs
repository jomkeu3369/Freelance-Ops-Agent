import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);

test("landing page keeps the primary navigation sections", async () => {
  const source = await readFile(pageUrl, "utf8");

  for (const sectionId of ["top", "intake", "workflow", "stories"]) {
    assert.match(source, new RegExp(`id=["']${sectionId}["']`));
  }
});

test("layout declares Korean locale and social metadata", async () => {
  const source = await readFile(layoutUrl, "utf8");

  assert.match(source, /<html lang="ko"/);
  assert.match(source, /openGraph:/);
  assert.match(source, /twitter:/);
});
