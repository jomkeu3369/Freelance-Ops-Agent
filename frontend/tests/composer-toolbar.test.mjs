import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("composer exposes real model selection and advanced settings beside an explicitly named send action", async () => {
  const chat = await read("../features/workspace/project/analysis/agent-chat.tsx");
  assert.match(chat, /canRun\s*&&\s*\(?\s*<fieldset\s*className="agent-chat-tools"\s*disabled=\{sending\}/);
  assert.match(chat, /\{composerTools\}/);
  const settings = await read("../features/workspace/project/analysis/chat-settings-button.tsx");
  assert.match(settings, /aria-label=\{t\("AI\s*설정\s*열기"\)\}/);
  assert.match(chat, /type="submit"\s*className="primary-button"\s*aria-label=/);
});

test("model controls only change local selection; billing and failure explanations remain visible", async () => {
  const controls = await read("../features/workspace/project/analysis/chat-model-controls.tsx");
  assert.doesNotMatch(controls, /startAgentRun|fetch\(|saveAIConnection|proposeEstimationPolicy/);
  assert.match(controls, /onCredentialChange\(event.target.value\)/);
  assert.match(controls, /onModelChange\(event.target.value\)/);
  assert.match(controls, /내\s*키로\s*실행\s*·\s*제공사\s*계정에\s*청구/);
  assert.match(controls, /자동\s*전환\s*없음/);
  assert.match(controls, /connectionError\s*&&\s*\(?\s*<span\s*role="alert"/);
});

test("active and clarification runs lock selection; idle choice describes the next send", async () => {
  const workbench = await read("../features/workspace/project/project-workbench.tsx");
  assert.match(workbench, /const\s*runInProgress\s*=\s*!!runId\s*&&\s*\(!run\s*\|\|\s*projectDeletionBlockingStatuses.has\(run.status\)\)/);
  assert.match(workbench, /const\s*selectionLocked\s*=\s*busy\s*\|\|\s*runInProgress/);
  assert.match(workbench, /const\s*selectedModelName\s*=\s*runInProgress/);
  assert.match(workbench, /const\s*modelControls\s*=\s*!selectionLocked/);
  assert.match(workbench, /composerTools=\{\s*canRun\s*\?\s*\(?\s*<ChatModelMenu/);
  assert.match(workbench, /locked=\{selectionLocked\}/);
  assert.match(workbench, /runId\s*&&\s*!selectionLocked\s*&&\s*\(?\s*<button/);
  assert.match(workbench, /requestAnimationFrame\(\(\)\s*=>\s*aiSettingsContent.current/);
});

test("model popover supports keyboard opening, Escape, outside dismissal and context reset", async () => {
  const menu = await read("../features/workspace/project/analysis/chat-model-menu.tsx");
  assert.match(menu, /aria-haspopup="dialog"\s*aria-expanded=\{visible\}/);
  assert.match(menu, /event.key\s*===\s*"ArrowDown"/);
  assert.match(menu, /event.key\s*===\s*"Escape"/);
  assert.match(menu, /trigger.current\?\.focus\(\)/);
  assert.match(menu, /contextRef.current\s*!==\s*contextKey/);
  assert.match(menu, /removeEventListener\("pointerdown",\s*outside\)/);
});
