import { AuthSession, request } from "./api";

export interface AdminMember {
  id: string; email: string; displayName: string | null; status: string;
  emailVerificationRequired: boolean; emailVerifiedAt: string | null;
  joinedAt: string; lastLoginAt: string | null;
}
export interface AdminPage<T> { items: T[]; total: number; page: number; size: number; recordingStartedAt: string | null }
export interface MemberSummary { totalMembers: number; activeMembers: number; pendingVerification: number; joinedLast7Days: number; signedInLast7Days: number; recordingStartedAt: string }
export interface LoginEvent { id: string; userId: string; method: string; occurredAt: string }
export interface AdminAudit { id: string; source: string; actorUserId: string; action: string; target: string; previousValue: string; newValue: string; previousEpoch: number; newEpoch: number; createdAt: string }

function read<T>(session: AuthSession, path: string, signal?: AbortSignal): Promise<T> {
  return request(`/api/v2/admin/${path}`, { signal, cache: "no-store" }, session.accessToken);
}
export function getMembers(session: AuthSession, q: string, status: string, page: number, signal?: AbortSignal) {
  return read<AdminPage<AdminMember>>(session, `members?${new URLSearchParams({ q, status, page: String(page), size: "25" })}`, signal);
}
export function getMemberSummary(session: AuthSession, signal?: AbortSignal) { return read<MemberSummary>(session, "members/summary", signal); }
export function getLoginEvents(session: AuthSession, userId: string, page: number, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: String(page), size: "25" });
  if (userId) params.set("userId", userId);
  return read<AdminPage<LoginEvent>>(session, `login-events?${params}`, signal);
}
export function getMemberAudits(session: AuthSession, page: number, signal?: AbortSignal) {
  return read<AdminPage<AdminAudit>>(session, `member-audit-events?page=${page}&size=25`, signal);
}
