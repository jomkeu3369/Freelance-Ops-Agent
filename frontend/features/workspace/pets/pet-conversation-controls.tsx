import { useState } from "react";
import { SlidersHorizontal } from "@phosphor-icons/react";
import { useT } from "../../../app/lib/ui-language";
import { PetArt } from "./pet-art";
import { WorkspacePanel } from "../shared/workspace-panel";
import type { PetConversationState } from "./use-pet-conversation";

export function PetConversationControls({ state, beforeChange, onManageLibrary }: {
  state: PetConversationState; beforeChange: () => Promise<void>; onManageLibrary: () => void
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectionError, setSelectionError] = useState("");
  const settings = state.view?.settings;
  const selected = settings?.participantPetIds.map(id => state.pets.find(pet => pet.id === id)).filter(pet => !!pet) ?? [];
  return <div className="pet-conversation-controls">
    {state.loading && <p role="status">{t("대화 설정을 불러오는 중…")}</p>}
    {state.error && <p role="alert">{t(state.error)}<button type="button" className="quiet-button" disabled={state.saving} onClick={state.refresh}>{t("다시 확인")}</button></p>}
    {settings && <>
      <div className="pet-conversation-team">
        <div className="pet-conversation-members">{settings.petMode ? selected.map(pet => <span className="pet-conversation-member" key={pet.id}><PetArt kind={pet.profile.animal} profile={pet.profile} /><strong title={pet.profile.name}>{pet.profile.name}</strong></span>) : <strong>{t("기본 AI 대화")}</strong>}</div>
        <button type="button" className="quiet-button pet-conversation-participants" aria-label={t("참여 펫 {count}/3", {count:settings.participantPetIds.length})} disabled={state.saving} onClick={() => { setSelection([...settings.participantPetIds]); setSelectionError(""); setEditing(true); }}><span>{t("참여 펫 {count}/3", {count:settings.participantPetIds.length})}</span><span aria-hidden="true">{settings.participantPetIds.length}/3</span></button>
      </div>
      <details className="pet-conversation-settings">
      <summary aria-label={t("대화 설정")}><SlidersHorizontal size={20} aria-hidden="true" /><span>{t("대화 설정")}</span></summary>
      <div className="pet-conversation-switches">
        <label><input type="checkbox" role="switch" checked={settings.petMode} disabled={state.saving || !selected.length} onChange={event => void state.save({petMode:event.target.checked},beforeChange)} />{t("펫과 대화")}</label>
        <label><input type="checkbox" role="switch" checked={settings.debateEnabled} disabled={state.saving || !settings.petMode || selected.length < 2} onChange={event => void state.save({debateEnabled:event.target.checked},beforeChange)} />{t("펫끼리 토론")}</label>
        <label>{t("받는 사람")}<select aria-label={t("대화할 상대")} value={state.recipient} disabled={state.saving || !settings.petMode} onChange={event => state.setRecipient(event.target.value)}><option value="">{t("모두에게")}</option>{selected.map(pet => <option key={pet.id} value={pet.id}>{pet.profile.name}</option>)}</select></label>
      </div>
      </details>
    </>}
    {editing && <WorkspacePanel title={t("이번 견적을 함께할 펫")} onClose={() => setEditing(false)} className="pet-conversation-picker">
      <p>{t("1명부터 3명까지 선택하세요. 진행 중인 응답은 멈춘 뒤 다음 메시지부터 적용합니다.")}</p>
      <div className="pet-conversation-grid">{state.pets.map(pet => <button type="button" key={pet.id} className="pet-conversation-choice" aria-pressed={selection.includes(pet.id)} disabled={state.saving} onClick={() => {
        if (selection.includes(pet.id)) setSelection(values => values.filter(id => id !== pet.id));
        else if (selection.length < 3) setSelection(values => [...values,pet.id]);
        else setSelectionError(t("최대 3명까지 함께할 수 있어요."));
      }}><PetArt kind={pet.profile.animal} profile={pet.profile} /><strong>{pet.profile.name}</strong><span>{pet.profile.preferences?.focus}</span></button>)}</div>
      {selectionError && <p role="alert">{selectionError}</p>}
      <div className="pet-conversation-picker-actions"><button type="button" className="secondary-button" disabled={state.saving} onClick={() => { setEditing(false); onManageLibrary(); }}>{t("펫 만들기·관리")}</button><button type="button" className="primary-button" disabled={state.saving || selection.length < 1} onClick={async () => { if (await state.save({participantPetIds:selection,petMode:true},beforeChange)) setEditing(false); }}>{t("이 조합으로 이야기하기")}</button></div>
    </WorkspacePanel>}
  </div>;
}
