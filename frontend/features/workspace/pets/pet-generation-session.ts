import type { AuthSession, ComposeAgentPet } from "@/app/lib/api";

function key(session: AuthSession, projectId: string) {
  return `freelance-ops-pet-generation-v1:${session.workspaceId}:${session.userId}:${projectId}`;
}

export function readPetGeneration(session: AuthSession, projectId: string): ComposeAgentPet | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key(session, projectId)) ?? "null");
    if (
      !value ||
      !/^[0-9a-f-]{36}$/i.test(value.id) ||
      !/^[0-9a-f-]{36}$/i.test(value.mutationId) ||
      typeof value.description !== "string" ||
      value.description.length > 500 ||
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 0 ||
      typeof value.resetPreferences !== "boolean"
    )
      return null;
    return {
      id: value.id,
      mutationId: value.mutationId,
      description: value.description,
      expectedRevision: value.expectedRevision,
      resetPreferences: value.resetPreferences
    };
  } catch {
    return null;
  }
}

export function rememberPetGeneration(session: AuthSession, projectId: string, input: ComposeAgentPet | null) {
  try {
    if (input) window.sessionStorage.setItem(key(session, projectId), JSON.stringify(input));
    else window.sessionStorage.removeItem(key(session, projectId));
  } catch {
    // 저장 공간을 사용할 수 없어도 현재 화면에서 생성과 저장을 계속할 수 있다.
  }
}
