import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const header = await readFile(new URL("../features/home/components/home-header.tsx", import.meta.url), "utf8");
const locale = await readFile(new URL("../features/home/ui-language.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/product-demo.css", import.meta.url), "utf8");

// Geometry and behavior contracts complement the rendered browser coverage.
test("landing header paints edge-to-edge while navigation retains its content gutter", () => {
  assert.match(header, /<header className="nav-shell"[\s\S]*<div className="nav-inner">/);
  assert.match(css, /\.figma-home\.spatial-site \.nav-shell\s*\{[^}]*left:\s*0;[^}]*right:\s*0;[^}]*transform:\s*none;[^}]*width:\s*100%;[^}]*max-width:\s*none/);
  assert.match(css, /\.nav-inner\s*\{[^}]*position:\s*relative;[^}]*width:\s*89%;[^}]*max-width:\s*1720px/);
  assert.doesNotMatch(css, /\.nav-shell[^}]*width:\s*(?:89%|calc\(|min\()/);
  assert.match(css, /@media\(max-width:1200px\)[\s\S]*\.nav-links\.is-open/);
});

test("landing language picker is a scoped, keyboard-accessible listbox with no native select", () => {
  const selector = locale.slice(locale.indexOf("export function LanguageSelector"));
  assert.doesNotMatch(selector, /<select\b/);
  assert.match(selector, /aria-haspopup="listbox"/);
  assert.match(selector, /role="listbox"/);
  assert.match(selector, /aria-activedescendant=/);
  assert.match(selector, /aria-selected=\{locale === language.value\}/);
  for (const key of ["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter"]) assert.ok(selector.includes(`"${key}"`));
  assert.match(selector, /document\.addEventListener\("pointerdown", onOutsidePointer\)/);
  assert.match(selector, /document\.removeEventListener\("pointerdown", onOutsidePointer\)/);
  assert.match(selector, /triggerRef\.current\?\.focus\(\)/);
  assert.match(css, /\.figma-home\.spatial-site \.home-language-list\s*\{[^}]*right:\s*0;[^}]*max-width:\s*calc\(100vw - 32px\)/);
});
