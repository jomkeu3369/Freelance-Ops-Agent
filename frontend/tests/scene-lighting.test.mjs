import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../app/scene-motion.css", import.meta.url), "utf8");
const atmosphere = await readFile(new URL("../features/home/components/scene-atmosphere.tsx", import.meta.url), "utf8");
const lightAnimations = ["sceneLightArrival", "scenePinchArrival", "sceneFilamentSwell", "sceneBloom", "sceneAuraSwell", "sceneFogDrift", "sceneEvidenceDrift"];

function keyframes(name) {
  const start = css.indexOf(`@keyframes ${name} {`);
  assert.notEqual(start, -1, `${name} is defined`);
  let depth = 1;
  let cursor = css.indexOf("{", start) + 1;
  const bodyStart = cursor;
  while (depth && cursor < css.length) {
    if (css[cursor] === "{") depth++;
    if (css[cursor] === "}") depth--;
    cursor++;
  }
  assert.equal(depth, 0, `${name} closes its rules`);
  return css.slice(bodyStart, cursor - 1);
}

// A larger visual envelope must never turn into a page-wide filter animation or
// bypass the visibility, tab-background and user-pause state inherited by decor.
test("lighting animates only opacity/transform and inherits the ambient pause contract", () => {
  for (const name of lightAnimations) {
    const body = keyframes(name);
    const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map(match => match[1]);
    assert.ok(properties.length > 0);
    assert.ok(properties.every(property => ["opacity", "transform"].includes(property)), `${name} cannot animate filters, geometry or foreground colors`);
    const declarations = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => new RegExp(`animation:\\s*${name}\\b`).test(body));
    assert.ok(declarations.length > 0, `${name} is attached to a decorative layer`);
    for (const [, selector, rule] of declarations) {
      assert.match(selector, /\.scene-[a-z-]+/);
      assert.doesNotMatch(selector, /(?:h[1-6]|\.spatial-flow|\.spatial-heading)\b/);
      assert.match(rule, /animation-play-state:\s*var\(--ambient-play-state\)/);
    }
  }
  assert.doesNotMatch(atmosphere, /requestAnimationFrame|setInterval|setTimeout|fetch\(|<canvas|<video/);
});

test("light swells keep a visible luminance range with multi-second rises and a settle", () => {
  for (const name of ["sceneFilamentSwell", "sceneBloom", "sceneAuraSwell", "sceneFogDrift", "sceneEvidenceDrift"]) {
    const body = keyframes(name);
    const opacity = [...body.matchAll(/opacity:\s*([.\d]+)/g)].map(match => Number(match[1]));
    if (name === "sceneFilamentSwell") {
      assert.ok(Math.min(...opacity) >= .5, "The ribbon remains visibly lit between swells");
      assert.ok(Math.max(...opacity) - Math.min(...opacity) >= .4, "The always-visible ribbon still has a clear intensity change");
    } else assert.ok(Math.min(...opacity) <= .3, `${name} returns to a dim state`);
    assert.ok(Math.max(...opacity) >= .9, `${name} reaches a visibly bright state`);
    assert.ok(opacity.length >= 4, `${name} includes a rise, crest and gradual settle`);
    assert.match(body, /0%,\s*100%\s*\{/, "The repeating envelope has no loop-boundary jump");
    const declarations = [...css.matchAll(/animation:\s*([\w]+)\s+([.\d]+)s/g)].filter(([, animation]) => animation === name);
    assert.ok(declarations.length > 0);
    for (const [, , duration] of declarations) assert.ok(Number(duration) >= 8, `${name} is a slow swell, not a flashing effect`);
  }
});

test("hero ribbon combines a bright static core with bounded near and broad light layers", () => {
  const threads = Number(atmosphere.match(/const heroThreads = Array\.from\(\{ length:\s*(\d+)/)?.[1]);
  assert.ok(threads >= 40 && threads <= 48, "The dense hero fan has a bounded strand budget");
  const core = css.match(/\.scene-bend-core\s*\{([^}]+)/)?.[1];
  const halo = css.match(/\.scene-bend-halo\s*\{([^}]+)/)?.[1];
  assert.ok(core && halo);
  const width = rule => Number(rule.match(/stroke-width:\s*([.\d]+)px/)?.[1]);
  assert.ok(width(core) >= 8 && width(core) <= 12, "The bend has a visible narrow hot core");
  assert.ok(width(halo) / width(core) >= 6 && width(halo) <= 110, "The near halo stays distinct from the sharp core and broad bloom");
  assert.match(core, /opacity:\s*\.(?:9\d*)\b/);
  assert.doesNotMatch(core, /animation:|filter:/, "The core remains bright and sharp even when a swell settles");
  assert.match(atmosphere, /className="scene-pinch-bloom"/);
  assert.match(atmosphere, /className="scene-pinch-hotspot"/);
  assert.match(atmosphere, /className="scene-travel scene-bend-travel"/);
  assert.match(css, /\.scene-thread\.is-soft[^}]*\.scene-bend-halo\s*\{\s*display:\s*none/, "Mobile omits the extra blurred material layers");
});

test("hero arrival and new light layers have static visible mobile and reduced-motion fallbacks", () => {
  const mobile = css.slice(css.indexOf("@media (max-width: 820px)"), css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(mobile, /\.scene-hero-arrival[^}]*\.scene-pinch-arrival\s*\{[^}]*animation:\s*none;[^}]*opacity:\s*1;[^}]*transform:\s*none/);
  assert.match(mobile, /\.scene-filament-cluster[^}]*\.scene-footer-bloom[^}]*animation:\s*none/);
  assert.match(mobile, /\.scene-local-aura\s*\{[^}]*display:\s*none;[^}]*animation:\s*none/);
  assert.match(css, /@media \(max-width: 820px\)[^{]*\{\s*[^}]*\.scene-evidence-bloom[^}]*animation:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\[data-ambient\]\s*\*[^}]*animation:\s*none\s*!important/);
  assert.match(css, /\.scene-hero-arrival\s*\{\s*opacity:\s*1/);
  assert.match(css, /\.scene-pinch-arrival\s*\{\s*opacity:\s*1/);
});
