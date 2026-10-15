import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("conversation has one viewport shell and independently scrollable reading space", async () => {
  const css = await read("../features/workspace/fullscreen-chat.css");
  assert.match(css, /\.figma-workspace\.conversation-workspace\s*\{[^}]*height:\s*100dvh;\s*min-height:\s*0;\s*overflow:\s*hidden/s);
  assert.match(css, /\.is-chat\s*\.agent-chat-turns\s*\{[^}]*flex:\s*1\s*1\s*0;\s*height:\s*auto;\s*min-height:\s*96px/s);
  assert.match(css, /\.is-chat\s*\.agent-chat-composer\s*\{[^}]*flex:\s*0\s*0\s*auto/s);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /max-height:\s*560px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /requestFullscreen/);
});

test("panels mount on demand, name their dialogs and restore focus through the shared trap", async () => {
  const [panel, step, workbench] = await Promise.all([
    read("../features/workspace/shared/workspace-panel.tsx"),
    read("../features/workspace/project/analysis/analysis-step.tsx"),
    read("../features/workspace/project/project-workbench.tsx"),
  ]);
  assert.match(panel, /useDialogFocusTrap\(panel,\s*onClose,\s*false,\s*true,\s*true\)/);
  assert.match(panel, /role="dialog"\s*aria-modal="true"\s*aria-labelledby=\{titleId\}/);
  assert.match(panel, /aria-label=\{t\("닫기"\)\}/);
  assert.match(step, /showWorkDetails\s*&&\s*\(?\s*<WorkspacePanel/);
  assert.match(step, /resultView\?\.result\s*&&\s*\(?\s*<WorkspacePanel/);
  assert.match(workbench, /canRun\s*&&\s*showAISettings/);
  assert.match(workbench, /setShowAISettings\(false\)/);
  assert.doesNotMatch(step, /scrollIntoView/);
});

test("small-screen navigation is a named modal, with an accessible icon-only brand", async () => {
  const [chrome, shell] = await Promise.all([
    read("../features/workspace/workspace-chrome.tsx"),
    read("../features/workspace/workspace-shell.tsx"),
  ]);
  assert.match(chrome, /className="workspace-brand"\s*aria-label=/);
  assert.match(chrome, /compactNavigation\s*&&\s*!sidebarCollapsed\s*\?\s*"dialog"/);
  assert.match(chrome, /aria-controls="workspace-sidebar"/);
  assert.match(chrome, /useDialogFocusTrap\(sidebar,[^;]*compactNavigation\s*&&\s*!sidebarCollapsed,\s*true\)/);
  assert.match(shell, /useSyncExternalStore\(\s*subscribeToCompactNavigation/);
  assert.match(shell, /setMobileMenuOpen\(false\)/);
});

test("unknown usage stays an explicit check state and details are opened by the user", async () => {
  const usage = await read("../features/workspace/usage/free-usage-status.tsx");
  const hook = await read("../features/workspace/usage/use-credit-usage.ts");
  assert.match(hook, /setData\(null\);\s*setFailed\(true\)/);
  assert.match(usage, /isWeeklyCreditUsage\(data\)/);
  assert.match(usage, /t\("사용량\s*확인\s*필요"\)/);
  assert.match(usage, /showDetails\s*&&\s*\(?\s*<WorkspacePanel/);
  assert.match(usage, /onClick=\{\(\)\s*=>\s*void\s*refresh/);
});


test("stacked server notices let only the top dialog own keyboard and background state", async () => {
  const trap = await read("../features/workspace/shared/use-dialog-focus-trap.tsx");
  assert.match(trap, /if\s*\(dialogs.at\(-1\)\s*!==\s*entry\)\s*return/);
  assert.match(trap, /reconcileBackground\(\)/);
  assert.match(trap, /if\s*\(!dialogs.length\)\s*document.body.style.overflow\s*=\s*originalBodyOverflow/);
  assert.match(trap, /event.stopImmediatePropagation\(\)/);
});

test("unmounted chat send continuations cannot clear a remounted project draft", async () => {
  const chat = await read("../features/workspace/project/analysis/agent-chat.tsx");
  assert.match(chat, /return\s*\(\)\s*=>\s*\{\s*mounted.current\s*=\s*false;\s*\}/);
  assert.match(chat, /const\s*accepted\s*=\s*await\s*onSend\(message,\s*attachments.ids,\s*skillSelection\);\s*if\s*\(!mounted.current\)\s*return;/);
  assert.match(chat, /if\s*\(!mounted.current\)\s*return;\s*setProposal\(next\)/);
});
