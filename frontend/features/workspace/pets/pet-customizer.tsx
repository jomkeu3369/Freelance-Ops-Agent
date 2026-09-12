import { useEffect, useId, useState } from "react";
import { generatePet, listPets, savePet, type AuthSession, type PetProfile, type Provider } from "@/app/lib/api";
import { PetArt } from "./pet-art";
import { petColors, petDefaults, preferenceLabels } from "./pet-profile";

export function PetCustomizer({ session, projectId, selection, disabled }: { session: AuthSession; projectId: string; selection: { provider: Provider; model: string; credentialId?: string } | null; disabled: boolean }) {
  const prefix = useId();
  const [profiles, setProfiles] = useState<PetProfile[] | null>(null);
  const [draft, setDraft] = useState<PetProfile>(petDefaults[0]);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [preview, setPreview] = useState("idle");
  useEffect(() => {
    let current = true;
    listPets(session).then(values => { if (current) { setProfiles(values); setDraft(values[0]); setStatus(""); } }).catch(() => { if (current) setStatus("동료 설정을 불러오지 못했습니다. 다시 불러와 주세요."); });
    return () => { current = false; };
  }, [session, reload]);
  const locked = busy || disabled || !profiles;
  const saved = profiles?.find(pet => pet.slot === draft.slot);
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const validName = /^[\p{L}\p{N} _-]{1,20}$/u.test(draft.name) && !!draft.name.trim();
  async function save() {
    setBusy(true); setStatus("");
    try {
      const value = await savePet(session, draft);
      setProfiles(current => current!.map(pet => pet.slot === value.slot ? value : pet));
      setDraft(value); setStatus("저장했습니다. 다음 분석부터 이 외형과 성향을 사용합니다.");
    } catch { setStatus("저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!selection) return;
    setBusy(true); setStatus("외형과 성향을 만들고 있어요. 최대 30초 정도 걸립니다.");
    try {
      const result = await generatePet(session, projectId, { description: description.trim(), slot: draft.slot, modelSelection: { ...selection, reasoningEffort: "LOW" } });
      setDraft(result.profile);
      setStatus(`생성 미리보기입니다. ${result.provider} · ${result.model} · 입력 ${result.inputTokens} / 출력 ${result.outputTokens} 토큰. 검토 후 저장해 주세요.`);
    } catch { setStatus("생성하지 못했습니다. 기존 설정은 유지됩니다. AI 연결과 하루 생성 한도(20회)를 확인해 주세요."); }
    finally { setBusy(false); }
  }
  const fields = [
    ["tone", "말투", { WARM: "친근하게", DIRECT: "간결하게", FORMAL: "정중하게" }],
    ["valuePriority", "수익과 관계", { PROFIT: preferenceLabels.PROFIT, BALANCED: "균형", RELATIONSHIP: preferenceLabels.RELATIONSHIP }],
    ["deliveryPriority", "납품과 완성도", { SPEED: preferenceLabels.SPEED, BALANCED: "균형", QUALITY: preferenceLabels.QUALITY }],
    ["scopePriority", "제안 범위", { CAUTIOUS: preferenceLabels.CAUTIOUS, BALANCED: "균형", EXPLORATORY: preferenceLabels.EXPLORATORY }]
  ] as const;
  return <details className="pet-customizer">
    <summary><span>나만의 작은 동료 만들기</span><small>외형 · 말투 · 판단 성향</small></summary>
    <p className="pet-customizer-intro">내 동료의 모습을 꾸미고, 어떤 가치를 먼저 살필지 정해 주세요. 이 워크스페이스의 내 설정으로 저장되며 다음 분석부터 적용됩니다.</p>
    {!profiles && <button type="button" className="secondary-button" onClick={() => setReload(value => value + 1)}>설정 다시 불러오기</button>}
    <div className="pet-picker" aria-label="꾸밀 동료 선택">{(profiles ?? petDefaults).map((pet, index) => <button type="button" key={pet.slot} disabled={locked || dirty} aria-pressed={draft.slot === pet.slot} onClick={() => { setDraft(pet); setStatus(""); }}><PetArt kind={pet.animal} profile={pet}/><strong>{pet.name}</strong><small>{["핵심안", "권장안", "확장안"][index]}</small></button>)}</div>
    <div className="pet-studio">
      <div className="pet-preview"><span className="pet-eyebrow">LIVE PREVIEW · 미리보기</span><PetArt kind={draft.animal} profile={draft} state={preview}/><h3>{draft.name || "이름을 지어 주세요"}</h3><div className="pet-preview-states">{[["idle", "대기"], ["working", "작업"], ["waiting", "질문"]].map(([value, label]) => <button type="button" key={value} aria-pressed={preview === value} onClick={() => setPreview(value)}>{label}</button>)}</div><p>외형 미리보기용 동작입니다.</p></div>
      <fieldset className="pet-controls" disabled={locked}><legend>외형과 성향</legend>
        <label>이름<input maxLength={20} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
        <label>동물<select value={draft.animal} onChange={event => setDraft({ ...draft, animal: event.target.value as PetProfile["animal"] })}><option value="turtle">거북이</option><option value="owl">부엉이</option><option value="cat">고양이</option></select></label>
        <label>색상<select value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value as PetProfile["color"] })}>{Object.entries(petColors).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>액세서리<select value={draft.accessory} onChange={event => setDraft({ ...draft, accessory: event.target.value as PetProfile["accessory"] })}>{Object.entries({ none: "없음", glasses: "안경", scarf: "스카프", star: "별 장식" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {fields.map(([key, label, options]) => <label key={key}>{label}<select value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })}>{Object.entries(options).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
      </fieldset>
    </div>
    <div className="pet-generation"><label htmlFor={`${prefix}-description`}>한 문장으로 만들어 보기</label><textarea id={`${prefix}-description`} maxLength={500} disabled={locked} value={description} onChange={event => setDescription(event.target.value)} placeholder="무뚝뚝하지만 내 수익을 챙겨 주는, 별 장식을 단 검은 고양이"/><p>지원하는 동물·색·장식의 조합을 생성합니다. {selection ? `${selection.credentialId ? "내 키" : "기본 제공 AI"} · ${selection.provider} · ${selection.model}` : "위에서 사용할 AI를 선택해 주세요."}<br/>생성 버튼을 누르면 AI를 1회 호출합니다. 최대 1,000 출력 토큰 · 하루 20회(실패 포함), 사용한 모델의 비용이 발생할 수 있습니다.</p><button type="button" className="secondary-button" disabled={locked || !selection || !description.trim()} onClick={() => void generate()}>{busy ? "처리 중…" : "AI로 외형·성향 생성"}</button></div>
    <div className="pet-save-actions"><button type="button" className="quiet-button" disabled={locked} onClick={() => { setDraft(petDefaults.find(pet => pet.slot === draft.slot)!); setStatus("기본 모습의 미리보기입니다. 저장하면 다음 분석부터 적용됩니다."); }}>기본 모습으로 복원</button><button type="button" className="quiet-button" disabled={locked || !dirty} onClick={() => { setDraft(saved!); setStatus("저장된 설정으로 되돌렸습니다."); }}>수정 취소</button><button type="button" className="primary-button" disabled={locked || !dirty || !validName} onClick={() => void save()}>이 동료 저장</button></div>
    {dirty && profiles && <p className="pet-customizer-intro">미저장 변경이 있습니다. 저장하거나 수정 취소 후 다른 동료를 선택하세요.</p>}
    {!validName && <p role="alert">이름은 문자·숫자·공백·밑줄·하이픈으로 1~20자 입력해 주세요.</p>}
    <p role="status" aria-live="polite">{status}</p>
  </details>;
}
