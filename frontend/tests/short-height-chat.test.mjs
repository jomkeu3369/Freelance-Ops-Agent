import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("short windows reclaim inflexible log padding and cap supplementary controls without hiding them", async () => {
  const css = await readFile(new URL("../features/workspace/fullscreen-chat.css", import.meta.url), "utf8");
  const short = css.slice(css.indexOf("@media (max-height: 560px)"), css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(short, /agent-chat-turns \{ padding-block: 0; \}/);
  assert.match(short, /agent-chat-extras \{ max-height: min\(160px, 20dvh\); \}/);
  assert.doesNotMatch(short, /agent-chat-extras[^}]*display: none/);
  assert.match(css, /workspace-page-label \{ min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis/);
  assert.match(css, /workspace-live-status \{ min-width: 0; max-width: 100%; justify-self: stretch/);
});

test("short-height conversation removes padding minima and provides an internal scroll recovery", async () => {
  const css = await readFile(new URL("../features/workspace/fullscreen-chat.css", import.meta.url), "utf8");
  const emergency = css.slice(css.indexOf("@media (max-height: 320px)"));
  assert.match(emergency, /workspace-main \{ overflow-y: auto/);
  assert.match(emergency, /project-workbench.is-chat \{ min-height: 210px/);
  assert.match(emergency, /agent-chat-turns \{ min-height: 36px; padding-block: 0; overscroll-behavior-y: auto/);
  assert.match(emergency, /textarea \{ height: 40px; min-height: 40px; max-height: 40px/);
  assert.match(emergency, /chat-model-popover \{ position: fixed/);
  assert.match(emergency, /max-height: calc\(100dvh - 16px\)/);
});

test("the viewport-bounded model menu has an explicit close action with focus restoration", async () => {
  const menu = await readFile(new URL("../features/workspace/project/analysis/chat-model-menu.tsx", import.meta.url), "utf8");
  assert.match(menu, /className="icon-button chat-model-close" aria-label=\{t\("닫기"\)\}/);
  assert.match(menu, /setOpen\(false\); trigger.current\?\.focus\(\)/);
  assert.match(menu, /querySelector<HTMLElement>\("select:not\(:disabled\)"\)/);
});
