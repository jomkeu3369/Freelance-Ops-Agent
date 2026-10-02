import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { translateUi } from "../app/lib/ui-locale.mjs";
import { englishUi } from "../app/lib/ui-english.mjs";
import { demoEvents, demoProjectSnapshot, demoQuote, demoReducer, demoScopes, demoSteps, initialDemoState } from "../features/home/product-demo.mjs";

const componentUrl = new URL("../features/home/components/product-experience.tsx", import.meta.url);

// This includes stageCopy and other indirect t(...) arguments, which the general
// locale scan cannot discover by checking t("literal") calls alone.
test("all spatial scene copy, indirect stage copy and sample data have English translations", async () => {
  const text = await readFile(componentUrl, "utf8");
  const source = ts.createSourceFile("product-experience.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keys = new Set([
    ...demoSteps,
    ...demoEvents,
    ...Object.values(demoScopes).map(scope => scope.label),
    ...demoQuote("extended").rows.map(row => row.title),
    "진행 중",
    "협상 중"
  ]);
  function visit(node) {
    if (ts.isStringLiteral(node) && /[가-힣]/.test(node.text)) keys.add(node.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const missing = [...keys].filter(key => !Object.hasOwn(englishUi, key));
  assert.deepEqual(missing, [], "Every visible or accessible scene string needs English copy");
  for (const key of keys) {
    const translated = translateUi(key, "en");
    assert.doesNotMatch(translated, /[가-힣]/, key);
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(translated), placeholders(key), key);
    assert.equal(translateUi(key, "ko"), key);
  }
});

test("every spatial scope is one shared set of proposal rows, effort bars, days and price", () => {
  for (const scope of Object.keys(demoScopes)) {
    const state = demoReducer(initialDemoState(), { type: "scope", scope });
    const expected = scope === "extended"
      ? { days: 13, total: 3900000, rowDays: [5, 3.5, 1.5, 3] }
      : { days: 10, total: 3000000, rowDays: [5, 3.5, 1.5] };
    const quote = demoQuote(state.scope);
    assert.equal(quote.days, expected.days);
    assert.equal(quote.total, expected.total);
    assert.equal(quote.dailyRate, 300000);
    assert.deepEqual(quote.rows.map(row => row.days), expected.rowDays);
    assert.equal(quote.rows.reduce((sum, row) => sum + row.days, 0), quote.days);
    assert.equal(quote.rows.reduce((sum, row) => sum + row.days * quote.dailyRate, 0), quote.total);
    for (let stage = 0; stage < demoSteps.length; stage++) {
      const preview = demoReducer(state, { type: "select", step: stage });
      const project = demoProjectSnapshot(preview);
      assert.equal(project.id, "FO-024");
      assert.deepEqual(project.quote, quote);
      assert.equal(project.column, stage === 4 ? 1 : 0);
      assert.equal(project.status, stage === 4 ? "협상 중" : "진행 중");
      assert.equal(preview.step, 0, "Manual selection does not execute a workflow stage");
      assert.deepEqual(preview.history, [], "Manual previews do not invent completed work");
    }
  }
});

test("repeated spatial autoplay keeps FO-024 in progress until proposal completion", () => {
  let state = initialDemoState();
  for (let run = 1; run <= 3; run++) {
    assert.equal(state.run, run);
    for (let stage = 0; stage < demoSteps.length; stage++) {
      assert.equal(state.step, stage);
      assert.equal(state.selected, stage);
      assert.equal(state.phase, "running");
      const running = demoProjectSnapshot(state);
      assert.equal(running.id, "FO-024");
      assert.equal(running.column, 0, "Even the running proposal stage stays in progress");
      assert.equal(running.status, "진행 중");
      state = demoReducer(state, { type: "tick" });
      const completed = demoProjectSnapshot(state);
      assert.equal(completed.id, "FO-024");
      assert.equal(completed.column, stage === 4 ? 1 : 0);
      assert.equal(completed.status, stage === 4 ? "협상 중" : "진행 중");
      if (stage < 4) state = demoReducer(state, { type: "tick" });
    }
    state = demoReducer(state, { type: "replay" });
  }
});

test("reduced-motion completion and manual previews remain coherent across scope changes", () => {
  let state = initialDemoState();
  for (const scope of ["extended", "essential", "extended"]) {
    state = demoReducer(state, { type: "scope", scope });
    state = demoReducer(state, { type: "select", step: 4 });
    const final = demoProjectSnapshot(state, true);
    assert.equal(final.id, "FO-024");
    assert.equal(final.column, 1);
    assert.equal(final.quote.total, scope === "extended" ? 3900000 : 3000000);
    assert.equal(final.quote.days, scope === "extended" ? 13 : 10);
    assert.equal(demoReducer(state, { type: "tick" }), state);
    state = demoReducer(state, { type: "select", step: 0 });
    assert.equal(demoProjectSnapshot(state, true).column, 0);
    assert.deepEqual(state.history, []);
  }
});
