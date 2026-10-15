import { useEffect, useState } from "react";
import { listAgentPets, type AgentPetCollection, type AuthSession } from "@/app/lib/api";
import { useT } from "@/app/lib/ui-language";
import { loginMedia } from "../auth/login-media";
import { PetArt } from "./pet-art";
import { subscribeToPetLibrary } from "./pet-library-events";

/** 공통 헤더에 표시하는 조회 전용 도우미이며 실행 선택과는 별개다. */
export function WorkspaceCompanion({ session, canReadPets }: { session: AuthSession; canReadPets: boolean }) {
  const t = useT();
  const [collection, setCollection] = useState<AgentPetCollection | null>(null);

  useEffect(() => {
    if (!canReadPets) return;
    let active = true;
    let version = 0;
    const refresh = () => {
      const requestVersion = ++version;
      void listAgentPets(session)
        .then((value) => {
          if (active && requestVersion === version) setCollection(value);
        })
        .catch(() => {
          // 오프라인에서도 로그인 도우미를 표시하고 작업 공간의 동작을 막지 않는다.
          if (active && requestVersion === version) setCollection(null);
        });
    };
    const unsubscribe = subscribeToPetLibrary(session, (value) => {
      version += 1;
      setCollection(value);
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
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

  const selected =
    canReadPets && Array.isArray(collection?.pets)
      ? collection.pets.find((pet) => pet.id === collection.selectedPetId && !pet.archived)
      : null;
  // 선택하지 않은 보관함 펫이나 과거 실행에 고정된 프로필로 대체하지 않는다.
  const label = selected ? t("함께하는 동료: {name}", { name: selected.profile.name }) : t("로그인에서 함께 온 친구");
  return (
    <div
      className="workspace-companion"
      role="img"
      aria-label={label}
      title={label}
      data-companion={selected ? "selected" : "login"}
    >
      <div className="workspace-companion-portrait" aria-hidden="true">
        {selected ? (
          <PetArt kind={selected.profile.animal} profile={selected.profile} />
        ) : (
          <svg className="workspace-login-pet" viewBox="510 330 370 370" aria-hidden="true" focusable="false">
            <image href={loginMedia.staticPoster} width="1600" height="900" />
          </svg>
        )}
      </div>
      <div className="workspace-companion-caption" aria-hidden="true">
        <small>{t("늘 함께하는 작은 동료")}</small>
        <strong>{selected ? selected.profile.name : t("오늘도 함께해요")}</strong>
      </div>
    </div>
  );
}
