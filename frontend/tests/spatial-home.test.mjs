import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { translateUi } from "../app/lib/ui-locale.mjs";
import { englishUi } from "../app/lib/ui-english.mjs";
import { demoEvents, demoProjectSnapshot, demoQuote, demoReducer, demoScopes, demoSteps, initialDemoState } from "../features/home/product-demo.mjs";

const componentFiles = ["product-experience.tsx", "reference-story.tsx"];

// Include stageCopy, SectionTitle props and other indirect t(...) arguments,
// which the general locale scan cannot discover through t("literal") calls alone.
test("all hero and reference story copy, indirect props and sample data have English translations", async () => {
  const keys = new Set([
    ...demoSteps,
    ...demoEvents,
    ...Object.values(demoScopes).map(scope => scope.label),
    ...demoQuote("extended").rows.map(row => row.title),
    "진행 중",
    "협상 중"
  ]);
  function visit(node) {
    if (ts.isStringLiteralLike(node) && /[가-힣]/.test(node.text)) keys.add(node.text);
    ts.forEachChild(node, visit);
  }
  for (const filename of componentFiles) {
    const text = await readFile(new URL(`../features/home/components/${filename}`, import.meta.url), "utf8");
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    visit(source);
  }
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

const sourceFile = path => readFile(new URL(path, import.meta.url), "utf8");

test("ambient motion observes each layer independently and cleans up observers, preferences and visibility listeners", async () => {
  const [hook, component, atmosphere] = await Promise.all([
    sourceFile("../features/home/use-home-animation.ts"),
    sourceFile("../features/home/components/product-experience.tsx"),
    sourceFile("../features/home/components/scene-atmosphere.tsx")
  ]);
  assert.match(hook, /new IntersectionObserver/);
  assert.match(hook, /dataset\.ambientVisible\s*=\s*String\(entry\.isIntersecting\)/);
  assert.match(hook, /querySelectorAll<HTMLElement>\("\[data-ambient\]"\)/);
  assert.match(hook, /ambientObserver\.observe\(element\)/);
  assert.match(hook, /ambientObserver\.disconnect\(\)/);
  assert.match(hook, /motion\.revert\(\)/);
  assert.match(component, /data-motion-paused=\{state\.paused\s*\|\|\s*reducedMotion\s*\|\|\s*!pageVisible\}/);
  assert.match(component, /setPageVisible\(!document\.hidden\)/);
  for (const action of ["add", "remove"]) {
    assert.match(component, new RegExp(`document\\.${action}EventListener\\("visibilitychange", syncVisibility\\)`));
    assert.match(component, new RegExp(`preference\\.${action}EventListener\\("change", syncMotion\\)`));
  }
  assert.match(component, /observer\.disconnect\(\)/);
  for (const layer of ["scene-hero-light", "scene-fog", "scene-footer-light"]) assert.ok(atmosphere.includes(layer));
  assert.equal((atmosphere.match(/data-ambient-visible="false"/g) ?? []).length, 3);
  assert.doesNotMatch(atmosphere, /requestAnimationFrame|setInterval|fetch\(|<canvas|<video/);
});

test("CSS travel has visible, paused, mobile and reduced-motion guards", async () => {
  const css = await sourceFile("../app/scene-motion.css");
  assert.match(css, /\[data-ambient\]\s*\{[^}]*--ambient-play-state:\s*paused/);
  assert.match(css, /\[data-ambient-visible="true"\]\s*\{[^}]*--ambient-play-state:\s*running/);
  assert.match(css, /\[data-motion-paused="true"\]\s+\[data-ambient\]\s*\{[^}]*--ambient-play-state:\s*paused/);
  assert.match(css, /scene-hero-light\[data-playing="false"\][^{]*\{[^}]*--ambient-play-state:\s*paused/);
  assert.match(css, /animation-play-state:\s*var\(--ambient-play-state\)/);
  assert.match(css, /@keyframes sceneFilamentTravel\s*\{\s*from\s*\{\s*stroke-dashoffset:\s*1000/);
  const mobile = css.slice(css.indexOf("@media (max-width: 820px)"), css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(mobile, /scene-travel\s*\{\s*display:\s*none/);
  assert.match(mobile, /scene-particles[^}]*display:\s*none/);
  assert.match(mobile, /scene-fog-cool\s*\{\s*animation:\s*none/);
  assert.match(mobile, /story-prism-cap\s*\{\s*animation:\s*none/);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\[data-ambient\]\s*\*/);
  assert.match(reduced, /animation:\s*none\s*!important/);
  assert.match(reduced, /scene-travel[^}]*display:\s*none/);
});

test("intrinsic card sizing and opaque prism groups protect real content without a page overflow mask", async () => {
  const [home, css, hook] = await Promise.all([
    sourceFile("../features/home/home-page.tsx"),
    sourceFile("../app/scene-motion.css"),
    sourceFile("../features/home/use-home-animation.ts")
  ]);
  assert.doesNotMatch(home, /overflow-x-hidden|overflow-hidden/);
  assert.match(css, /\.figma-home\.spatial-site\s*\{[^}]*overflow:\s*visible/);
  assert.match(css, /\.spatial-board\s*\{[^}]*grid-template-rows:\s*55px auto/);
  assert.match(css, /\.spatial-project-card\s*\{[^}]*position:\s*relative;[^}]*grid-row:\s*2/);
  assert.match(css, /\.story-prism-chart\s+\.spatial-bar\s*\{[^}]*opacity:\s*1;[^}]*transform-style:\s*preserve-3d/);
  assert.match(hook, /\(min-width: 821px\) and \(prefers-reduced-motion: no-preference\)/);
  assert.match(hook, /start:\s*"center 82%",\s*end:\s*"center 42%"/);
});
