import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("short windows reclaim inflexible log padding and cap supplementary controls without hiding them", async () => {
  const css = await readFile(new URL("../features/workspace/fullscreen-chat.css", import.meta.url), "utf8");
  const short = css.slice(css.indexOf("@media (max-height: 560px)"), css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(short, /agent-chat-turns\s*\{\s*padding-block:\s*0;\s*\}/);
  assert.match(short, /agent-chat-extras\s*\{\s*max-height:\s*min\(160px,\s*20dvh\);\s*\}/);
  assert.doesNotMatch(short, /agent-chat-extras[^}]*display:\s*none/);
  assert.match(css, /workspace-page-label\s*\{\s*min-width:\s*0;\s*overflow:\s*hidden;\s*white-space:\s*nowrap;\s*text-overflow:\s*ellipsis/);
  assert.match(css, /workspace-live-status\s*\{\s*min-width:\s*0;\s*max-width:\s*100%;\s*justify-self:\s*stretch/);
});

test("short-height conversation removes padding minima and provides an internal scroll recovery", async () => {
  const css = await readFile(new URL("../features/workspace/fullscreen-chat.css", import.meta.url), "utf8");
  const emergency = css.slice(css.indexOf("@media (max-height: 320px)"));
  assert.match(emergency, /workspace-main\s*\{\s*overflow-y:\s*auto/);
  assert.match(css, /agent-chat\s*\{[^}]*min-height:\s*320px/s);
  assert.match(emergency, /agent-chat-turns\s*\{\s*min-height:\s*36px;\s*padding-block:\s*0;\s*overscroll-behavior-y:\s*auto/);
  assert.match(emergency, /textarea\s*\{\s*height:\s*40px;\s*min-height:\s*40px;\s*max-height:\s*40px/);
  assert.match(emergency, /chat-model-popover\s*\{\s*position:\s*fixed/);
  assert.match(emergency, /max-height:\s*calc\(100dvh\s*-\s*16px\)/);
});

test("the viewport-bounded model menu has an explicit close action with focus restoration", async () => {
  const menu = await readFile(new URL("../features/workspace/project/analysis/chat-model-menu.tsx", import.meta.url), "utf8");
  assert.match(menu, /className="icon-button\s*chat-model-close"\s*aria-label=\{t\("닫기"\)\}/);
  assert.match(menu, /setOpen\(false\);\s*trigger.current\?\.focus\(\)/);
  assert.match(menu, /querySelector<HTMLElement>\("select:not\(:disabled\)"\)/);
});
