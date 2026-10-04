import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("composer exposes real model selection and advanced settings beside an explicitly named send action", async () => {
  const chat = await read("../features/workspace/project/analysis/agent-chat.tsx");
  assert.match(chat, /canRun && <fieldset className="agent-chat-tools" disabled=\{sending\}/);
  assert.match(chat, /\{composerTools\}/);
  assert.match(chat, /aria-label=\{t\("AI 설정 열기"\)\}/);
  assert.match(chat, /type="submit" className="primary-button" aria-label=/);
});

test("model controls only change local selection; billing and failure explanations remain visible", async () => {
  const controls = await read("../features/workspace/project/analysis/chat-model-controls.tsx");
  assert.doesNotMatch(controls, /startAgentRun|fetch\(|saveAIConnection|proposeEstimationPolicy/);
  assert.match(controls, /onCredentialChange\(event.target.value\)/);
  assert.match(controls, /onModelChange\(event.target.value\)/);
  assert.match(controls, /내 키로 실행 · 제공사 계정에 청구/);
  assert.match(controls, /자동 전환 없음/);
  assert.match(controls, /connectionError && <span role="alert"/);
});

test("active and clarification runs lock selection; idle choice describes the next send", async () => {
  const workbench = await read("../features/workspace/project/project-workbench.tsx");
  assert.match(workbench, /const runInProgress = !!runId && \(!run \|\| projectDeletionBlockingStatuses.has\(run.status\)\)/);
  assert.match(workbench, /const selectionLocked = busy \|\| runInProgress/);
  assert.match(workbench, /const selectedModelName = runInProgress/);
  assert.match(workbench, /const modelControls = !selectionLocked/);
  assert.match(workbench, /composerTools=\{canRun \? <ChatModelMenu/);
  assert.match(workbench, /locked=\{selectionLocked\}/);
  assert.match(workbench, /runId && !selectionLocked && <button/);
  assert.match(workbench, /requestAnimationFrame\(\(\) => aiSettingsContent.current/);
});

test("model popover supports keyboard opening, Escape, outside dismissal and context reset", async () => {
  const menu = await read("../features/workspace/project/analysis/chat-model-menu.tsx");
  assert.match(menu, /aria-haspopup="dialog" aria-expanded=\{visible\}/);
  assert.match(menu, /event.key === "ArrowDown"/);
  assert.match(menu, /event.key === "Escape"/);
  assert.match(menu, /trigger.current\?\.focus\(\)/);
  assert.match(menu, /contextRef.current !== contextKey/);
  assert.match(menu, /removeEventListener\("pointerdown", outside\)/);
});
