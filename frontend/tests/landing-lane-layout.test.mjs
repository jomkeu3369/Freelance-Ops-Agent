import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readability = await readFile(new URL("../app/landing-readability.css", import.meta.url), "utf8");
const motion = await readFile(new URL("../app/scene-motion.css", import.meta.url), "utf8");

// These are source-level geometry guards, not a substitute for rendered mobile QA.
test("landing lane headings intrinsically size the row above the moving project card", () => {
  assert.match(readability, /\.spatial-board\s*\{[^}]*grid-template-rows:\s*minmax\(64px,\s*auto\)\s+auto/);
  assert.match(readability, /\.spatial-lane\s*\{[^}]*grid-row:\s*1;[^}]*padding-bottom:\s*6px/);
  assert.match(motion, /\.spatial-project-card\s*\{[^}]*position:\s*relative;[^}]*grid-row:\s*2/);
  assert.doesNotMatch(readability, /\.spatial-board\s*\{[^}]*grid-template-rows:\s*\d+px\s+auto/);
});

test("landing lane decoration spans both rows without covering content or intercepting input", () => {
  assert.match(readability, /\.spatial-board::before,\s*\.figma-home\.spatial-site\s+\.spatial-board::after\s*\{[^}]*content:\s*"";[^}]*grid-row:\s*1\s*\/\s*3;[^}]*pointer-events:\s*none;[^}]*z-index:\s*0/);
  assert.match(readability, /\.spatial-board::before\s*\{\s*grid-column:\s*1/);
  assert.match(readability, /\.spatial-board::after\s*\{\s*grid-column:\s*2/);
  assert.match(readability, /\.spatial-lane\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*none;[^}]*z-index:\s*1/);
  assert.match(readability, /\.spatial-project-card\s*\{\s*z-index:\s*1/);
  assert.doesNotMatch(readability, /\.spatial-(?:board|lane)\s*\{[^}]*overflow:\s*(?:hidden|clip)/);
});
