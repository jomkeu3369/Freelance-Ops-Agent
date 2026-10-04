import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chatState, resultPendingMessage } from "../app/lib/chat-presentation.mjs";
import { englishUi } from "../app/lib/ui-english.mjs";

const states = [null, "QUEUED", "RUNNING", "WAITING_FOR_USER", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"];
test("activity is derived from real running state; offline, queued, approval and terminal states never animate as work", () => {
  for (const status of states) {
    assert.equal(chatState(status).working, status === "RUNNING");
    assert.equal(chatState(status, { online: false }).working, false);
    assert.equal(chatState(status, { reconnecting: true }).working, false);
  }
  assert.equal(chatState("WAITING_FOR_USER").tone, "attention");
  assert.equal(chatState("COMPLETED").tone, "success");
  assert.equal(chatState("FAILED").tone, "error");
  assert.equal(chatState(null).label, "요청 준비됨");
});

test("terminal and unknown result absence never claims work is still running", () => {
  for (const status of ["COMPLETED", "PARTIAL"]) assert.equal(resultPendingMessage(status), "이 실행에 저장된 결과가 없습니다.");
  assert.match(resultPendingMessage("UNKNOWN"), /확인할 수 없습니다/);
  assert.match(resultPendingMessage("RUNNING"), /진행 중/);
});

test("all state labels, result explanations and starter prompts have explicit English copy", () => {
  const text = new Set(states.flatMap(status => [chatState(status).label, chatState(status, { online: false }).label, chatState(status, { reconnecting: true }).label, resultPendingMessage(status)]));
  text.add("이 프로젝트의 요구사항과 확인할 질문을 정리해 줘");
  text.add("이 프로젝트의 작업 범위와 견적 초안을 만들어 줘");
  for (const key of text) assert.equal(typeof englishUi[key], "string", key);
});

test("professional chrome scopes styles, restores text spans, uses real locale selector and inset log focus", async () => {
  const css = await readFile(new URL("../features/workspace/professional-workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.workspace-connection-label > span\s*\{[^}]*width: auto;[^}]*height: auto;[^}]*background: transparent;/);
  assert.match(css, /\.ui-language-selector/);
  assert.doesNotMatch(css, /\.language-selector\b/);
  assert.match(css, /\.agent-chat-turns:focus-visible\s*\{ outline-offset: -3px;/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /max-height: 560px/);
});

test("navigation is project scoped and no chat action replaces authorization or contracts", async () => {
  const shell = await readFile(new URL("../features/workspace/workspace-shell.tsx", import.meta.url), "utf8");
  const chat = await readFile(new URL("../features/workspace/project/analysis/agent-chat.tsx", import.meta.url), "utf8");
  assert.match(shell, /onSelectProject=\{\(project\) => navigateWorkspace\("project", project, "agent"\)\}/);
  assert.match(chat, /if \(!online \|\| !message.trim\(\)/);
  assert.match(chat, /if \(!canRun\) throw new Error/);
  assert.match(chat, /if \(!canEditPolicy \|\| item.status !== "PENDING" \|\| confirmLock.current\) return;/);
  assert.match(chat, /if \(followsLatest.current\) box.scrollTop = box.scrollHeight;/);
});
