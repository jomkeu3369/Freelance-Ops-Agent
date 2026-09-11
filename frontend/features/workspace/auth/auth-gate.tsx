import { AuthSession, login, register } from "../../../app/lib/api";
import { useState, KeyboardEvent as ReactKeyboardEvent, FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, EyeSlash, Eye, CircleNotch, ArrowRight } from "@phosphor-icons/react";

export type AuthMode = "login" | "register";

interface AuthGateProps {
  onAuthenticated: (session: AuthSession, isNewWorkspace?: boolean) => Promise<void>;
  error: string | null;
  setError: (message: string | null) => void;
}

export function AuthGate({ onAuthenticated, error, setError }: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const selectMode = (nextMode: AuthMode) => {
    if (busy) return;
    setMode(nextMode);
    setShowPassword(false);
    setError(null);
  };

  const handleTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!(["ArrowLeft", "ArrowRight", "Home", "End"] as string[]).includes(event.key)) return;
    event.preventDefault();
    const nextMode: AuthMode = event.key === "ArrowLeft" || event.key === "Home" ? "login" : "register";
    selectMode(nextMode);
    document.getElementById(`auth-tab-${nextMode}`)?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    if (mode === "register" && password !== String(data.get("passwordConfirm"))) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      (event.currentTarget.elements.namedItem("passwordConfirm") as HTMLInputElement | null)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session =
        mode === "login"
          ? await login(String(data.get("email")), password)
          : await register({
              email: String(data.get("email")),
              password,
              displayName: String(data.get("displayName")),
              workspaceName: String(data.get("workspaceName"))
            });
      await onAuthenticated(session, mode === "register");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "인증 요청을 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main-content" className="auth-page">
      <Link href="/" className="auth-back">
        <ArrowLeft size={18} /> 제품 소개로 돌아가기
      </Link>
      <section className="auth-message">
        <span>Freelance Ops</span>
        <h1>
          모호한 문의를
          <br />
          검토 가능한 작업으로.
        </h1>
        <p>로그인하면 문의 등록부터 AI 분석, 견적 작성과 결과 확인까지 한곳에서 이어갈 수 있습니다.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-tabs" role="tablist" aria-label="인증 방식">
          <button
            id="auth-tab-login"
            type="button"
            role="tab"
            aria-controls="auth-panel-login"
            aria-selected={mode === "login"}
            tabIndex={mode === "login" ? 0 : -1}
            disabled={busy}
            onKeyDown={handleTabKey}
            onClick={() => selectMode("login")}
          >
            로그인
          </button>
          <button
            id="auth-tab-register"
            type="button"
            role="tab"
            aria-controls="auth-panel-register"
            aria-selected={mode === "register"}
            tabIndex={mode === "register" ? 0 : -1}
            disabled={busy}
            onKeyDown={handleTabKey}
            onClick={() => selectMode("register")}
          >
            처음 시작하기
          </button>
        </div>
        <form
          id={`auth-panel-${mode}`}
          role="tabpanel"
          aria-labelledby={`auth-tab-${mode}`}
          aria-busy={busy}
          onSubmit={submit}
        >
          <fieldset className="auth-fields" disabled={busy}>
            {mode === "register" && (
              <>
                <label>
                  표시 이름
                  <input name="displayName" required maxLength={100} autoComplete="name" />
                </label>
                <label>
                  Workspace 이름
                  <input name="workspaceName" required maxLength={120} />
                </label>
              </>
            )}
            <label>
              이메일
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <div className="auth-field">
              <label htmlFor="auth-password">비밀번호</label>
              <div className="password-field">
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  aria-describedby={mode === "register" ? "auth-password-hint" : undefined}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {mode === "register" && <small id="auth-password-hint">12~72자로 입력하세요.</small>}
            </div>
            {mode === "register" && (
              <div className="auth-field">
                <label htmlFor="auth-password-confirm">비밀번호 확인</label>
                <input
                  id="auth-password-confirm"
                  name="passwordConfirm"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete="new-password"
                />
              </div>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button auth-submit" type="submit">
              {busy ? <CircleNotch size={19} className="spin" /> : <ArrowRight size={19} />}
              {mode === "login" ? "업무 공간 열기" : "Workspace 만들기"}
            </button>
          </fieldset>
        </form>
        <small>AI 결과는 사용자가 검토하기 전까지 확정되지 않습니다.</small>
      </section>
    </main>
  );
}
