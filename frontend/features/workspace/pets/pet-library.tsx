import type { KeyboardEvent, Ref } from "react";
import { Archive, Check, DotsThree, PencilSimple, PawPrint } from "@phosphor-icons/react";
import type { CustomAgentPet } from "@/app/lib/api";
import { useT } from "@/app/lib/ui-language";
import { PetArt } from "./pet-art";
import { petDutyLabels } from "./pet-profile";

interface PetLibraryProps {
  pets: CustomAgentPet[];
  selectedId: string | null;
  disabled: boolean;
  loading: boolean;
  selectedRef: Ref<HTMLButtonElement>;
  onSelect: (pet: CustomAgentPet) => void;
  onEdit: (pet: CustomAgentPet) => void;
  onArchive: (pet: CustomAgentPet) => void;
}

function closeActionsOnEscape(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Escape") return;
  const actions = event.currentTarget.closest("details");
  if (!actions?.open) return;
  event.preventDefault();
  event.stopPropagation();
  actions.open = false;
  actions.querySelector("summary")?.focus();
}

export function PetLibrary({
  pets,
  selectedId,
  disabled,
  loading,
  selectedRef,
  onSelect,
  onEdit,
  onArchive
}: PetLibraryProps) {
  const t = useT();
  return (
    <div className="pet-library" role={pets.length ? "list" : "group"} aria-label={t("내 펫")} aria-busy={loading}>
      {loading ? (
        <p className="pet-library-empty" role="status">
          {t("펫을 불러오고 있어요.")}
        </p>
      ) : pets.length === 0 ? (
        <div className="pet-library-empty">
          <PawPrint size={34} weight="light" aria-hidden="true" />
          <strong>{t("아직 함께할 펫이 없어요")}</strong>
          <p>{t("펫 만들기를 눌러 나만의 작은 동료를 만들어 보세요.")}</p>
        </div>
      ) : (
        pets.map((pet) => {
          const selected = pet.id === selectedId;
          const preferences = pet.profile.preferences;
          const description = preferences?.focus || preferences?.personality || preferences?.requests.at(-1);
          const descriptionId = `pet-description-${pet.id}`;
          return (
            <article key={pet.id} role="listitem" className={`pet-library-card${selected ? " is-selected" : ""}`}>
              <button
                type="button"
                className="pet-library-choice"
                ref={selected ? selectedRef : undefined}
                disabled={disabled}
                aria-pressed={selected}
                aria-label={`${pet.profile.name} · ${t(selected ? "선택됨" : "이 펫 선택")}`}
                aria-describedby={descriptionId}
                onClick={() => onSelect(pet)}
              >
                {selected && (
                  <span className="pet-library-check" aria-hidden="true">
                    <Check size={13} weight="bold" />
                  </span>
                )}
                <span className="pet-library-portrait">
                  <PetArt kind={pet.profile.animal} profile={pet.profile} />
                </span>
                <strong>{pet.profile.name}</strong>
                <span className="pet-library-description" id={descriptionId}>
                  {description || t(petDutyLabels[pet.profile.duty ?? "GENERAL"])}
                </span>
              </button>
              <details
                className="pet-library-actions"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
                }}
              >
                <summary aria-label={t("{name} 관리", { name: pet.profile.name })} onKeyDown={closeActionsOnEscape}>
                  <DotsThree size={21} weight="bold" aria-hidden="true" />
                </summary>
                <div className="pet-library-menu">
                  <button
                    type="button"
                    disabled={disabled}
                    onKeyDown={closeActionsOnEscape}
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      onEdit(pet);
                    }}
                  >
                    <PencilSimple size={16} aria-hidden="true" />
                    {t("대화로 수정")}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onKeyDown={closeActionsOnEscape}
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      onArchive(pet);
                    }}
                  >
                    <Archive size={16} aria-hidden="true" />
                    {t("보관")}
                  </button>
                </div>
              </details>
            </article>
          );
        })
      )}
    </div>
  );
}
