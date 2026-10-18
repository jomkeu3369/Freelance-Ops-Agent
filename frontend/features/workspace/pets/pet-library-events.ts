import { loadSession, type AgentPetCollection, type AuthSession } from "@/app/lib/api";

const eventName = "freelance-ops-pet-library";
const mutationEventName = "freelance-ops-pet-mutation";
const pendingMutations = new Set<string>();
const failedMutations = new Set<string>();

function mutationScope(session: AuthSession) {
  return JSON.stringify([session.userId, session.workspaceId]);
}

export function petMutationState(session: AuthSession): "idle" | "pending" | "failed" {
  const key = mutationScope(session);
  return pendingMutations.has(key) ? "pending" : failedMutations.has(key) ? "failed" : "idle";
}

/** 패널이 닫혀도 변경이 확인되기 전에는 이전 펫으로 유료 실행하지 않는다. */
export function beginPetMutation(session: AuthSession) {
  const key = mutationScope(session);
  if (pendingMutations.has(key)) return null;
  pendingMutations.add(key);
  failedMutations.delete(key);
  window.dispatchEvent(new Event(mutationEventName));
  let finished = false;
  return (success: boolean) => {
    if (finished) return;
    finished = true;
    pendingMutations.delete(key);
    if (!success) failedMutations.add(key);
    window.dispatchEvent(new Event(mutationEventName));
  };
}

export function subscribeToPetMutations(listener: () => void) {
  window.addEventListener(mutationEventName, listener);
  return () => window.removeEventListener(mutationEventName, listener);
}
// 처리 순서 확인용 임시 토큰이며 프로필이나 계정 데이터의 캐시가 아니다.
let revision = 0;
export function petLibraryRevision() {
  return revision;
}
type PetLibraryUpdate = { userId: string; workspaceId: string; collection: AgentPetCollection | null };

/** 확인된 목록만 알린다. null은 승인된 변경 뒤 이전 스냅샷을 무효화한다. */
export function publishPetLibrary(session: AuthSession, collection: AgentPetCollection | null, expectedRevision?: number) {
  const current = loadSession();
  if (current?.userId !== session.userId || current.workspaceId !== session.workspaceId) return;
  if (collection === null) revision += 1;
  else if (expectedRevision !== revision) return;
  window.dispatchEvent(
    new CustomEvent<PetLibraryUpdate>(eventName, {
      detail: { userId: session.userId, workspaceId: session.workspaceId, collection }
    })
  );
}

export function subscribeToPetLibrary(session: AuthSession, listener: (collection: AgentPetCollection | null) => void) {
  const handler = (event: Event) => {
    const update = (event as CustomEvent<PetLibraryUpdate>).detail;
    if (update.userId === session.userId && update.workspaceId === session.workspaceId) listener(update.collection);
  };
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}
