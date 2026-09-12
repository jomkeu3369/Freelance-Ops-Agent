import { AuthSession, login, register } from "../../../app/lib/api";
import { useState, useSyncExternalStore, KeyboardEvent as ReactKeyboardEvent, FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";
import { ArrowLeft, EyeSlash, Eye, CircleNotch, ArrowRight, Moon, Sun, ShieldCheck } from "@phosphor-icons/react";
import { PetArt } from "../pets/pet-art";
import { petAdvisors } from "../pets/pet-state.mjs";

const subscribeToHydration = () => () => undefined;

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
  const themeMounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = themeMounted && resolvedTheme === "dark";

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
      <header className="auth-header">
        <Link href="/" className="auth-brand" aria-label="Freelance Ops 홈">
          <Image src="/figma/logo.svg" alt="" width={32} height={32} />
          <span>Freelance Ops</span>
        </Link>
        <div className="auth-header-actions">
          <Link href="/" className="auth-back"><ArrowLeft size={16} /> 제품 소개</Link>
          <button className="auth-theme-toggle" type="button" onClick={() => setTheme(isDark ? "light" : "dark")} aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}>
            {isDark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      <div className="auth-layout">
      <section className="auth-message" aria-labelledby="auth-welcome-title">
        <span className="auth-eyebrow">문의에서 견적까지, 함께</span>
        <h2 id="auth-welcome-title">혼자 하는 일에,<br/><span>함께할 동료를.</span></h2>
        <p>흩어진 고객 문의를 정리하고,<br/>근거 있는 견적으로 이어가세요.</p>
        <div className="auth-companions" aria-label="AI 동료의 기본 모습과 관점">
          {petAdvisors.map(pet => <div className="auth-companion" key={pet.id}><PetArt kind={pet.id} /><strong>{pet.name}</strong><span>{pet.role}</span></div>)}
        </div>
        <div className="auth-message-footer"><span>다른 관점을 모아, 내게 맞는 선택으로.</span><p>AI가 초안을 준비하고, 최종 결정은 내가 합니다.</p></div>
      </section>
      <section className="auth-panel">
        <div className="auth-intro"><span>나의 업무 공간</span><h1>{mode === "login" ? "다시 만나 반가워요." : "함께할 준비가 됐나요?"}</h1><p>{mode === "login" ? "작은 동료들과 하던 일을 이어가세요." : "계정을 만들고 첫 고객 문의를 정리해 보세요."}</p></div>
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
                  <input name="displayName" required maxLength={100} autoComplete="name" placeholder="어떻게 불러드릴까요?" />
                </label>
                <label>
                  업무 공간 이름
                  <input name="workspaceName" required maxLength={120} placeholder="예: 나의 디자인 스튜디오" />
                </label>
              </>
            )}
            <label>
              이메일
              <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
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
                  placeholder={mode === "login" ? "비밀번호를 입력해 주세요" : "12~72자로 입력해 주세요"}
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
              {busy ? "업무 공간을 준비하고 있어요…" : mode === "login" ? "업무 공간 열기" : "업무 공간 만들기"}
              {busy ? <CircleNotch size={19} className="spin" /> : <ArrowRight size={19} />}
            </button>
          </fieldset>
        </form>
        <small className="auth-assurance"><ShieldCheck size={17} aria-hidden="true"/> AI 결과는 내 검토 후에 확정됩니다.</small>
      </section>
      </div>
      <p className="auth-footer">내 일을 더 선명하게. Freelance Ops</p>
    </main>
  );
}
