import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const [gate, css, media, demo, translations] = await Promise.all([
  read("features/workspace/auth/auth-gate.tsx"), read("features/workspace/auth/auth-cinematic.css"),
  read("features/workspace/auth/login-media.ts"), read("features/workspace/pets/pet-login-demo.tsx"),
  read("app/lib/ui-pet-english.mjs")
]);

test("login prepares optional media without inventing a generated clip or external URL", () => {
  assert.match(gate, /<AuthBackdrop sources=\{loginMedia.sources\} poster=\{loginMedia.poster\}/);
  assert.match(gate, /className="auth-ambient-fallback"/);
  assert.match(media, /sources: \[\]/);
  assert.doesNotMatch(media, /https?:\/\/|\/[^\s"']+\.(?:mp4|webm)/);
  assert.match(media, /poster: "\/login\/pet-path-poster-v1\.webp"/);
  assert.doesNotMatch(gate, /PetLoginDemo/);
});

test("explicit demo disclaimer is removed in both languages rather than hidden by CSS", () => {
  const removed = "예시 미리보기입니다. 로그인 후 나만의 펫을 추가하고 대화로 수정할 수 있어요.";
  assert.equal(gate.includes(removed) || demo.includes(removed) || translations.includes(removed), false);
  assert.doesNotMatch(translations, /These are example previews\. Log in to add your own pet and edit it with prompts\./);
});

test("scene is full bleed, right form retains its independent contrast surface and mobile priority", () => {
  assert.match(css, /\.auth-cinematic \.auth-backdrop__visual \{[^}]*position: fixed;[^}]*pointer-events: none/);
  assert.match(css, /\.auth-cinematic \.auth-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(340px, 440px\)/);
  assert.match(css, /\.auth-cinematic \.auth-panel \{[^}]*background: #fffffff2/);
  assert.match(css, /\[data-theme="dark"\] \.auth-cinematic \.auth-panel \{[^}]*background: #221e30f5/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.auth-message \{ display: none/);
  assert.match(css, /\.auth-cinematic \.auth-backdrop__toggle \{[^}]*z-index: 4/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("header controls share one restrained surface with keyboard focus intact", () => {
  assert.match(css, /\.auth-cinematic \.auth-header-actions \{[^}]*border-radius: 999px/);
  assert.match(css, /\.auth-cinematic \.auth-theme-toggle \{[^}]*border: 0;[^}]*background: transparent/);
  assert.match(css, /\.auth-cinematic \.ui-language-selector select \{[^}]*border: 0;[^}]*background: transparent/);
  assert.match(css, /:focus-visible \{ outline: 2px solid/);
  // Existing request/credential behavior stays in AuthGate; presentation cannot send or generate media.
  assert.match(gate, /submitPending.current/);
  assert.match(gate, /isEmailVerificationRequired\(session\)/);
  assert.match(gate, /ageAtLeast14/);
});
