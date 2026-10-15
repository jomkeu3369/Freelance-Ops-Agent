import type { Provider, RecordedProvider } from "./contracts/agents";
import type { AuthSession, EmailVerificationRequired, MeProfile, RegistrationResult } from "./contracts/auth";
import { FREE_USAGE_EXHAUSTED } from "../free-usage.mjs";
import { clearQueryCache, queryCached } from "../query-cache";

export function isSupportedProvider(provider: RecordedProvider): provider is Provider {
  return provider === "OPENAI";
}

export function isEmailVerificationRequired(result: RegistrationResult): result is EmailVerificationRequired {
  return result.tokenType === "EmailVerificationRequired";
}

const SESSION_KEY = "freelance-ops-session-v1";

const SESSION_RECOVERY_EVENT = "freelance-ops-session-recovery";

let refreshPromise: Promise<AuthSession> | null = null;

let sessionGeneration = 0;

const sessionAccessTokens = new Set<string>();

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly metadata: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isFreeUsageExhausted(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === FREE_USAGE_EXHAUSTED;
}

const FREE_USAGE_EVENT = "freelance-ops-free-usage-exhausted";

export function subscribeToFreeUsageExhausted(listener: (error: ApiError) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ApiError>).detail);
  window.addEventListener(FREE_USAGE_EVENT, handler);
  return () => window.removeEventListener(FREE_USAGE_EVENT, handler);
}

export function isCreditQuoteRefreshRequired(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    ["CREDIT_QUOTE_REQUIRED", "CREDIT_QUOTE_STALE", "PLATFORM_MODEL_UNAVAILABLE"].includes(error.code ?? "")
  );
}

export function isPlatformSpendUnavailable(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && ["PLATFORM_SPEND_EXHAUSTED", "PLATFORM_SPEND_DISABLED"].includes(error.code ?? "")
  );
}

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080").trim().replace(/\/$/, "");
}

export function loadSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    window.sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  const current = loadSession();
  if (!current || current.userId !== session.userId || current.refreshToken !== session.refreshToken) {
    sessionGeneration += 1;
    sessionAccessTokens.clear();
    refreshPromise = null;
    clearQueryCache();
  }
  sessionAccessTokens.add(session.accessToken);
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionGeneration += 1;
  sessionAccessTokens.clear();
  refreshPromise = null;
  window.sessionStorage.removeItem(SESSION_KEY);
  clearQueryCache();
  window.dispatchEvent(new Event("freelance-ops-session-cleared"));
}

export function subscribeToSessionRecovery(listener: (session: AuthSession | null) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AuthSession | null>).detail);
  window.addEventListener(SESSION_RECOVERY_EVENT, handler);
  return () => window.removeEventListener(SESSION_RECOVERY_EVENT, handler);
}

function publishRecoveredSession(session: AuthSession | null): void {
  window.dispatchEvent(new CustomEvent<AuthSession | null>(SESSION_RECOVERY_EVENT, { detail: session }));
}

// 로그인·로그아웃 시 이전 요청을 무효화한다. 토큰 갱신은 같은 세션으로 취급한다.
export function currentSessionGeneration(): number {
  return sessionGeneration;
}

function sessionChangedError(): ApiError {
  return new ApiError("로그인 세션이 변경되었습니다. 다시 시도해 주세요.", 409, "SESSION_CHANGED");
}

async function rotateSession(session: AuthSession): Promise<AuthSession> {
  const generation = sessionGeneration;
  const matchesCurrent = () => {
    const current = loadSession();
    return (
      generation === sessionGeneration &&
      current?.userId === session.userId &&
      current.refreshToken === session.refreshToken
    );
  };
  if (!matchesCurrent()) throw sessionChangedError();
  if (refreshPromise) return refreshPromise;
  const pending = request<AuthSession>(
    "/api/v2/auth/refresh",
    { method: "POST", body: JSON.stringify({ refreshToken: session.refreshToken }) },
    undefined,
    false
  )
    .then((nextSession) => {
      if (!matchesCurrent()) throw sessionChangedError();
      const preservedSession = { ...nextSession, workspaceId: loadSession()!.workspaceId };
      // 같은 로그인에서 늦게 도착한 401 응답도 갱신된 토큰으로 복구할 수 있게 세대를 유지한다.
      sessionAccessTokens.add(session.accessToken);
      sessionAccessTokens.add(preservedSession.accessToken);
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(preservedSession));
      publishRecoveredSession(preservedSession);
      return preservedSession;
    })
    .catch((error) => {
      // 통신 장애, 요청 제한, 서버 오류만으로 로그인 만료를 판단하지 않는다.
      if (matchesCurrent() && error instanceof ApiError && [401, 403].includes(error.status)) {
        clearSession();
        publishRecoveredSession(null);
      }
      throw error;
    })
    .finally(() => {
      if (refreshPromise === pending) refreshPromise = null;
    });
  refreshPromise = pending;
  return pending;
}

