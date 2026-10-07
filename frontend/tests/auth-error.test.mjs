import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authErrorMessage } from "../features/workspace/auth/auth-error.mjs";
import { translateUi } from "../app/lib/ui-locale.mjs";

const credentialMessage = "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.";
const fallback = "인증 요청을 완료하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.";

test("invalid credentials have one generic message independent of account existence", () => {
  for (const error of [
    { code: "INVALID_CREDENTIALS", status: 401, message: "INVALID_CREDENTIALS" },
    { code: "INVALID_CREDENTIALS", message: "Private account detail" },
    new Error("INVALID_CREDENTIALS"),
    { status: 401, code: "USER_NOT_FOUND", message: "Unknown email" },
    { status: 401, code: "ACCOUNT_DISABLED", message: "Disabled account" }
  ]) assert.equal(authErrorMessage(error), credentialMessage);
});

test("network, throttling and unavailable services have distinct safe recovery instructions", () => {
  const cases = [
    [{ status: 0 }, "서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.", "Cannot reach the server. Check your connection and try again."],
    [{ status: 429 }, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", "Too many requests. Please try again later."],
    [{ status: 503, message: "Private stack trace" }, "지금은 인증 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.", "Authentication is temporarily unavailable. Please try again later."],
    [{ status: 401 }, credentialMessage, "Could not log in. Check your email and password."],
    [{ code: "AGE_CONFIRMATION_REQUIRED" }, "만 14세 이상임을 확인해 주세요. 만 14세 미만은 가입할 수 없습니다.", "Confirm that you are at least 14 years old. Anyone under 14 cannot sign up."],
    [{ status: 400 }, fallback, "Could not complete authentication. Check your details and try again."]
  ];
  for (const [error, korean, english] of cases) {
    const message = authErrorMessage(error);
    assert.equal(message, korean);
    assert.equal(translateUi(message, "ko"), korean);
    assert.equal(translateUi(message, "en"), english);
  }
});

test("unknown auth failures never expose a raw code or arbitrary response message", () => {
  for (const error of [undefined, null, "UPSTREAM_FAILURE", new Error("Internal secret"), {},
    { status: 400, code: "NEW_AUTH_CODE", message: "Internal detail" },
    { status: 409, code: "EMAIL_ALREADY_REGISTERED" }]) {
    assert.equal(authErrorMessage(error), fallback);
  }
});

test("auth form keeps a translated announced error and retry/mode-change clearing", async () => {
  const auth = await readFile(new URL("../features/workspace/auth/auth-gate.tsx", import.meta.url), "utf8");
  assert.match(auth, /setError\(authErrorMessage\(cause\)\)/);
  assert.doesNotMatch(auth, /setError\(cause instanceof Error \? cause\.message/);
  assert.match(auth, /aria-describedby=\{error \? "auth-form-error" : undefined\}/);
  assert.match(auth, /<p id="auth-form-error" className="auth-form-error" role="alert" aria-atomic="true">\s*\{t\(error\)\}/);
  assert.match(auth, /const selectMode =[\s\S]*?setError\(null\);/);
  assert.match(auth, /setBusy\(true\);\s*setError\(null\);/);
  assert.match(auth, /if \(submitPending\.current\) return;/);
  assert.match(auth, /\? await login\(String\(data\.get\("email"\)\), password\)/);
});
