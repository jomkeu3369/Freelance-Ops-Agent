import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verificationPasswordError, verificationTokenFromFragment } from "../app/lib/email-verification.mjs";
import { translateUi } from "../app/lib/ui-locale.mjs";

const token = "a".repeat(43);
test("ownership token parser accepts only one URL-safe fragment token", () => {
  assert.equal(verificationTokenFromFragment(`#token=${token}`), token);
  for (const value of [null, "", `?token=${token}`, `#token=${token}&token=${token}`, "#token=short", `#token=${"a".repeat(32)}`, `#token=${"a".repeat(44)}`, `#token=${"a".repeat(257)}`, "#token=%3Cscript%3E", "#accessToken=" + token]) assert.equal(verificationTokenFromFragment(value), null);
});

test("pending registration returns before authentication and clears password inputs", async () => {
  const auth = await readFile(new URL("../features/workspace/auth/auth-gate.tsx", import.meta.url), "utf8");
  const guard = auth.indexOf("if (isEmailVerificationRequired(session))");
  const authenticated = auth.indexOf("await onAuthenticated(session");
  assert.ok(guard > 0 && guard < authenticated);
  assert.match(auth.slice(guard, authenticated), /form\.reset\(\)/);
  assert.match(auth.slice(guard, authenticated), /setPendingEmail[\s\S]*?return;/);
  assert.match(auth, /submitPending\.current = true/);
  assert.match(auth, /name="ageAtLeast14"[\s\S]*?required/);
});

test("verification mount only captures and clears; explicit click owns submission", async () => {
  const source = await readFile(new URL("../features/workspace/auth/verify-email-page.tsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("useEffect(() =>"), source.indexOf("async function verify("));
  assert.match(effect, /window\.location\.hash/);
  assert.match(effect, /window\.history\.replaceState/);
  assert.doesNotMatch(effect, /confirmEmailVerification\(/);
  assert.match(source, /onSubmit=\{verify\}/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|searchParams|location\.search/);
  assert.match(source, /token\.current = null/);
});

test("legal text and publishing controls remain unavailable for internal metadata", async () => {
  const admin = await readFile(new URL("../features/admin/notice-admin.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/lib/api.ts", import.meta.url), "utf8");
  assert.match(admin, /body: kind === "OPERATIONAL" \?[^\n]* : ""/);
  assert.match(admin, /notice\.kind === "OPERATIONAL" && notice\.status === "REVIEWED"/);
  assert.match(admin, /campaign\.snapshotTitle/);
  assert.match(admin, /campaign\.snapshotVersionLabel/);
  assert.match(admin, /campaign\.recipientCount/);
  assert.doesNotMatch(admin + api, /dispatch-next/);
  assert.match(api, /confirmation: "QUEUE_OPERATIONAL_NOTICE"/);
  assert.match(api, /contentHash: campaign\.contentHash, recipientHash: campaign\.recipientHash, recipientCount: campaign\.recipientCount/);
});

test("verification and disabled mail copy have explicit English translations", () => {
  assert.equal(translateUi("이메일 확인하기", "en"), "Verify email");
  assert.equal(translateUi("메일 전송 기능이 비활성화되어 테스트 메일을 보내지 않았습니다.", "en"), "Email transport is disabled. No test email was sent.");
  assert.equal(translateUi("아직 게시된 운영 공지가 없습니다.", "en"), "There are no published operational notices yet.");
});


test("verification passwords enforce character count, confirmation, and BCrypt UTF-8 byte limit", () => {
  assert.equal(verificationPasswordError("a".repeat(12), "a".repeat(12)), null);
  assert.equal(verificationPasswordError("a".repeat(72), "a".repeat(72)), null);
  assert.equal(verificationPasswordError("a".repeat(73), "a".repeat(73)), "MISMATCH");
  assert.equal(verificationPasswordError("a".repeat(11), "a".repeat(11)), "MISMATCH");
  assert.equal(verificationPasswordError("a".repeat(12), "b".repeat(12)), "MISMATCH");
  assert.equal(verificationPasswordError("가".repeat(24), "가".repeat(24)), null);
  assert.equal(verificationPasswordError("가".repeat(25), "가".repeat(25)), "UTF8_LENGTH");
  assert.equal(verificationPasswordError("🔐".repeat(18), "🔐".repeat(18)), null);
  assert.equal(verificationPasswordError("🔐".repeat(19), "🔐".repeat(19)), "UTF8_LENGTH");
});
