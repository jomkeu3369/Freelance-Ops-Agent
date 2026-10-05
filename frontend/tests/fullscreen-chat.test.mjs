import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("conversation has one viewport shell and independently scrollable reading space", async () => {
  const css = await read("../features/workspace/fullscreen-chat.css");
  assert.match(css, /\.figma-workspace\.conversation-workspace\s*\{[^}]*height: 100dvh; min-height: 0; overflow: hidden/s);
  assert.match(css, /\.is-chat \.agent-chat-turns\s*\{[^}]*flex: 1 1 0; height: auto; min-height: 0/s);
  assert.match(css, /\.is-chat \.agent-chat-composer\s*\{[^}]*flex: 0 0 auto/s);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /max-height: 560px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /requestFullscreen/);
});

test("panels mount on demand, name their dialogs and restore focus through the shared trap", async () => {
  const [panel, step, workbench] = await Promise.all([
    read("../features/workspace/shared/workspace-panel.tsx"),
    read("../features/workspace/project/analysis/analysis-step.tsx"),
    read("../features/workspace/project/project-workbench.tsx"),
  ]);
  assert.match(panel, /useDialogFocusTrap\(panel, onClose, false, true, true\)/);
  assert.match(panel, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/);
  assert.match(panel, /aria-label=\{t\("닫기"\)\}/);
  assert.match(step, /showWorkDetails && <WorkspacePanel/);
  assert.match(step, /resultView\?\.result && <WorkspacePanel/);
  assert.match(workbench, /canRun && showAISettings/);
  assert.match(workbench, /setShowAISettings\(false\)/);
  assert.doesNotMatch(step, /scrollIntoView/);
});

test("small-screen navigation is a named modal, with an accessible icon-only brand", async () => {
  const [chrome, shell] = await Promise.all([
    read("../features/workspace/workspace-chrome.tsx"),
    read("../features/workspace/workspace-shell.tsx"),
  ]);
  assert.match(chrome, /className="workspace-brand" aria-label=/);
  assert.match(chrome, /compactNavigation && !sidebarCollapsed \? "dialog"/);
  assert.match(chrome, /aria-controls="workspace-sidebar"/);
  assert.match(chrome, /useDialogFocusTrap\(sidebar,[^;]*compactNavigation && !sidebarCollapsed, true\)/);
  assert.match(shell, /useSyncExternalStore\(subscribeToCompactNavigation/);
  assert.match(shell, /setMobileMenuOpen\(false\)/);
});

test("unknown usage stays an explicit check state and details are opened by the user", async () => {
  const usage = await read("../features/workspace/usage/free-usage-status.tsx");
  const hook = await read("../features/workspace/usage/use-credit-usage.ts");
  assert.match(hook, /setData\(null\); setFailed\(true\)/);
  assert.match(usage, /isWeeklyCreditUsage\(data\)/);
  assert.match(usage, /t\("사용량 확인 필요"\)/);
  assert.match(usage, /showDetails && <WorkspacePanel/);
  assert.match(usage, /onClick=\{\(\) => void refresh/);
});


test("stacked server notices let only the top dialog own keyboard and background state", async () => {
  const trap = await read("../features/workspace/shared/use-dialog-focus-trap.tsx");
  assert.match(trap, /if \(dialogs.at\(-1\) !== entry\) return/);
  assert.match(trap, /reconcileBackground\(\)/);
  assert.match(trap, /if \(!dialogs.length\) document.body.style.overflow = originalBodyOverflow/);
  assert.match(trap, /event.stopImmediatePropagation\(\)/);
});

test("unmounted chat send continuations cannot clear a remounted project draft", async () => {
  const chat = await read("../features/workspace/project/analysis/agent-chat.tsx");
  assert.match(chat, /return \(\) => \{ mounted.current = false; \}/);
  assert.match(chat, /const accepted = await onSend\(message, attachments.ids\);\s*if \(!mounted.current\) return;/);
  assert.match(chat, /if \(!mounted.current\) return;\s*setProposal\(next\)/);
});
