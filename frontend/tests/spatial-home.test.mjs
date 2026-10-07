import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { translateUi } from "../features/home/ui-locale.mjs";
import { englishUi } from "../features/home/ui-english.mjs";
import { demoEvents, demoProjectSnapshot, demoQuote, demoReducer, demoScopes, demoSteps, demoView, initialDemoState } from "../features/home/product-demo.mjs";

const componentFiles = ["product-experience.tsx", "reference-story.tsx", "home-header.tsx", "home-sections.tsx"];

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

test("reduced-motion view keeps its completed proposal on the first and repeated scope edits", async () => {
  const component = await readFile(new URL("../features/home/components/product-experience.tsx", import.meta.url), "utf8");
  assert.match(component, /const view = demoView\(state, reducedMotion\)/, "Exercise the same derivation used by the rendered workflow");
  let state = initialDemoState();
  assert.equal(demoView(state, true).selected, 4);
  for (const scope of ["extended", "essential", "extended", "extended", "essential"]) {
    state = demoReducer(state, { type: "scope", scope });
    const view = demoView(state, true);
    const final = demoProjectSnapshot(view, true);
    assert.equal(view.selected, 4, "Scope changes must not silently select the inquiry stage");
    assert.equal(view.phase, "complete");
    assert.equal(final.id, "FO-024");
    assert.equal(final.column, 1);
    assert.equal(final.status, "협상 중");
    assert.equal(final.detail, demoEvents[4]);
    assert.equal(final.quote.total, scope === "extended" ? 3900000 : 3000000);
    assert.equal(final.quote.days, scope === "extended" ? 13 : 10);
    assert.equal(state.manual, true, "Scope updates still enable the accessible result announcement");
    assert.equal(state.manualStage, false);
    assert.equal(state.paused, true);
    assert.equal(demoReducer(state, { type: "tick" }), state);
    assert.equal(state.selected, 0, "The static view must not overwrite the autoplay cursor");
    assert.equal(state.step, 0);
    assert.equal(state.phase, "running");
    assert.deepEqual(state.history, []);
  }
});

test("explicit stage previews survive scope edits and live motion preference changes", () => {
  for (let stage = 0; stage < demoSteps.length; stage++) {
    let state = demoReducer(initialDemoState(), { type: "select", step: stage });
    for (const scope of ["extended", "essential", "extended"]) {
      state = demoReducer(state, { type: "scope", scope });
      for (const reducedMotion of [true, false, true]) {
        const view = demoView(state, reducedMotion);
        assert.equal(view.selected, stage);
        assert.equal(demoProjectSnapshot(view, reducedMotion).column, stage === 4 ? 1 : 0);
        assert.equal(state.manualStage, true);
        assert.deepEqual(state.history, []);
      }
    }
  }
  const next = demoReducer(initialDemoState(), { type: "next" });
  assert.equal(demoView(next, true).selected, 1, "Next is also an explicit stage preview");
});

test("scope-only interaction preserves autoplay pause/resume and live reduced-motion projection", () => {
  let state = demoReducer(initialDemoState(), { type: "tick" });
  state = demoReducer(state, { type: "tick" });
  state = demoReducer(state, { type: "scope", scope: "extended" });
  for (const reducedMotion of [false, true, false, true]) {
    const view = demoView(state, reducedMotion);
    assert.equal(view.selected, reducedMotion ? 4 : 1);
    assert.equal(view.phase, reducedMotion ? "complete" : "running");
    assert.equal(state.paused, true);
    assert.deepEqual(state.history, [0]);
  }
  state = demoReducer(state, { type: "select", step: 3 });
  state = demoReducer(state, { type: "pause" });
  assert.equal(state.paused, false);
  assert.equal(state.manual, false);
  assert.equal(state.manualStage, false);
  assert.equal(demoView(state, false).selected, 1, "Resume returns to the original execution cursor");
  assert.equal(demoView(state, true).selected, 4, "Resume clears an explicit preview for future motion preference changes");
  state = demoReducer(state, { type: "tick" });
  assert.deepEqual(state.history, [0, 1]);
  state = demoReducer(state, { type: "select", step: 2 });
  state = demoReducer(state, { type: "replay" });
  assert.equal(state.manualStage, false);
  assert.equal(state.scope, "extended");
  assert.equal(demoView(state, true).selected, 4);
  assert.equal(demoView(state, false).selected, 0);
});

