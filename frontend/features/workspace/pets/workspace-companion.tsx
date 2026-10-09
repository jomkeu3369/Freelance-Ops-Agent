import { useEffect, useState } from "react";
import { listAgentPets, type AgentPetCollection, type AuthSession } from "@/app/lib/api";
import { useT } from "@/app/lib/ui-language";
import { loginMedia } from "../auth/login-media";
import { PetArt } from "./pet-art";
import { subscribeToPetLibrary } from "./pet-library-events";

/** A quiet, read-only companion in the persistent header, never an execution selection. */
export function WorkspaceCompanion({ session, canReadPets }: { session: AuthSession; canReadPets: boolean }) {
  const t = useT();
  const [collection, setCollection] = useState<AgentPetCollection | null>(null);

  useEffect(() => {
    if (!canReadPets) return;
    let active = true;
    let version = 0;
    const refresh = () => {
      const requestVersion = ++version;
      void listAgentPets(session).then(value => {
        if (active && requestVersion === version) setCollection(value);
      }).catch(() => {
        // The login friend remains available offline, without blocking any workspace task.
        if (active && requestVersion === version) setCollection(null);
      });
    };
    const unsubscribe = subscribeToPetLibrary(session, value => {
      version += 1;
      setCollection(value);
    });
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session, canReadPets]);

  const selected = canReadPets && Array.isArray(collection?.pets) ? collection.pets.find(pet => pet.id === collection.selectedPetId && !pet.archived) : null;
  // Never substitute an unselected library pet or an immutable past-run profile.
  const label = selected ? t("함께하는 동료: {name}", { name: selected.profile.name }) : t("로그인에서 함께 온 친구");
  return <div className="workspace-companion" role="img" aria-label={label} title={label} data-companion={selected ? "selected" : "login"}>
    <span className="workspace-companion-portrait" aria-hidden="true">
      {selected ? <PetArt kind={selected.profile.animal} profile={selected.profile} /> :
        <svg className="workspace-login-pet" viewBox="510 330 370 370" aria-hidden="true" focusable="false">
          <image href={loginMedia.staticPoster} width="1600" height="900" />
        </svg>}
    </span>
    <span className="workspace-companion-caption" aria-hidden="true"><small>{t("늘 함께하는 작은 동료")}</small><strong>{selected ? selected.profile.name : t("오늘도 함께해요")}</strong></span>
  </div>;
}
