import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { chatState, resultPendingMessage } from "../app/lib/chat-presentation.mjs";
import { englishUi } from "../app/lib/ui-english.mjs";

const states = [null, "QUEUED", "RUNNING", "WAITING_FOR_USER", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"];
const workflowSource = await readFile(new URL("../app/components/live-workflow.tsx", import.meta.url), "utf8");
const workflowModule = ts.transpileModule(workflowSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const workflow = {};
Function("exports", "require", workflowModule)(workflow, name => {
  if (["react/jsx-runtime", "@phosphor-icons/react", "../lib/ui-language"].includes(name)) return {};
  throw new Error(`Unexpected workflow import: ${name}`);
});
const settledWorkflowCopy = {
  WAITING_FOR_USER: "사용자 확인을 기다리고 있습니다",
  COMPLETED: "분석을 완료했습니다",
  PARTIAL: "완료된 단계의 부분 결과를 준비했습니다",
  FAILED: "실행을 안전하게 중단했습니다",
  CANCELLED: "사용자가 실행을 중단했습니다."
};

test("workflow summary follows the confirmed status after stale or unknown final events", () => {
  for (const [status, expected] of Object.entries(settledWorkflowCopy)) {
    for (const type of ["run.started", "tool.started", "tool.completed", "usage.settled"]) {
      const snapshot = workflow.snapshotFromEvents([{ eventId: 1, type, data: {} }], status);
      assert.equal(snapshot.status, status);
      assert.equal(snapshot.eventLabel, expected, `${status} after ${type}`);
      assert.equal(snapshot.eventCount, 1);
    }
    assert.equal(typeof englishUi[expected], "string", expected);
  }
});

test("workflow summary preserves the confirmed status when no events were delivered", () => {
  for (const [status, expected] of Object.entries(settledWorkflowCopy)) {
    const snapshot = workflow.snapshotFromEvents([], status);
    assert.equal(snapshot.eventLabel, expected, status);
    assert.equal(snapshot.eventCount, 0);
  }
});

test("active workflow summaries still follow delivered events", () => {
  assert.equal(workflow.snapshotFromEvents([], "IDLE").eventLabel, "실행을 기다리고 있습니다");
  assert.equal(workflow.snapshotFromEvents([], "QUEUED").eventLabel, "실행 경로를 준비하고 있습니다");
  assert.equal(workflow.snapshotFromEvents([{ eventId: 1, type: "tool.started", data: {} }], "RUNNING").eventLabel, "필요한 업무 정보를 조회하고 있습니다");
});

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
  assert.match(resultPendingMessage("UNKNOWN"), /확인할\s*수\s*없습니다/);
  assert.match(resultPendingMessage("RUNNING"), /진행\s*중/);
});

test("all state labels, result explanations and starter prompts have explicit English copy", () => {
  const text = new Set(states.flatMap(status => [chatState(status).label, chatState(status, { online: false }).label, chatState(status, { reconnecting: true }).label, resultPendingMessage(status)]));
  text.add("이 프로젝트의 요구사항과 확인할 질문을 정리해 줘");
  text.add("이 프로젝트의 작업 범위와 견적 초안을 만들어 줘");
  for (const key of text) assert.equal(typeof englishUi[key], "string", key);
});

test("professional chrome scopes styles, restores text spans, uses real locale selector and inset log focus", async () => {
  const css = await readFile(new URL("../features/workspace/professional-workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.workspace-connection-label\s*>\s*span\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*background:\s*transparent;/);
  assert.match(css, /\.ui-language-selector/);
  assert.doesNotMatch(css, /\.language-selector\b/);
  assert.match(css, /\.agent-chat-turns:focus-visible\s*\{\s*outline-offset:\s*-3px;/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /max-height:\s*560px/);
});

test("navigation is project scoped and no chat action replaces authorization or contracts", async () => {
  const shell = await readFile(new URL("../features/workspace/workspace-shell.tsx", import.meta.url), "utf8");
  const chat = await readFile(new URL("../features/workspace/project/analysis/agent-chat.tsx", import.meta.url), "utf8");
  assert.match(shell, /onSelectProject=\{\(project\)\s*=>\s*navigateWorkspace\("project",\s*project,\s*"agent"\)\}/);
  assert.match(chat, /if\s*\(!online\s*\|\|\s*!message.trim\(\)/);
  assert.match(chat, /if\s*\(!canRun\)\s*throw\s*new\s*Error/);
  assert.match(chat, /if\s*\(!canEditPolicy\s*\|\|\s*item.status\s*!==\s*"PENDING"\s*\|\|\s*confirmLock.current\)\s*return;/);
  assert.match(chat, /if\s*\(followsLatest.current\)\s*box.scrollTop\s*=\s*box.scrollHeight;/);
});
