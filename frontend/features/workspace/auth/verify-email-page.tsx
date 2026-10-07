"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, confirmEmailVerification } from "../../../app/lib/api";
import { verificationPasswordError, verificationTokenFromFragment } from "../../../app/lib/email-verification.mjs";
import { LanguageSelector, useT } from "../../../app/lib/ui-language";
import { EmailVerificationRequest } from "./email-verification-request";
import "./auth.css";
import "../../notices/notices.css";

export function VerifyEmailPage() {
  const t = useT();
  const router = useRouter();
  const token = useRef<string | null>(null);
  const captured = useRef(false);
  const pending = useRef(false);
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Capture once even under Strict Mode. Link scanners/page loads never submit it.
    if (!captured.current) {
      captured.current = true;
      token.current = verificationTokenFromFragment(window.location.hash);
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    const available = token.current !== null;
    Promise.resolve().then(() => { setHasToken(available); setReady(true); });
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !token.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get("password") ?? "");
    const passwordError = verificationPasswordError(password, String(fields.get("passwordConfirm")));
    if (passwordError === "MISMATCH") {
      setError("12~72자의 비밀번호를 입력하고 동일하게 확인해 주세요.");
      (form.elements.namedItem("passwordConfirm") as HTMLInputElement | null)?.focus();
      return;
    }
    if (passwordError === "UTF8_LENGTH") {
      setError("비밀번호는 UTF-8 기준 72바이트 이하여야 합니다. 한글 등은 한 글자가 여러 바이트일 수 있습니다.");
      (form.elements.namedItem("password") as HTMLInputElement | null)?.focus();
      return;
    }
    pending.current = true;
    const submittedToken = token.current;
    token.current = null;
    form.reset();
    setHasToken(false); setBusy(true); setError(null);
    window.history.replaceState(window.history.state, "", window.location.pathname);
    try {
      const result = await confirmEmailVerification(submittedToken, password);
      if (result.status !== "VERIFIED") throw new Error("Unexpected verification result");
      router.replace("/workspace/projects?emailVerified=1");
    } catch (cause) {
      // Only the documented validation rejection is safe to retry with this token.
      if (cause instanceof ApiError && cause.status === 400 && cause.code === "INVALID_VERIFICATION_PASSWORD") {
        token.current = submittedToken;
        setHasToken(true);
        setError("비밀번호는 UTF-8 기준 72바이트 이하여야 합니다. 한글 등은 한 글자가 여러 바이트일 수 있습니다.");
      } else {
        // Do not display server details or replay an uncertain verification outcome.
        setError("확인 링크가 유효하지 않거나 결과를 확인하지 못했습니다. 로그인하거나 새 링크를 요청해 주세요.");
      }
      setBusy(false);
    } finally { pending.current = false; }
  }

  return <main id="main-content" className="notice-page verification-page">
    <header className="notice-header"><Link href="/">Freelance Ops</Link><LanguageSelector /></header>
    <section className="notice-card" aria-labelledby="verify-title" aria-busy={busy}>
      <h1 id="verify-title">{t("이메일 소유 확인")}</h1>
      <p>{t("아래 버튼을 눌러 이메일 소유를 확인하세요. 페이지를 여는 것만으로 확인되지 않습니다.")}</p>
      {!ready ? <p role="status">{t("확인 링크 준비 중…")}</p> : <>
        {!hasToken && !busy && !error && <p role="status">{t("확인 링크가 없습니다. 이메일의 링크를 다시 열거나 새 링크를 요청해 주세요.")}</p>}
        <form className="notice-form" onSubmit={verify} aria-busy={busy}>
          <p id="verification-password-help">{t("새로 가입하는 경우 여기서 비밀번호를 설정합니다. 기존 계정의 비밀번호는 변경되지 않습니다.")}</p>
          <fieldset disabled={!hasToken || busy}>
            <label>{t("비밀번호")}<input name="password" type="password" required minLength={12} maxLength={72} autoComplete="new-password" aria-describedby="verification-password-help" /></label>
            <label>{t("비밀번호 확인")}<input name="passwordConfirm" type="password" required minLength={12} maxLength={72} autoComplete="new-password" /></label>
            <button type="submit" className="primary-button">{busy ? t("확인 중…") : t("이메일 확인하기")}</button>
          </fieldset>
        </form>
      </>}
      {error && <p className="form-error" role="alert">{t(error)}</p>}
      <hr />
      <EmailVerificationRequest />
      <Link href="/workspace">{t("로그인으로 돌아가기")}</Link>
    </section>
  </main>;
}
