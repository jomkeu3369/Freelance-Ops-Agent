import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const header = await readFile(new URL("../features/home/components/home-header.tsx", import.meta.url), "utf8");
const locale = await readFile(new URL("../features/home/ui-language.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/product-demo.css", import.meta.url), "utf8");

// 배치와 동작 계약을 브라우저 렌더링 검사와 함께 확인한다.
test("landing header paints edge-to-edge while navigation retains its content gutter", () => {
  assert.match(header, /<header\s*className="nav-shell"[\s\S]*<div\s*className="nav-inner">/);
  assert.match(css, /\.figma-home\.spatial-site\s*\.nav-shell\s*\{[^}]*left:\s*0;[^}]*right:\s*0;[^}]*transform:\s*none;[^}]*width:\s*100%;[^}]*max-width:\s*none/);
  assert.match(css, /\.nav-inner\s*\{[^}]*position:\s*relative;[^}]*width:\s*89%;[^}]*max-width:\s*1720px/);
  assert.doesNotMatch(css, /\.nav-shell[^}]*width:\s*(?:89%|calc\(|min\()/);
  assert.match(css, /@media\s*\(max-width:\s*1200px\)[\s\S]*\.nav-links\.is-open/);
});

test("landing language picker is a scoped, keyboard-accessible listbox with no native select", () => {
  const selector = locale.slice(locale.indexOf("export function LanguageSelector"));
  assert.doesNotMatch(selector, /<select\b/);
  assert.match(selector, /aria-haspopup="listbox"/);
  assert.match(selector, /role="listbox"/);
  assert.match(selector, /aria-activedescendant=/);
  assert.match(selector, /aria-selected=\{locale\s*===\s*language.value\}/);
  for (const key of ["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter"]) assert.ok(selector.includes(`"${key}"`));
  assert.match(selector, /document\.addEventListener\("pointerdown",\s*onOutsidePointer\)/);
  assert.match(selector, /document\.removeEventListener\("pointerdown",\s*onOutsidePointer\)/);
  assert.match(selector, /triggerRef\.current\?\.focus\(\)/);
  assert.match(css, /\.figma-home\.spatial-site\s*\.home-language-list\s*\{[^}]*right:\s*0;[^}]*max-width:\s*calc\(100vw\s*-\s*32px\)/);
});
