import { useCallback, useEffect, useRef, useState } from "react";
import { acceptPetConversationDraft, getPetConversation, listAgentPets, updatePetConversation,
  type AuthSession, type CustomAgentPet, type PetConversationSettings, type PetConversationView } from "../../../app/lib/api";
import { subscribeToPetLibrary } from "./pet-library-events";
import { petConversationError } from "./pet-conversation-error";

export function usePetConversation(session: AuthSession, projectId: string, enabled: boolean) {
  const [view, setView] = useState<PetConversationView | null>(null);
  const [pets, setPets] = useState<CustomAgentPet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const owner = `${session.userId}:${session.workspaceId}:${projectId}`;
  const latest = useRef(owner);
  useEffect(() => subscribeToPetLibrary(session, () => setRevision(value => value + 1)), [session]);
  useEffect(() => {
    if (!enabled) return;
    const online = () => setRevision(value => value + 1);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [enabled]);
  useEffect(() => { latest.current = owner; return () => { latest.current = ""; }; }, [owner]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) { setLoading(true); setView(null); setError(null); } });
    Promise.all([getPetConversation(session, projectId), listAgentPets(session)]).then(([next, collection]) => {
      if (cancelled) return;
      if (!next?.settings || !Array.isArray(next.settings.participantPetIds) || !Array.isArray(collection?.pets)) throw new Error("대화 설정을 확인하지 못했습니다.");
      setView(next); setPets(collection.pets.filter(pet => !pet.archived)); setError(null);
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "대화 설정을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session, projectId, enabled, revision]);

  async function mutate(work: () => Promise<PetConversationView>) {
    if (pending.current) return false;
    pending.current = true; setSaving(true); setError(null);
    try {
      const next = await work();
      if (latest.current !== owner) return false;
      setView(next);
      if (!next.settings.petMode || !next.settings.participantPetIds.includes(recipient)) setRecipient("");
      return true;
    } catch (cause) {
      if (latest.current === owner) setError(petConversationError(cause) ?? (cause instanceof Error ? cause.message : "대화 설정을 저장하지 못했습니다."));
      return false;
    } finally { pending.current = false; if (latest.current === owner) setSaving(false); }
  }
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return { view, pets, loading, saving, error, recipient, setRecipient, refresh,
    save: (patch: Partial<Pick<PetConversationSettings,"petMode"|"debateEnabled"|"participantPetIds">>, before: () => Promise<void>) =>
      view ? mutate(async () => { await before(); return updatePetConversation(session, projectId, view, patch); }) : Promise.resolve(false),
    accept: (runId: string) => view ? mutate(() => acceptPetConversationDraft(session, projectId, runId, view.version)) : Promise.resolve(false)
  };
}

export type PetConversationState = ReturnType<typeof usePetConversation>;
