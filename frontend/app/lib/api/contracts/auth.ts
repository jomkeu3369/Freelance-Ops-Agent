export interface AuthSession {
  userId: string;
  workspaceId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: string;
}

// 이메일 인증을 기다리는 가입 정보에는 로그인 권한이 없다.
export interface EmailVerificationRequired {
  userId: null;
  workspaceId: null;
  accessToken: null;
  accessTokenExpiresAt: null;
  refreshToken: null;
  refreshTokenExpiresAt: null;
  tokenType: "EmailVerificationRequired";
}

export type RegistrationResult = AuthSession | EmailVerificationRequired;

export interface MeProfile {
  id: string;
  email: string;
  displayName: string;
  status: string;
  workspaces: Array<{
    workspaceId: string;
    name: string;
    slug: string;
    effectivePermissions: string[];
  }>;
}
