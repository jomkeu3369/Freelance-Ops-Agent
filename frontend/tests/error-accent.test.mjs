import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("shared form errors retain readable text without the decorative left stripe", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = css.match(/^\.form-error\s*\{([^}]+)\}/m)?.[1];
  assert.ok(rule);
  assert.match(rule, /border:\s*0/);
  assert.doesNotMatch(rule, /border-(left|inline-start)/);
  assert.match(rule, /color:\s*var\(--danger\)/);
});

test("conversation error and attention states do not reintroduce left accent bars", async () => {
  const css = await readFile(new URL("../features/workspace/fullscreen-chat.css", import.meta.url), "utf8");
  const stateRules = [...css.matchAll(/[^{}]*\[data-state="(?:error|attention)"\][^{}]*\{([^}]+)\}/g)];
  for (const [, rule] of stateRules) assert.doesNotMatch(rule, /border-(left|inline-start)/);
  const chat = await readFile(new URL("../features/workspace/project/analysis/agent-chat.tsx", import.meta.url), "utf8");
  assert.match(chat, /role="alert" className="form-error"/);
});
