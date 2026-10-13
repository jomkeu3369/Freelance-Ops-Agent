import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { savedResultPresentation } from "../app/lib/chat-presentation.mjs";
import { continuityEnglish } from "../app/lib/ui-continuity-english.mjs";
import { englishUi } from "../app/lib/ui-english.mjs";

test("only observed COMPLETED state presents a saved result as complete", () => {
  for (const status of [null, "QUEUED", "RUNNING", "WAITING_FOR_USER", "PARTIAL", "FAILED", "CANCELLED", "UNKNOWN"]) {
    const presentation = savedResultPresentation(status);
    assert.equal(presentation.complete, false, status);
    assert.notEqual(presentation.label, "분석 결과", status);
    assert.equal(typeof englishUi[presentation.label], "string", presentation.label);
  }
  assert.deepEqual(savedResultPresentation("COMPLETED"), { complete: true, label: "분석 결과" });
  for (const [key, value] of Object.entries(continuityEnglish)) assert.equal(englishUi[key], value);
});

test("saved output cannot hide active questions or failure reasons and does not expose final actions", async () => {
  const chat = await readFile(new URL("../features/workspace/project/analysis/agent-chat.tsx", import.meta.url), "utf8");
  const result = await readFile(new URL("../features/workspace/project/analysis/analysis-result.tsx", import.meta.url), "utf8");
  const workbench = await readFile(new URL("../features/workspace/project/project-workbench.tsx", import.meta.url), "utf8");
  assert.match(chat, /status === "WAITING_FOR_USER" && item\.runId === runId && clarification/);
  assert.match(chat, /status === "FAILED" && <p[^>]+>\{t\(runFailureMessage/);
  assert.match(chat, /savedResultPresentation\(status\)\.label/);
  assert.match(result, /!resultState\.complete/);
  assert.match(result, /resultState\.complete && onCompareQuotes &&/);
  assert.match(workbench, /quotationDraft=\{run\?\.status === "COMPLETED" \? run\.result\?\.quotationDraft \?\? null : null\}/);
  assert.match(workbench, /quotationDrafts=\{run\?\.status === "COMPLETED" \? run\.result\?\.quotationDrafts \?\? \[\] : \[\]\}/);
});
