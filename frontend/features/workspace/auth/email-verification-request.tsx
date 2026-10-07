"use client";

import { FormEvent, useRef, useState } from "react";
import { ApiError, requestEmailVerification } from "../../../app/lib/api";
import { useT } from "../../../app/lib/ui-language";

export function EmailVerificationRequest({ initialEmail = "" }: { initialEmail?: string }) {
  const t = useT();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(null); setMessage(null);
    try {
      await requestEmailVerification(email.trim());
      setMessage("가입할 수 있는 이메일 주소라면 확인 링크를 보냈습니다. 이메일을 확인해 주세요.");
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 503
        ? "현재 이메일 발송을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
        : "확인 링크 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally { pending.current = false; setBusy(false); }
  }

  return <form className="verification-request" onSubmit={submit} aria-busy={busy}>
    <label>{t("확인 링크를 받을 이메일")}<input name="verificationEmail" type="email" required autoComplete="email" maxLength={254} disabled={busy} value={email} onChange={event => setEmail(event.target.value)} /></label>
    <button type="submit" className="secondary-button" disabled={busy}>{busy ? t("요청 중…") : t("확인 링크 다시 요청")}</button>
    {error && <p role="alert" className="form-error">{t(error)}</p>}
    {message && <p role="status">{t(message)}</p>}
  </form>;
}
