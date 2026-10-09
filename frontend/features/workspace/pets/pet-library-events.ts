import { loadSession, type AgentPetCollection, type AuthSession } from "@/app/lib/api";

const eventName = "freelance-ops-pet-library";
// An ephemeral ordering token, not a cache of profiles or account data.
let revision = 0;
export function petLibraryRevision() { return revision; }
type PetLibraryUpdate = { userId: string; workspaceId: string; collection: AgentPetCollection | null };

/** Publish only confirmed library state; null invalidates an accepted mutation's old snapshot. */
export function publishPetLibrary(session: AuthSession, collection: AgentPetCollection | null, expectedRevision?: number) {
  const current = loadSession();
  if (current?.userId !== session.userId || current.workspaceId !== session.workspaceId) return;
  if (collection === null) revision += 1;
  else if (expectedRevision !== revision) return;
  window.dispatchEvent(new CustomEvent<PetLibraryUpdate>(eventName, {
    detail: { userId: session.userId, workspaceId: session.workspaceId, collection }
  }));
}

export function subscribeToPetLibrary(session: AuthSession, listener: (collection: AgentPetCollection | null) => void) {
  const handler = (event: Event) => {
    const update = (event as CustomEvent<PetLibraryUpdate>).detail;
    if (update.userId === session.userId && update.workspaceId === session.workspaceId) listener(update.collection);
  };
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}