const sourceFile = path => readFile(new URL(path, import.meta.url), "utf8");

test("proposal bars do not repeat numeric effort in the accessible table", async () => {
  const story = await sourceFile("../features/home/components/reference-story.tsx");
  const source = ts.createSourceFile("reference-story.tsx", story, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const decorative = [];
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const attributes = node.openingElement.attributes.properties;
      const attribute = name => attributes.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === name)?.initializer?.text;
      if (attribute("className") === "story-grid-effort") {
        decorative.push(node);
        assert.equal(attribute("aria-hidden"), "true", "Visual bar header and cells are decorative at every viewport");
        assert.equal(attribute("role"), undefined, "Decorative bars must not create a duplicate table column");
        assert.doesNotMatch(node.getText(source), /className="sr-only"/);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(decorative.length, 2, "One decorative header and one mapped visual cell");
  assert.match(story, /<span role="cell">\{row\.days\}\{t\("일"\)\}<\/span>/, "One readable effort cell remains");
});

test("mixed-content action text remains readable and the handoff observes its inner target geometry", async () => {
  const [css, hook] = await Promise.all([
    sourceFile("../app/landing-readability.css"),
    sourceFile("../features/home/use-home-animation.ts")
  ]);
  for (const selector of [".spatial-assumptions summary", ".spatial-scope-estimator aside > a", "> footer > div > p"]) {
    const rule = css.slice(css.lastIndexOf(selector)).split("}")[0];
    assert.ok(Number(rule.match(/font-size:\s*(\d+)px/)?.[1]) >= 13, selector);
  }
  assert.match(hook, /target\.closest<HTMLElement>\("\.story-radial"\)/);
  assert.match(hook, /if \(targetFrame\) layoutObserver\.observe\(targetFrame\)/);
  assert.match(hook, /layoutObserver\.observe\(target\)/);
  const navIntro = hook.match(/gsap\.from\("\.nav-shell",\s*\{([^}]*)\}/)?.[1];
  assert.ok(navIntro, "The header still has a short opacity entrance");
  assert.doesNotMatch(navIntro, /\b(?:x|y|xPercent|yPercent|transform):/, "CSS must own responsive percentage centering");
});

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
  assert.match(component, /data-motion-paused=\{reducedMotion\s*\|\|\s*!pageVisible\}/);
  assert.match(component, /setPageVisible\(!document\.hidden\)/);
  for (const action of ["add", "remove"]) {
    assert.match(component, new RegExp(`document\\.${action}EventListener\\("visibilitychange", syncVisibility\\)`));
    assert.match(component, new RegExp(`preference\\.${action}EventListener\\("change", syncMotion\\)`));
  }
  assert.match(component, /observer\.disconnect\(\)/);
  for (const layer of ["scene-hero-light", "scene-fog", "scene-evidence-light", "scene-footer-light"]) assert.ok(atmosphere.includes(layer));
  assert.ok((atmosphere.match(/data-ambient-visible="false"/g) ?? []).length >= 4);
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
  assert.doesNotMatch(css, /story-prism-cap|scenePrismCap/, "Removed detached caps must not remain in motion styles");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\[data-ambient\]\s*\*/);
  assert.match(reduced, /animation:\s*none\s*!important/);
  assert.match(reduced, /scene-travel[^}]*display:\s*none/);
});

test("intrinsic card sizing and opaque prism groups protect real content without a page overflow mask", async () => {
  const [home, css] = await Promise.all([
    sourceFile("../features/home/home-page.tsx"),
    sourceFile("../app/scene-motion.css")
  ]);
  assert.doesNotMatch(home, /overflow-x-hidden|overflow-hidden/);
  assert.match(css, /\.figma-home\.spatial-site\s*\{[^}]*overflow:\s*visible/);
  assert.match(css, /\.spatial-board\s*\{[^}]*grid-template-rows:\s*55px auto/);
  assert.match(css, /\.spatial-project-card\s*\{[^}]*position:\s*relative;[^}]*grid-row:\s*2/);
  assert.match(css, /\.story-prism-chart\s+\.spatial-bar\s*\{[^}]*opacity:\s*1;[^}]*transform-style:\s*preserve-3d/);
});

