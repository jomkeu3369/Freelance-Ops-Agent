import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const [gate, css, media, translations] = await Promise.all([
  read("features/workspace/auth/auth-gate.tsx"), read("features/workspace/auth/auth-cinematic.css"),
  read("features/workspace/auth/login-media.ts"),
  read("app/lib/ui-pet-english.mjs")
]);

test("login wires inspected same-origin motion, matching loading poster and the original approved still", () => {
  const backdrop = gate.match(/<AuthBackdrop\b[\s\S]*?>/)?.[0];
  assert.ok(backdrop);
  for (const property of ["sources", "poster", "staticPoster"]) {
    assert.ok(backdrop.includes(`${property}={loginMedia.${property}}`), `${property} is passed to AuthBackdrop`);
  }
  assert.match(gate, /className="auth-ambient-fallback"/);
  assert.match(media, /sources:\s*\[{\s*src:\s*"\/login\/pet-path-motion-v1\.mp4",\s*type:\s*"video\/mp4"\s*}\]/);
  assert.doesNotMatch(media, /https?:\/\//);
  assert.match(media, /poster:\s*"\/login\/pet-path-motion-poster-v1\.webp"/);
  assert.match(media, /staticPoster:\s*"\/login\/pet-path-poster-v1\.webp"/);
  assert.doesNotMatch(gate, /PetLoginDemo/);
});

test("explicit demo disclaimer is removed in both languages rather than hidden by CSS", () => {
  const removed = "예시 미리보기입니다. 로그인 후 나만의 펫을 추가하고 대화로 수정할 수 있어요.";
  assert.equal(gate.includes(removed) || translations.includes(removed), false);
  assert.doesNotMatch(translations, /These\s*are\s*example\s*previews\.\s*Log\s*in\s*to\s*add\s*your\s*own\s*pet\s*and\s*edit\s*it\s*with\s*prompts\./);
});

test("scene is full bleed, right form retains its independent contrast surface and mobile priority", () => {
  assert.match(css, /\.auth-cinematic\s*\.auth-backdrop__visual\s*\{[^}]*position:\s*fixed;[^}]*pointer-events:\s*none/);
  assert.match(css, /\.auth-cinematic\s*\.auth-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(340px,\s*440px\)/);
  assert.match(css, /\.auth-cinematic\s*\.auth-panel\s*\{[^}]*background:\s*#fffffff2/);
  assert.match(css, /\[data-theme="dark"\]\s*\.auth-page\.auth-cinematic\s*\.auth-panel\s*\{[^}]*background:\s*#221e30f5/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.auth-message\s*\{\s*display:\s*none/);
  assert.match(css, /\.auth-cinematic\s*\.auth-backdrop__toggle\s*\{[^}]*z-index:\s*4/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("login header contains only the clickable brand and forms never create nested scrolling", () => {
  const header = gate.slice(gate.indexOf('<header className="auth-header">'), gate.indexOf('</header>'));
  assert.match(header, /<Link\s*href="\/"\s*className="auth-brand"/);
  assert.doesNotMatch(header, /<button|LanguageSelector|auth-header-actions|auth-back/);
  assert.match(css, /\.auth-panel\s*\{[^}]*height:\s*auto;\s*max-height:\s*none;\s*overflow:\s*visible/);
  assert.match(css, /\.auth-panel\s*:is\(form,\s*\.auth-fields,\s*\.auth-verification-pending\)\s*\{\s*height:\s*auto;\s*max-height:\s*none;\s*overflow:\s*visible/);
  assert.doesNotMatch(css, /scrollbar-width:\s*none|::-webkit-scrollbar/);
  assert.match(gate, /submitPending.current/);
  assert.match(gate, /isEmailVerificationRequired\(session\)/);
  assert.match(gate, /ageAtLeast14/);
});


test("cinematic selectors outrank the base auth stylesheet regardless of chunk order", () => {
  assert.match(css, /\.auth-page\.auth-cinematic\s*\.auth-layout\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/);
  assert.match(css, /\.auth-page\.auth-cinematic\s*\.auth-panel\s*\{/);
  assert.doesNotMatch(css, /(^|\n)\.auth-cinematic(?:\s|\.)/);
});

test("the quiet bottom-left motion control retains a 44px touch target and visible keyboard focus", () => {
  const control = css.match(/\.auth-page\.auth-cinematic\s*\.auth-backdrop__toggle\s*\{([^}]+)\}/)?.[1];
  assert.ok(control);
  for (const declaration of [/position:\s*fixed/, /left:/, /bottom:/, /min-width:\s*44px/, /min-height:\s*44px/, /justify-content:\s*center/]) {
    assert.match(control, declaration);
  }
  assert.match(css, /\.auth-backdrop__toggle:focus-visible\s*\{[^}]*outline:/);
});

test("the existing localized footer and notices link remain after the form in document order", () => {
  assert.equal((gate.match(/className="auth-footer"/g) ?? []).length, 1);
  assert.match(gate, /<\/section>\s*<\/div>\s*<p\s*className="auth-footer">\s*\{t\("내\s*일을\s*더\s*선명하게\.\s*Freelance\s*Ops"\)\}\s*·\s*<Link\s*href="\/notices">\s*\{t\("운영\s*공지"\)\}\s*<\/Link>\s*<\/p>\s*<\/main>/);
});

test("the footer uses a centered flow layout with symmetric control clearance and safe-area padding", () => {
  const root = css.match(/\.auth-page\.auth-cinematic\s*\{([^}]+)\}/)?.[1];
  const header = css.match(/\.auth-page\.auth-cinematic\s*\.auth-header\s*\{([^}]+)\}/)?.[1];
  const layout = css.match(/\.auth-page\.auth-cinematic\s*\.auth-layout\s*\{([^}]+)\}/)?.[1];
  const footerRules = [...css.matchAll(/\.auth-page\.auth-cinematic\s*\.auth-footer\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.ok(root && header && layout && footerRules.length);
  assert.match(root, /display:\s*flex/);
  assert.match(root, /flex-direction:\s*column/);
  assert.match(root, /min-height:\s*100svh/);
  assert.match(root, /padding:[^;]*env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(root, /(?:^|;)\s*(?:height:\s*100(?:s|d)?vh|overflow(?:-y)?:\s*(?:hidden|clip))/);
  assert.match(header, /width:\s*100%/);
  assert.match(header, /margin:\s*0\s*auto/);
  assert.match(layout, /flex:\s*1\s*0\s*auto/);
  assert.match(layout, /width:\s*100%/);
  assert.match(footerRules[0], /text-align:\s*center/);
  assert.match(footerRules[0], /margin:\s*\S+\s*auto\s*0/);
  assert.match(footerRules[0], /max-width:\s*calc\(100%\s*-\s*112px\)/);
  for (const footer of footerRules) {
    assert.doesNotMatch(footer, /position:\s*(?:fixed|absolute)|text-align:\s*(?:left|right|end)|padding-(?:left|right):/);
  }
});

test("narrow screens dock the motion control beside the document footer instead of over fields", () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.auth-backdrop__toggle\s*\{\s*position:\s*absolute;[^}]*safe-area-inset-left[^}]*safe-area-inset-bottom/);
});
