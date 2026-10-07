import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { originalInputPresentation } from "../app/lib/chat-presentation.mjs";
import { englishUi } from "../app/lib/ui-english.mjs";

const unavailable = "이 요청의 원문을 불러올 수 없습니다.";
const partialAttachments = "일부 첨부 자료 정보를 불러올 수 없습니다.";
const partialInput = "이 요청의 원본 입력 일부를 불러올 수 없습니다.";
const text = "  Exact saved text · 원문\nSecond line  ";

test("healthy and legacy history preserve exact text without a warning", () => {
  for (const metadata of [{}, { originalInputStatus: "AVAILABLE", originalInputIssue: null }]) {
    assert.deepEqual(originalInputPresentation({ requirementText: text, ...metadata }), { text, notices: [] });
    assert.deepEqual(originalInputPresentation({ requirementText: "", ...metadata }), { text: "", notices: [] });
  }
});

test("unavailable inputs never become fabricated user messages or suppress run metadata", () => {
  for (const originalInputIssue of ["MISSING_START", "MALFORMED_PAYLOAD", "MISSING_INPUT", "INVALID_REQUIREMENT_TEXT"]) {
    const item = Object.freeze({ runId: "saved-run", status: "COMPLETED", createdAt: "2026-10-01T00:00:00Z", requirementText: null, originalInputStatus: "UNAVAILABLE", originalInputIssue });
    assert.deepEqual(originalInputPresentation(item), { text: null, notices: [unavailable] });
    assert.equal(item.runId, "saved-run");
    assert.equal(item.status, "COMPLETED");
    assert.equal(item.createdAt, "2026-10-01T00:00:00Z");
  }
  assert.deepEqual(originalInputPresentation({ requirementText: text, originalInputStatus: "UNAVAILABLE" }), { text: null, notices: [unavailable] });
  assert.deepEqual(originalInputPresentation({ requirementText: null }), { text: null, notices: [unavailable] });
});

test("partial attachment metadata keeps valid text and safe summaries", () => {
  const attachments = Object.freeze([{ name: "brief.txt", status: "COMPLETE", notice: "Saved summary" }]);
  const item = Object.freeze({ requirementText: text, originalInputStatus: "PARTIAL", originalInputIssue: "INVALID_ATTACHMENTS", attachments });
  assert.deepEqual(originalInputPresentation(item), { text, notices: [partialAttachments] });
  assert.equal(item.attachments, attachments);
  assert.deepEqual(originalInputPresentation({ ...item, requirementText: null }), { text: null, notices: [unavailable, partialAttachments] });
});

test("partial missing text keeps its distinct explanation, and unknown partial reasons still warn", () => {
  assert.deepEqual(originalInputPresentation({ requirementText: null, originalInputStatus: "PARTIAL", originalInputIssue: "INVALID_REQUIREMENT_TEXT" }), { text: null, notices: [unavailable] });
  assert.deepEqual(originalInputPresentation({ requirementText: text, originalInputStatus: "PARTIAL", originalInputIssue: null }), { text, notices: [partialInput] });
  for (const notice of [unavailable, partialAttachments, partialInput]) assert.equal(typeof englishUi[notice], "string", notice);
  assert.notEqual(englishUi[unavailable], englishUi[partialAttachments]);
});

test("input warnings are separate from user text and keep result fetch, retry, and opening paths", async () => {
  const chat = await readFile(new URL("../features/workspace/project/analysis/agent-chat.tsx", import.meta.url), "utf8");
  assert.match(chat, /originalInputPresentation\(item\)/);
  assert.match(chat, /originalInput\.text && <div className="agent-chat-message user"/);
  assert.match(chat, /originalInput\.notices\.map\(notice => <p className="agent-chat-input-notice"/);
  assert.match(chat, /Promise\.allSettled\(items\.filter/);
  assert.match(chat, /onOpenResult\(view\)/);
  assert.match(chat, /setHistoryRevision\(value => value \+ 1\)/);
  assert.match(chat, /a\.createdAt\.localeCompare\(b\.createdAt\)/);
});