test("brand handoff travels into the measured radial target and reverses its single-logo visibility switch", async () => {
  const [hook, story, css, motionCss] = await Promise.all([
    sourceFile("../features/home/use-home-animation.ts"),
    sourceFile("../features/home/components/reference-story.tsx"),
    sourceFile("../app/reference-story.css"),
    sourceFile("../app/scene-motion.css")
  ]);
  assert.match(story, /data-story-brand-target/);
  assert.match(story, /data-story-merge-card/);
  assert.equal((hook.match(/id:\s*"story-brand-merge"/g) ?? []).length, 1);
  assert.doesNotMatch(hook, /story-brand-fold/, "A single scrubbed playhead must own the complete hold, fold and flight");
  assert.match(hook, /trigger:\s*stage,\s*start:\s*"center 70%"/);
  assert.match(hook, /end:\s*"center 65%"/);
  assert.match(hook, /scrub:\s*\.85/);
  assert.ok(hook.includes('clipPath: "inset(var(--brand-clip-top) var(--brand-clip-side) var(--brand-clip-bottom) var(--brand-clip-side) round var(--brand-clip-radius))"'));
  for (const part of ["top", "side", "bottom"]) {
    assert.ok(hook.includes(`"--brand-clip-${part}": "0px"`));
    assert.ok(hook.includes('"--brand-clip-' + part + '": () => `${clipInsets().' + part + '}px`'));
  }
  assert.match(hook, /"--brand-clip-radius":\s*"20px"/);
  assert.match(hook, /\.fromTo\(plate,\s*\{[^}]*"--brand-clip-radius":\s*"20px"[^}]*\},\s*\{[\s\S]*"--brand-clip-radius":\s*"28px"/, "The tween must explicitly start radius at 20px after every refresh");
  assert.doesNotMatch(hook, /\.(?:to|fromTo)\(plate,\s*\{\s*clipPath:/, "Never tween CSSOM-normalized clip strings");
  assert.match(hook, /gsap\.set\(copy,\s*\{\s*opacity:\s*1\s*\}\)/);
  assert.match(hook, /"--brand-clip-radius":\s*"28px",\s*duration:\s*\.34,\s*ease:\s*"sine.inOut"\s*\},\s*\.12\)/);
  const copyFade = hook.match(/\.to\(copy,\s*\{\s*opacity:\s*0,\s*duration:\s*([.\d]+),\s*ease:\s*"[^"]+"\s*\},\s*([.\d]+)\)/);
  assert.ok(copyFade, "The copy has one coordinated fade inside the fold timeline");
  assert.ok(Number(copyFade[2]) >= .12, "Copy stays fully readable through the initial hold");
  assert.ok(Number(copyFade[1]) + Number(copyFade[2]) <= .2, "Copy disappears before the collapsing edge clips its first line");
  assert.match(hook, /duration:\s*\.54,\s*ease:\s*"power1.inOut"\s*\},\s*\.46\)/);
  assert.match(hook, /endTrigger:\s*target/);
  assert.match(hook, /const top\s*=\s*mark\.offsetTop/);
  assert.match(hook, /from\.top\s*\+\s*mark\.offsetTop/);
  assert.match(hook, /Math\.max\(stage\.offsetHeight\s*\*\s*\.57\s*\+\s*24,\s*copy\.offsetTop\s*\+\s*copy\.offsetHeight\s*\+\s*24\s*\+\s*mark\.offsetHeight\s*\/\s*2\)/);
  assert.match(hook, /refreshFlight\(\);\s*ScrollTrigger\.addEventListener\("refreshInit",\s*refreshFlight\)/);
  assert.match(hook, /ScrollTrigger\.removeEventListener\("refreshInit",\s*refreshFlight\)/);
  assert.match(hook, /return\s*\{\s*top:\s*top - half,\s*side,\s*bottom:\s*stage\.offsetHeight - top - half\s*\}/);
  assert.match(hook, /layoutObserver\.observe\(copy\)/);
  assert.match(hook, /stage\.getBoundingClientRect\(\)/);
  assert.match(hook, /target\.getBoundingClientRect\(\)/);
  assert.match(hook, /scale:\s*to\.width\s*\/\s*mark\.offsetWidth/);
  assert.match(hook, /destination:\s*destination\(\)/);
  assert.match(hook, /createBrandFlightRenderer\(gsap, mark\)/);
  assert.doesNotMatch(hook, /gsap\.set\(mark, flight\.sample/, "Per-frame set tweens must not accumulate in the GSAP context");
  assert.match(hook, /\.set\(target,\s*\{\s*autoAlpha:\s*1\s*\},\s*1\)/);
  assert.match(hook, /\.set\(mark,\s*\{\s*autoAlpha:\s*0\s*\},\s*1\)/);
  assert.match(hook, /invalidateOnRefresh:\s*true/);
  assert.match(hook, /new ResizeObserver/);
  assert.match(hook, /ScrollTrigger\.refresh\(\)/);
  assert.match(hook, /layoutObserver\.disconnect\(\)/);
  assert.match(hook, /cancelAnimationFrame\(refreshFrame\)/);
  assert.match(css, /\.story-brand-scene\s*\{[^}]*overflow:\s*visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*\.story-brand-plate\s*\{[^}]*clip-path:\s*none/);
  assert.match(motionCss, /\.spatial-stage:nth-of-type\(1\)\s*\{\s*transform:\s*none/);

  const source = ts.createSourceFile("reference-story.tsx", story, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let sourceAncestors;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "data-story-brand-mark")) {
      sourceAncestors = [];
      for (let ancestor = node.parent.parent; ancestor; ancestor = ancestor.parent) {
        if (!ts.isJsxElement(ancestor)) continue;
        const attribute = ancestor.openingElement.attributes.properties.find(value => ts.isJsxAttribute(value) && value.name.getText(source) === "className");
        if (attribute?.initializer && ts.isStringLiteral(attribute.initializer)) sourceAncestors.push(attribute.initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(sourceAncestors?.includes("story-brand-stage"));
  assert.ok(!sourceAncestors.includes("story-brand-plate"), "The flying source cannot remain inside the clipped plate");
});

test("metric counts preserve accurate accessible finals while decorative entry reads current scope props", async () => {
  const [helper, story] = await Promise.all([
    sourceFile("../features/home/components/story-metric-entry.tsx"),
    sourceFile("../features/home/components/reference-story.tsx")
  ]);
  assert.match(helper, /value\.toFixed\(decimals\)\.padStart\(digits,\s*"0"\)/);
  assert.match(helper, /const final\s*=\s*formatCount\(value,\s*decimals,\s*digits\)/);
  assert.match(helper, /aria-hidden="true"\s+data-story-count=\{value\}/);
  assert.match(helper, /<span className="sr-only">\{final\}<\/span>/);
  assert.doesNotMatch(helper, /aria-live|role="status"/);
  assert.match(helper, /Number\(element\.dataset\.storyCount\)/);
  assert.match(helper, /Number\(element\.dataset\.countDecimals\)/);
  assert.match(helper, /Number\(element\.dataset\.countDigits\)/);
  assert.match(helper, /formatCount\(value\s*\*\s*progress,\s*decimals,\s*digits\)/);
  assert.match(story, /useStoryMetricEntry\(`\$\{quote\.rows\.length\}:\$\{quote\.days\}:\$\{quote\.total\}`\)/);
  assert.match(story, /StoryCount value=\{quote\.rows\.length\} digits=\{2\}/);
  assert.match(story, /StoryCount value=\{quote\.days\}/);
  assert.match(story, /StoryCount value=\{quote\.total\s*\/\s*1000000\} decimals=\{1\}/);
});

test("metric entry runs once in view and restores current final values on every interruption and cleanup", async () => {
  const helper = await sourceFile("../features/home/components/story-metric-entry.tsx");
  assert.match(helper, /useRef\(new WeakSet<Element>\(\)\)/);
  assert.match(helper, /if\s*\(entered\.current\.has\(scene\)\s*\|\|\s*document\.hidden\s*\|\|\s*preference\.matches\)\s*return/);
  assert.match(helper, /entered\.current\.add\(scene\)/);
  assert.match(helper, /new IntersectionObserver/);
  assert.match(helper, /if\s*\(entry\.isIntersecting\s*&&\s*entry\.intersectionRatio\s*>=\s*\.35\)\s*\{\s*visible\.add\(scene\);\s*enter\(scene\)/);
  assert.match(helper, /if\s*\(active\.has\(scene\)\)\s*restore\(scene\)/);
  assert.match(helper, /if\s*\(document\.hidden\)\s*\{\s*for\s*\(const scene of active\.keys\(\)\)\s*restore\(scene\)/);
  assert.match(helper, /active\.get\(scene\)\?\.kill\(\)/);
  assert.match(helper, /renderCount\(scene,\s*1\)/);
  assert.match(helper, /storyEntryState\s*=\s*"complete"/);
  assert.match(helper, /observer\.disconnect\(\)/);
  assert.match(helper, /preference\.removeEventListener\("change",\s*syncMotion\)/);
  assert.match(helper, /document\.removeEventListener\("visibilitychange",\s*syncVisibility\)/);
  assert.match(helper, /for\s*\(const scene of scenes\)\s*restore\(scene\)/);
  assert.match(helper, /\},\s*\[revision\]\)/);
  assert.doesNotMatch(helper, /setInterval|setTimeout|requestAnimationFrame/);
  const entry = helper.slice(helper.indexOf("const enter ="), helper.indexOf("const observer ="));
  assert.ok(entry.indexOf("entered.current.has(scene)") < entry.indexOf("gsap.timeline("));
  for (const property of ["stroke-dasharray", "stroke-dashoffset", "opacity", "transform", "transform-origin"]) assert.ok(helper.includes(`removeProperty("${property}")`));
  assert.match(entry, /data-story-ring/);
  assert.doesNotMatch(helper, /data-story-sparkline|data-story-spark-point/);
  assert.match(entry, /data-story-task-marker[\s\S]*opacity:\s*\.35,[\s\S]*stagger:\s*\.1/);
  assert.match(helper, /\[data-story-segment\], \[data-story-task-marker\]/);
  assert.match(entry, /data-story-segment[\s\S]*stagger:\s*\.055/);
});

test("the brief intro is decorative, centered, bounded and skipped for reduced motion, mobile and deep links", async () => {
  const [home, hook, css] = await Promise.all([
    sourceFile("../features/home/home-page.tsx"),
    sourceFile("../features/home/use-home-animation.ts"),
    sourceFile("../app/scene-motion.css")
  ]);
  assert.match(home, /className="spatial-intro"\s+data-story-intro\s+aria-hidden="true"/);
  assert.match(home, /spatial-intro-mark"><StoryMark\s*\/>/);
  const introMarkup = home.slice(home.indexOf('<div className="spatial-intro"'), home.indexOf("<HomeHeader"));
  assert.doesNotMatch(introMarkup, /StoryCount|progressbar|aria-live|tabIndex|<button|<input/);
  assert.match(css, /\.spatial-intro\s*\{[^}]*display:\s*none;[^}]*pointer-events:\s*none/);
  assert.match(css, /\.spatial-intro-mark\s*\{[^}]*top:\s*50%;[^}]*left:\s*50%/);
  assert.match(css, /@media\s*\(max-width:\s*820px\),\s*\(prefers-reduced-motion:\s*reduce\)[^{]*\{[^}]*\.spatial-intro\s*\{\s*display:\s*none\s*!important/);
  assert.match(hook, /window\.scrollY\s*<\s*16/);
  assert.match(hook, /!window\.location\.hash\s*\|\|\s*window\.location\.hash\s*===\s*"#top"/);
  assert.match(hook, /&&\s*!document\.hidden/);
  assert.match(hook, /opening\.to\(shell,\s*\{\s*scale:\s*90\s*\/\s*size,\s*duration:\s*\.64/);
  assert.match(hook, /\.to\(openingMark,\s*\{\s*opacity:\s*0,\s*scale:\s*\.82,\s*duration:\s*\.17\s*\},\s*\.61\)/);
  assert.match(hook, /onComplete:\s*\(\)\s*=>\s*gsap\.set\(intro,\s*\{\s*display:\s*"none"\s*\}\)/);
  assert.match(hook, /opening\?\.kill\(\)/);
  for (const event of ["wheel", "touchstart", "pointerdown", "keydown", "scroll", "visibilitychange"]) assert.ok(hook.includes(`"${event}"`), `Intro cancellation must handle ${event}`);
  assert.match(hook, /window\.addEventListener\(event,\s*finishOpening,\s*\{\s*passive:\s*true,\s*once:\s*true\s*\}\)/);
  assert.match(hook, /window\.removeEventListener\(event,\s*finishOpening\)/);
  assert.match(hook, /finishOpening\(\);\s*interruptEvents\.forEach/);
});

test("landing typography is bundled with readable fallbacks and text reveals do not blur or tilt the hero", async () => {
  const [home, hook, css, pkg] = await Promise.all([
    sourceFile("../features/home/home-page.tsx"),
    sourceFile("../features/home/use-home-animation.ts"),
    sourceFile("../app/landing-readability.css"),
    sourceFile("../package.json")
  ]);
  assert.match(home, /import "@fontsource-variable\/noto-sans-kr"/);
  assert.ok(JSON.parse(pkg).dependencies["@fontsource-variable/noto-sans-kr"]);
  assert.ok(home.indexOf("landing-readability.css") > home.indexOf("scene-motion.css"), "Readability overrides must follow scene styles");
  assert.match(css, /--landing-font:\s*"Noto Sans KR Variable",\s*"Pretendard Variable",\s*system-ui,\s*sans-serif/);
  assert.match(css, /font-family:\s*var\(--landing-font\)/);
  assert.match(css, /font-synthesis:\s*none/);
  assert.doesNotMatch(hook, /filter:\s*["']blur\(/, "Functional content must not blur during entry");
  assert.match(css, /\.spatial-flow:hover\s*\{[^}]*transform:\s*none;[^}]*transition:\s*none;[^}]*backdrop-filter:\s*none/);
  assert.match(css, /\.reference-story \.spatial-effort\s*\{\s*transform:\s*none/);
  assert.match(css, /html\[lang="en"\][^{]*\.spatial-hero-title > span\s*\{[^}]*font-family:\s*inherit;[^}]*font-style:\s*normal/);
});

test("mobile and reduced brand plates reserve intrinsic space for readable copy above the source logo", async () => {
  const css = await sourceFile("../app/landing-readability.css");
  const staticPlate = css.slice(css.indexOf('@media (max-width: 820px), (prefers-reduced-motion: reduce)'));
  assert.match(staticPlate, /\.story-brand-stage\s*\{\s*height:\s*auto/);
  assert.match(staticPlate, /\.story-brand-plate\s*\{[^}]*position:\s*relative;[^}]*height:\s*auto\s*!important;[^}]*padding:\s*28px 24px calc\(var\(--brand-mark-size\) \+ 64px\)/);
  assert.match(staticPlate, /\.story-brand-plate-copy\s*\{\s*position:\s*static/);
  assert.match(staticPlate, /\.story-brand-mark\s*\{\s*top:\s*auto;\s*bottom:\s*32px;\s*transform:\s*translateX\(-50%\)/);
});


test("effort prisms keep attached faces and static translated labels while their bodies fan open", async () => {
  const [component, hook, storyCss, readability, entry, motionCss] = await Promise.all([
    sourceFile("../features/home/components/reference-story.tsx"),
    sourceFile("../features/home/use-home-animation.ts"),
    sourceFile("../app/reference-story.css"),
    sourceFile("../app/landing-readability.css"),
    sourceFile("../features/home/components/story-metric-entry.tsx"),
    sourceFile("../app/graph-motion.css")
  ]);
  const prism = component.slice(component.indexOf("function EffortPrisms"), component.indexOf("function BenefitCards"));
  assert.doesNotMatch(prism + storyCss + readability, /story-prism-cap|scenePrismCap/);
  assert.match(prism, /data-count=\{quote\.rows\.length\}/);
  assert.match(prism, /--prism-height":\s*`\$\{row\.days \* 29\}px`/);
  assert.match(prism, /className="story-prism-task-full">\{t\(row\.title\)\}/);
  assert.match(prism, /className="story-prism-task-short">\{t\(shortLabels\[index\]\)\}/);
  for (const face of ["front", "side", "top"]) assert.equal((prism.match(new RegExp(`className="story-prism-${face}"`, "g")) ?? []).length, 1);
  assert.doesNotMatch(hook, /data-story-prism/, "One scoped metric timeline owns prism entry");
  assert.match(prism, /className="spatial-bar" data-story-prism/, "Only the decorative body animates");
  assert.doesNotMatch(prism, /className="story-prism-column"[^>]*data-story-prism/);
  assert.match(entry, /data-story-prism[\s\S]*duration:\s*\.74,\s*stagger:\s*\.1/);
  assert.match(motionCss, /rotateX\(-18deg\) rotateY\(-35deg\) scaleY\(var\(--story-prism-grow, 1\)\)/);
  assert.match(motionCss, /transform-origin:\s*center bottom;\s*opacity:\s*1;\s*transform-style:\s*preserve-3d/);
  assert.match(prism, /className="story-prism-stack"/);
  assert.match(readability, /\.story-prism-chart\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto 1px auto/);
  assert.match(readability, /\.story-prism-column\s*\{\s*display:\s*contents/);
  assert.match(readability, /\.story-prism-stack\s*\{[^}]*grid-row:\s*1/);
  assert.match(readability, /\.story-prism-column > small\s*\{[^}]*grid-row:\s*3/);
  assert.match(storyCss, /\.story-prism-top\s*\{[^}]*top:\s*0;[^}]*transform:\s*translateY\(-50%\) rotateX\(90deg\)/);
  assert.match(storyCss, /\.story-prism-front\s*\{[^}]*transform:\s*translateZ\(var\(--prism-half\)\)/);
  assert.match(storyCss, /\.story-prism-side\s*\{[^}]*transform:\s*rotateY\(90deg\) translateZ\(var\(--prism-half\)\)/);
  assert.match(readability, /\.story-prism-chart \.spatial-bar-label\s*\{[^}]*font-size:\s*16px/);
  assert.match(readability, /\.story-prism-column > small\s*\{[^}]*font-size:\s*14px;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
  assert.match(readability, /\.story-prism-chart\[data-count="4"\] \.spatial-bar\s*\{\s*--prism-width:\s*28px;\s*--prism-half:\s*14px/);
});


test("sample task counts use a truthful semantic list rather than an unrelated effort trend", async () => {
  const story = await sourceFile("../features/home/components/reference-story.tsx");
  const sample = story.slice(story.indexOf("function SampleFigures"), story.indexOf("export function ReferenceStory"));
  assert.match(sample, /StoryCount value=\{quote\.rows\.length\} digits=\{2\}/);
  assert.match(sample, /<ul className="story-task-markers" aria-label=\{t\("작업 범위"\)\}/);
  assert.match(sample, /quote\.rows\.map\(\(row, index\) => <li key=\{row\.title\} data-story-task-marker/);
  assert.match(sample, /<span aria-hidden="true">\{String\(index \+ 1\)\.padStart\(2, "0"\)\}<\/span><span>\{t\(row\.title\)\}<\/span>/);
  assert.doesNotMatch(sample, /chartPoints|data-story-sparkline|data-story-spark-point|<polyline/);
});

test("full-page text guards avoid inflated selector specificity and keep explanations and actions readable", async () => {
  const css = await sourceFile("../app/landing-readability.css");
  assert.doesNotMatch(css, /\.reference-story\s+:is\([^)]*(?:\.spatial-bar-label|\.spatial-bars small)/, "A maximum-specificity :is list must not override later chart typography");
  for (const selector of [".story-evidence-meters > div > div > span", ".spatial-quote-total > div > span", ".spatial-scope-estimator .spatial-scope-slider > div", ".spatial-comparison-grid a", ".story-task-markers li"]) {
    const rule = css.slice(css.lastIndexOf(`${selector} {`));
    assert.ok(Number(rule.slice(0, rule.indexOf("}") + 1).match(/font-size:\s*(\d+)px/)?.[1]) >= 14, selector);
  }
  assert.ok(Number(css.match(/\.spatial-comparison-footnote\s*\{[^}]*font-size:\s*(\d+)px/)?.[1]) >= 13);
  assert.ok(Number(css.match(/\.spatial-comparison-grid strong > span\s*\{[^}]*font-size:\s*(\d+)px/)?.[1]) >= 13);
  assert.ok(Number(css.match(/\.spatial-quote-total small,[^}]*\.spatial-effort-number > span\s*\{[^}]*font-size:\s*(\d+)px/)?.[1]) >= 12);
  assert.ok(Number(css.match(/\.final-cta \.spatial-closing-link\s*\{[^}]*font-size:\s*(\d+)px/)?.[1]) >= 14);
  assert.match(css, /@media\s*\(max-width:\s*580px\)\s*\{[^}]*\.spatial-closing-link\s*\{[^}]*flex-direction:\s*column/);
});
