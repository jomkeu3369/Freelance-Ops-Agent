import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

test("comparison boundary uses bounded static glow assets rather than live blurred SVG groups", async () => {
  const source = await readFile(new URL("../features/home/components/scene-atmosphere.tsx", import.meta.url), "utf8");
  const evidence = source.slice(source.indexOf("export function EvidenceAtmosphere"), source.indexOf("export function FooterAtmosphere"));
  const footer = source.slice(source.indexOf("export function FooterAtmosphere"));
  assert.match(evidence, /scene-evidence-material/);
  assert.doesNotMatch(evidence, /<svg|<path|<filter/);
  assert.match(footer, /scene-footer-material/);
  assert.doesNotMatch(footer, /scene-footer-haze|scene-footer-bloom|scene-filament-cluster|<filter/);
  assert.match(footer, /index === 9/);
  let bytes = 0;
  for (const name of ["evidence", "footer"]) bytes += (await stat(new URL(`../public/landing/${name}-glow.webp`, import.meta.url))).size;
  assert.ok(bytes < 140_000, "Both original glow materials have a bounded combined transfer size");
});

test("inactive graph pulses stop and lower scope changes do not observe the whole page for brand refresh", async () => {
  const css = await readFile(new URL("../app/scene-motion.css", import.meta.url), "utf8");
  const hook = await readFile(new URL("../features/home/use-home-animation.ts", import.meta.url), "utf8");
  assert.match(css, /spatial-graph-pulse\[data-active="false"\][^}]*animation-play-state:\s*paused/);
  assert.match(css, /\.scene-fog-drift,\s*\.figma-home\.spatial-site \.scene-fog-cool\s*\{\s*animation:\s*none;\s*transform:\s*none/);
  assert.doesNotMatch(hook, /layoutObserver\.observe\(pageRef\.current/);
  assert.match(hook, /\.spatial-workflow, \.workflow-unfold, \.story-features, \.story-brand-scene, \.story-benefits/);
});
