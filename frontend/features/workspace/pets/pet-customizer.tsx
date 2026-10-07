import { useT } from "../../../app/lib/ui-language";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, listAgentPets, previewAgentPet, saveAgentPet, changeAgentPet, deleteAgentPet, type AuthSession, type AgentPetCollection, type ComposeAgentPet, type CustomAgentPet, type PetProfile, type Provider } from "@/app/lib/api";
import { PetArt } from "./pet-art";
import { preferenceLabels, petDutyLabels } from "./pet-profile";

const tones = { WARM: "친근하게", DIRECT: "간결하게", FORMAL: "정중하게" };

export function PetCustomizer({ session, disabled }: { session: AuthSession; projectId: string; selection: { provider: Provider; model: string; credentialId?: string } | null; disabled: boolean }) {
  const t = useT();
  const prefix = useId();
  const pending = useRef(false);
  const listVersion = useRef(0);
  const [collection, setCollection] = useState<AgentPetCollection | null>(null);
  const [editing, setEditing] = useState<CustomAgentPet | null>(null);
  const [description, setDescription] = useState("");
  const [resetPreferences, setResetPreferences] = useState(false);
  const [preview, setPreview] = useState<{ input: ComposeAgentPet; profile: PetProfile } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const version = ++listVersion.current;
    listAgentPets(session).then(value => { if (current && version === listVersion.current) setCollection(value); }).catch(() => { if (current && version === listVersion.current) setStatus("펫을 불러오지 못했습니다. 다시 불러와 주세요."); });
    return () => { current = false; };
  }, [session, reload]);
  const locked = disabled || busy || !collection;
  const active = collection?.pets.filter(pet => !pet.archived) ?? [];
  const archived = collection?.pets.filter(pet => pet.archived) ?? [];
  const atLimit = !!collection && (active.length >= collection.maxActivePets || collection.pets.length >= collection.maxStoredPets);
  const fullHistory = !!editing && (editing.profile.preferences?.requests.length ?? 0) >= (collection?.maxPreferenceRequests ?? 6);
  const hasDraft = !!description.trim() || !!preview;

  async function perform(action: () => Promise<void>) {
    if (pending.current || locked) return;
    pending.current = true; setBusy(true); setStatus("");
    try { await action(); }
    catch (error) {
      setStatus(error instanceof ApiError && error.status === 409
        ? "다른 변경이나 개수 제한을 확인해 주세요. 입력은 유지됩니다. 목록을 다시 불러온 뒤 수정할 펫을 골라 주세요."
        : "완료하지 못했습니다. 입력은 유지됩니다. 연결과 권한을 확인하고 다시 시도해 주세요.");
    } finally { pending.current = false; setBusy(false); }
  }

  function edit(pet: CustomAgentPet | null) {
    setEditing(pet); setDescription(""); setPreview(null); setStatus(""); setResetPreferences(false);
  }

  async function refreshCollection() {
    // A manual reload started before a mutation must not replace its newer list.
    const version = ++listVersion.current;
    const value = await listAgentPets(session);
    if (version === listVersion.current) setCollection(value);
  }

  function makePreview() {
    void perform(async () => {
      const input = { id: editing?.id ?? crypto.randomUUID(), mutationId: crypto.randomUUID(), expectedRevision: editing?.revision ?? 0, description, resetPreferences };
      const profile = await previewAgentPet(session, input);
      setPreview({ input, profile });
      setStatus("무료 미리보기입니다. 해석된 설정과 보존된 요청을 확인한 뒤 저장하세요.");
    });
  }

  function save() {
    if (!preview) return;
    void perform(async () => {
      // Preserve the mutation ID on failures; a lost response must not create another pet.
      const pet = await saveAgentPet(session, preview.input);
      await refreshCollection();
      setEditing(pet); setDescription(""); setPreview(null); setResetPreferences(false);
      setStatus("저장하고 선택했습니다. 다음 실행에 이 펫 하나의 선호를 사용합니다.");
    });
  }

  function change(pet: CustomAgentPet, action: "SELECT" | "ARCHIVE" | "RESTORE") {
    void perform(async () => {
      await changeAgentPet(session, pet, action);
      await refreshCollection();
      if (editing?.id === pet.id) edit(null);
      setStatus(action === "SELECT" ? "다음 실행에 사용할 펫을 선택했습니다." : action === "ARCHIVE" ? "보관했습니다. 이 펫은 다음 실행에 사용하지 않습니다." : "펫을 복원했습니다. 사용하려면 선택해 주세요.");
    });
  }

  return <section className="pet-customizer pet-prompt-studio" aria-label={t("나만의 작은 동료 만들기")}>
    <header><div><h3>{t("나만의 작은 동료 만들기")}</h3><p>{t("원하는 동료를 한 문장으로 설명해 주세요.")}</p></div><span className="pet-free-badge">{t("무료 미리보기")}</span></header>
    <p className="pet-customizer-intro">{t("여러 펫을 저장하고 하나를 선택합니다. 펫을 추가해도 AI 실행이 시작되거나 병렬로 과금되지 않습니다.")}</p>
    <div className="pet-library" aria-label={t("내 펫")}>
      {active.map(pet => <article key={pet.id} className={collection?.selectedPetId === pet.id ? "is-selected" : ""}>
        <PetArt kind={pet.profile.animal} profile={pet.profile}/><strong>{pet.profile.name}</strong><small>{t(petDutyLabels[pet.profile.duty ?? "GENERAL"])}</small>
        <button type="button" disabled={locked || hasDraft} aria-pressed={collection?.selectedPetId === pet.id} onClick={() => change(pet, "SELECT")}>{t(collection?.selectedPetId === pet.id ? "선택됨" : "이 펫 선택")}</button>
        <button type="button" disabled={locked || hasDraft} onClick={() => edit(pet)}>{t("대화로 수정")}</button>
        <button type="button" disabled={locked || hasDraft} onClick={() => change(pet, "ARCHIVE")}>{t("보관")}</button>
      </article>)}
    </div>
    {collection && <p className="pet-customizer-intro">{t("사용 가능")} {active.length}/{collection.maxActivePets} · {t("보관 포함")} {collection.pets.length}/{collection.maxStoredPets}<br/>{t("보관하면 사용 가능 수가 줄고, 보관함에서 삭제하면 저장 공간이 늘어납니다.")}</p>}
    <button type="button" className="quiet-button" disabled={locked || atLimit || hasDraft} onClick={() => edit(null)}>{t("새 펫 추가")}</button>
    {hasDraft && !preview && <button type="button" className="quiet-button" disabled={locked} onClick={() => edit(editing)}>{t("입력 취소")}</button>}
    {editing && <details><summary>{t("저장된 선호 보기")}</summary><ol>{editing.profile.preferences?.requests.map((value, index) => <li key={index}>{value}</li>)}</ol></details>}
    {atLimit && !editing && <p role="status">{t("펫 개수 한도에 도달했습니다. 사용 중인 펫을 보관하거나 보관함에서 삭제해 주세요.")}</p>}
    <div className="pet-generation">
      <label htmlFor={`${prefix}-prompt`}>{editing ? `${editing.profile.name} · ${t("어떻게 바꿀까요?")}` : t("어떤 펫을 만들까요?")}</label>
      <textarea id={`${prefix}-prompt`} maxLength={collection?.maxPromptLength ?? 500} disabled={locked || !!preview} value={description} onChange={event => setDescription(event.target.value)} placeholder={t("친근하게 말하고 일정 관리를 꼼꼼히 챙기는 펫 만들어줘")} aria-describedby={`${prefix}-prompt-help`} />
      <p id={`${prefix}-prompt-help`}>{t("외형은 준비된 동물·색·장식을 조합합니다. 자유로운 요청은 그대로 보존하며, 저장 전에 확인할 수 있습니다.")} {description.length}/{collection?.maxPromptLength ?? 500}</p>
      {editing && <label className="pet-reset-preferences"><input type="checkbox" disabled={locked || !!preview} checked={resetPreferences} onChange={event => setResetPreferences(event.target.checked)}/>{t("이전 선호 요청 대신 이 설명으로 새로 정리")}</label>}
      {fullHistory && !resetPreferences && <p role="status">{t("수정 기록 한도에 도달했습니다. 이전 선호를 포함한 새 설명으로 정리해 주세요.")}</p>}
      <button type="button" className="primary-button" disabled={locked || !!preview || !description.trim() || (!editing && atLimit) || (fullHistory && !resetPreferences)} onClick={makePreview}>{t("펫 미리보기")}</button>
    </div>
    {preview && <section className="pet-composed-preview" aria-label={t("저장 전 펫 확인")}>
      <PetArt kind={preview.profile.animal} profile={preview.profile}/><div><h4>{preview.profile.name}</h4><p>{t(tones[preview.profile.tone])} · {t(petDutyLabels[preview.profile.duty ?? "GENERAL"])} · {t(preferenceLabels[preview.profile.deliveryPriority])}</p>
      <p>{t("위 설정은 규칙으로 찾은 기본값입니다. 아래 자유 요청을 모두 이해해 분류했다는 뜻은 아닙니다. 실행 시 허용된 말투와 업무 선호로 참고하며 권한을 부여하지 않습니다.")}</p>
      {Object.entries(preview.profile.preferences ?? {}).filter(([key, value]) => key !== "requests" && value).map(([key, value]) => <p key={key}><strong>{t(({ personality: "성향", communication: "말투", focus: "중점", responsibility: "업무" } as Record<string, string>)[key])}: </strong>{String(value)}</p>)}
      <ol aria-label={t("보존된 선호 요청")}>{preview.profile.preferences?.requests.map((value, index) => <li key={index}>{value}</li>)}</ol>
      <p>{t("분류를 바꾸려면 ‘말투: 차분한 선생님처럼; 중점: 빠뜨린 일 찾기’처럼 수정할 수 있습니다.")}</p>
      <button type="button" className="primary-button" disabled={locked} onClick={save}>{t("저장하고 선택")}</button>
      <button type="button" className="quiet-button" disabled={locked} onClick={() => setPreview(null)}>{t("입력으로 돌아가기")}</button></div>
    </section>}
    {archived.length > 0 && <details className="pet-archive"><summary>{t("보관함")} ({archived.length})</summary>{archived.map(pet => <div key={pet.id}><strong>{pet.profile.name}</strong><button type="button" disabled={locked || !!preview || active.length >= (collection?.maxActivePets ?? 0)} onClick={() => change(pet, "RESTORE")}>{t("복원")}</button><button type="button" disabled={locked || !!preview} onClick={() => setDeleteId(pet.id)}>{t("삭제")}</button>{deleteId === pet.id && <span>{t("이 펫을 영구 삭제할까요? 기존 실행 기록은 유지됩니다.")}<button type="button" disabled={locked} onClick={() => void perform(async () => { await deleteAgentPet(session, pet); setDeleteId(null); await refreshCollection(); setStatus("펫을 삭제했습니다."); })}>{t("영구 삭제")}</button><button type="button" disabled={locked} onClick={() => setDeleteId(null)}>{t("취소")}</button></span>}</div>)}</details>}
    <p className="pet-customizer-intro">{t("유료 AI 프로필·이미지 생성은 비용 예약·정산 연결 전까지 비활성입니다. 저장한 선호는 다음 업무 실행부터 적용되며 해당 실행의 모델 사용량이 적용됩니다.")}</p>
    <button type="button" className="quiet-button" disabled={busy || disabled} onClick={() => setReload(value => value + 1)}>{t("목록 다시 불러오기")}</button>
    <p role="status" aria-live="polite">{t(status)}</p>
  </section>;
}
