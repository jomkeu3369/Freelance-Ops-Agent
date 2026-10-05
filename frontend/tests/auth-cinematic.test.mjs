import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const [gate, css, media] = await Promise.all([
  read("features/workspace/auth/auth-gate.tsx"), read("features/workspace/auth/auth-cinematic.css"),
  read("features/workspace/auth/login-media.ts")
]);

test("login wires inspected same-origin motion, matching loading poster and the original approved still", () => {
  const backdrop = gate.match(/<AuthBackdrop\b[\s\S]*?>/)?.[0];
  assert.ok(backdrop);
  for (const property of ["sources", "poster", "staticPoster"]) {
    assert.ok(backdrop.includes(`${property}={loginMedia.${property}}`), `${property} is passed to AuthBackdrop`);
  }
  assert.match(gate, /className="auth-ambient-fallback"/);
  assert.match(media, /sources: \[{ src: "\/login\/pet-path-motion-v1\.mp4", type: "video\/mp4" }\]/);
  assert.doesNotMatch(media, /https?:\/\//);
  assert.match(media, /poster: "\/login\/pet-path-motion-poster-v1\.webp"/);
  assert.match(media, /staticPoster: "\/login\/pet-path-poster-v1\.webp"/);
  assert.doesNotMatch(gate, /PetLoginDemo/);
});

test("cinematic composition replaces the previous illustration without changing auth contracts", () => {
  assert.match(gate, /className="auth-scene-space"/);
  assert.doesNotMatch(gate, /PetArt|petAdvisors|auth-companions|auth-message-footer/);
  assert.match(gate, /import \{ AuthSession, login, register \} from "\.\.\/\.\.\/\.\.\/app\/lib\/api"/);
  assert.match(gate, /await onAuthenticated\(session, mode === "register"\)/);
  assert.doesNotMatch(gate, /isEmailVerificationRequired|verifyEmail|resendVerification|useLocale|useTranslation|ui-locale|href="\/notices"/);
});

test("scene is full bleed, right form retains its independent contrast surface and mobile priority", () => {
  assert.match(css, /\.auth-cinematic \.auth-backdrop__visual \{[^}]*position: fixed;[^}]*pointer-events: none/);
  assert.match(css, /\.auth-cinematic \.auth-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(340px, 440px\)/);
  assert.match(css, /\.auth-cinematic \.auth-panel \{[^}]*background: #fffffff2/);
  assert.match(css, /\[data-theme="dark"\] \.auth-page\.auth-cinematic \.auth-panel \{[^}]*background: #221e30f5/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.auth-message \{ display: none/);
  assert.match(css, /\.auth-cinematic \.auth-backdrop__toggle \{[^}]*z-index: 4/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("login header contains only the clickable brand and forms never create nested scrolling", () => {
  const header = gate.slice(gate.indexOf('<header className="auth-header">'), gate.indexOf('</header>'));
  assert.match(header, /<Link href="\/" className="auth-brand"/);
  assert.doesNotMatch(header, /<button|LanguageSelector|auth-header-actions|auth-back/);
  assert.match(css, /\.auth-panel \{[^}]*height: auto; max-height: none; overflow: visible/);
  assert.match(css, /\.auth-panel :is\(form, \.auth-fields, \.auth-verification-pending\) \{ height: auto; max-height: none; overflow: visible/);
  assert.doesNotMatch(css, /scrollbar-width:\s*none|::-webkit-scrollbar/);
  assert.match(gate, /if \(busy\) return/);
  assert.match(gate, /ageAtLeast14/);
});


test("cinematic selectors outrank the base auth stylesheet regardless of chunk order", () => {
  assert.match(css, /\.auth-page\.auth-cinematic \.auth-layout \{[^}]*background: transparent;[^}]*box-shadow: none/);
  assert.match(css, /\.auth-page\.auth-cinematic \.auth-panel \{/);
  assert.doesNotMatch(css, /(^|\n)\.auth-cinematic(?:\s|\.)/);
});

test("the quiet bottom-left motion control retains a 44px touch target and visible keyboard focus", () => {
  const control = css.match(/\.auth-page\.auth-cinematic \.auth-backdrop__toggle\s*\{([^}]+)\}/)?.[1];
  assert.ok(control);
  for (const declaration of [/position:\s*fixed/, /left:/, /bottom:/, /min-width:\s*44px/, /min-height:\s*44px/, /justify-content:\s*center/]) {
    assert.match(control, declaration);
  }
  assert.match(css, /\.auth-backdrop__toggle:focus-visible\s*\{[^}]*outline:/);
});

test("the original Korean footer remains after the form with no new destination", () => {
  assert.equal((gate.match(/className="auth-footer"/g) ?? []).length, 1);
  assert.match(gate, /<\/section>\s*<\/div>\s*<p className="auth-footer">내 일을 더 선명하게\. Freelance Ops<\/p>\s*<\/main>/);
});

test("the footer uses a centered flow layout with symmetric control clearance and safe-area padding", () => {
  const root = css.match(/\.auth-page\.auth-cinematic\s*\{([^}]+)\}/)?.[1];
  const header = css.match(/\.auth-page\.auth-cinematic \.auth-header\s*\{([^}]+)\}/)?.[1];
  const layout = css.match(/\.auth-page\.auth-cinematic \.auth-layout\s*\{([^}]+)\}/)?.[1];
  const footerRules = [...css.matchAll(/\.auth-page\.auth-cinematic \.auth-footer\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.ok(root && header && layout && footerRules.length);
  assert.match(root, /display:\s*flex/);
  assert.match(root, /flex-direction:\s*column/);
  assert.match(root, /min-height:\s*100svh/);
  assert.match(root, /padding:[^;]*env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(root, /(?:^|;)\s*(?:height:\s*100(?:s|d)?vh|overflow(?:-y)?:\s*(?:hidden|clip))/);
  assert.match(header, /width:\s*100%/);
  assert.match(header, /margin:\s*0 auto/);
  assert.match(layout, /flex:\s*1 0 auto/);
  assert.match(layout, /width:\s*100%/);
  assert.match(footerRules[0], /text-align:\s*center/);
  assert.match(footerRules[0], /margin:\s*\S+ auto 0/);
  assert.match(footerRules[0], /max-width:\s*calc\(100% - 112px\)/);
  for (const footer of footerRules) {
    assert.doesNotMatch(footer, /position:\s*(?:fixed|absolute)|text-align:\s*(?:left|right|end)|padding-(?:left|right):/);
  }
});

test("narrow screens dock the motion control beside the document footer instead of over fields", () => {
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.auth-backdrop__toggle\s*\{\s*position:\s*absolute;[^}]*safe-area-inset-left[^}]*safe-area-inset-bottom/);
});
