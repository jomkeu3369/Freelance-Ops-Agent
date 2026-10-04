import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