async function recoverSession(failedToken: string, generation: number): Promise<AuthSession | null> {
  if (generation !== sessionGeneration) return null;
  const current = loadSession();
  if (!current) return null;
  if (current.accessToken !== failedToken) return current;
  if (new Date(current.refreshTokenExpiresAt).getTime() <= Date.now()) {
    clearSession();
    publishRecoveredSession(null);
    return null;
  }
  return rotateSession(current);
}

export async function request<T>(path: string, init: RequestInit = {}, token?: string, allowSessionRecovery = true): Promise<T> {
  const generation = sessionGeneration;
  const recoveryAllowed = token && (loadSession()?.accessToken === token || sessionAccessTokens.has(token));
  if (token && typeof window !== "undefined" && !recoveryAllowed) throw sessionChangedError();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.", 0);
  }
  if (token && generation !== sessionGeneration) throw sessionChangedError();
  if (response.status === 401 && token && allowSessionRecovery && recoveryAllowed) {
    const recovered = await recoverSession(token, generation);
    if (generation !== sessionGeneration) throw sessionChangedError();
    if (recovered) return request<T>(path, init, recovered.accessToken, false);
  }
  if (!response.ok) {
    let message = `요청을 완료하지 못했습니다. (${response.status})`;
    let metadata: Record<string, unknown> = {};
    try {
      const problem: unknown = await response.json();
      if (problem && typeof problem === "object" && !Array.isArray(problem)) {
        metadata = problem as Record<string, unknown>;
        const publicMessage = metadata.detail ?? metadata.message ?? metadata.title;
        if (typeof publicMessage === "string") message = publicMessage;
      }
    } catch {
      // 서버 내부 정보 대신 사용자에게 공개 가능한 기본 메시지를 유지한다.
    }
    const error = new ApiError(
      message,
      response.status,
      typeof metadata.code === "string" ? metadata.code : null,
      metadata
    );
    if (isFreeUsageExhausted(error) && typeof window !== "undefined" && loadSession()?.accessToken === token) {
      window.dispatchEvent(new CustomEvent<ApiError>(FREE_USAGE_EVENT, { detail: error }));
    }
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as T;
  if (token && generation !== sessionGeneration) throw sessionChangedError();
  return result;
}

export function register(input: { email: string; password: string; displayName: string; workspaceName: string; ageAtLeast14: boolean; }): Promise<RegistrationResult> {
  return request("/api/v2/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function requestEmailVerification(email: string): Promise<{ status: "IF_ELIGIBLE_CHECK_EMAIL" }> {
  return request(
    "/api/v2/auth/email-verification/request",
    { method: "POST", body: JSON.stringify({ email }), cache: "no-store" },
    undefined,
    false
  );
}

export function confirmEmailVerification(token: string, password: string): Promise<{ status: "VERIFIED" }> {
  return request(
    "/api/v2/auth/email-verification/confirm",
    { method: "POST", body: JSON.stringify({ token, password }), cache: "no-store" },
    undefined,
    false
  );
}

export function login(email: string, password: string): Promise<AuthSession> {
  return request("/api/v2/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function refreshAuthSession(session: AuthSession): Promise<AuthSession> {
  const current = loadSession();
  if (!current || current.userId !== session.userId) return Promise.reject(sessionChangedError());
  if (current.accessToken !== session.accessToken) return Promise.resolve(current);
  return rotateSession(current);
}

export function revokeAuthSession(session: AuthSession): Promise<void> {
  return request("/api/v2/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken: session.refreshToken })
  });
}

export function getMe(session: AuthSession): Promise<MeProfile> {
  return queryCached(`me:${session.userId}`, () => request("/api/v2/me", {}, session.accessToken));
}
