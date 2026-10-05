import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

async function harness() {
  const document = { activeElement: null, body: null };
  class Element {
    constructor(tagName, children = []) { this.tagName = tagName; this.children = children; this.inert = false; this.tabIndex = tagName === "BUTTON" ? 0 : -1; this.style = { overflow: "" }; for (const child of children) child.parentElement = this; }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    contains(child) { return child === this || this.children.some(item => item.contains(child)); }
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => child.tagName === "BUTTON"); }
    closest(selector) { if (selector === "[inert]") return this.inert ? this : this.parentElement?.closest(selector) ?? null; return null; }
    matches() { return false; }
    getAttribute() { return null; }
    hasAttribute() { return false; }
    getClientRects() { return [{}]; }
    setAttribute(name) { if (name === "inert") this.inert = true; }
    toggleAttribute(name, value) { if (name === "inert") this.inert = value; }
    focus() { if (!this.closest("[inert]") && this.isConnected) document.activeElement = this; }
  }
  const opener = new Element("BUTTON");
  const main = new Element("MAIN", [opener]);
  const firstClose = new Element("BUTTON"), firstLast = new Element("BUTTON");
  const first = new Element("SECTION", [firstClose, firstLast]);
  const secondClose = new Element("BUTTON"), secondLast = new Element("BUTTON");
  const second = new Element("SECTION", [secondClose, secondLast]);
  document.body = new Element("BODY", [main, first, second]);
  document.body.style.overflow = "auto";
  opener.focus();
  const listeners = new Set();
  let effects = [];
  const react = { useRef: value => ({ current: value }), useEffect: callback => { effects.push(callback); } };
  const source = await readFile(new URL("../features/workspace/shared/use-dialog-focus-trap.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: name => { assert.equal(name, "react"); return react; }, document, HTMLElement: Element, window: { addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) } });
  const mount = (element, onClose) => {
    effects = [];
    exports.useDialogFocusTrap({ current: element }, onClose, false, true, true);
    const cleanups = effects.map(effect => effect()).filter(Boolean);
    return () => cleanups.forEach(cleanup => cleanup());
  };
  const key = (value, shiftKey = false) => {
    const event = { key: value, shiftKey, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const listener of listeners) { listener(event); if (event.stopped) break; }
    return event;
  };
  return { document, main, opener, first, firstClose, firstLast, second, secondClose, secondLast, mount, key, listeners };
}

test("only topmost dialog processes Tab and Escape; dismissal restores lower trap and body state", async () => {
  const h = await harness();
  let firstCloses = 0, secondCloses = 0;
  const closeFirst = h.mount(h.first, () => { firstCloses++; });
  assert.equal(h.document.activeElement, h.firstClose);
  const closeSecond = h.mount(h.second, () => { secondCloses++; });
  assert.equal(h.document.activeElement, h.secondClose);
  assert.equal(h.first.inert, true);
  assert.equal(h.key("Tab").prevented, false, "lower modal must not consume normal top-modal tabbing");
  h.key("Tab", true);
  assert.equal(h.document.activeElement, h.secondLast);
  h.key("Tab");
  assert.equal(h.document.activeElement, h.secondClose);
  h.key("Escape");
  assert.equal(secondCloses, 1);
  assert.equal(firstCloses, 0);
  closeSecond();
  assert.equal(h.document.activeElement, h.firstClose);
  assert.equal(h.main.inert, true);
  assert.equal(h.first.inert, false);
  assert.equal(h.document.body.style.overflow, "hidden");
  closeFirst();
  assert.equal(h.main.inert, false);
  assert.equal(h.second.inert, false);
  assert.equal(h.document.activeElement, h.opener);
  assert.equal(h.document.body.style.overflow, "auto");
  assert.equal(h.listeners.size, 0);
});

test("out-of-order lower-dialog unmount preserves top focus and removes all locks when done", async () => {
  const h = await harness();
  const closeFirst = h.mount(h.first, () => {});
  const closeSecond = h.mount(h.second, () => {});
  closeFirst();
  assert.equal(h.document.activeElement, h.secondClose);
  assert.equal(h.main.inert, true);
  assert.equal(h.document.body.style.overflow, "hidden");
  closeSecond();
  assert.equal(h.main.inert, false);
  assert.equal(h.first.inert, false);
  assert.equal(h.document.body.style.overflow, "auto");
  assert.equal(h.listeners.size, 0);
});
