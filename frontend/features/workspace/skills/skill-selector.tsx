"use client";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useUiLocale } from "../../../app/lib/ui-language";
import categories from "./categories.json";
import { defaultSkillSelection, normalizeSkillSelection, resolveSkills, skills, type SkillSelection } from "./skill-selection";
import "./skills.css";

const selections = new Map<string, SkillSelection>();
const changeEvent = "freelance-ops-skill-selection";
const subscribe = (notify: () => void) => { window.addEventListener(changeEvent, notify); return () => window.removeEventListener(changeEvent, notify); };
function readSelection(key: string) {
  if (!selections.has(key)) {
    try { selections.set(key, normalizeSkillSelection(JSON.parse(sessionStorage.getItem(key) ?? "null"))); }
    catch { selections.set(key, normalizeSkillSelection(null)); }
  }
  return selections.get(key)!;
}
export function useSkillSelection(key: string): [SkillSelection, (value: SkillSelection) => void] {
  const selection = useSyncExternalStore(subscribe, useCallback(() => readSelection(key), [key]), () => defaultSkillSelection);
  const update = useCallback((value: SkillSelection) => {
    const snapshot = normalizeSkillSelection(value);
    selections.set(key, snapshot);
    try { sessionStorage.setItem(key, JSON.stringify(snapshot)); } catch { /* The in-memory draft remains available. */ }
    window.dispatchEvent(new Event(changeEvent));
  }, [key]);
  return [selection, update];
}

export function SkillNames({ ids, prefix }: { ids: string[]; prefix?: string }) {
  const locale = useUiLocale();
  if (!ids.length) return null;
  return <span className="skill-names">{prefix}{ids.map(id => skills.find(skill => skill.id === id)?.name[locale] ?? id).join(" · ")}</span>;
}

export function SkillSelector({ draft, value, onChange, disabled }: { draft: string; value: SkillSelection; onChange: (selection: SkillSelection) => void; disabled: boolean }) {
  const locale = useUiLocale();
  const en = locale === "en";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const resolved = resolveSkills(draft, value);
  const visible = skills.filter(skill => (!category || skill.category === category)
    && `${skill.name.ko} ${skill.name.en} ${skill.summary.ko} ${skill.summary.en}`.toLowerCase().includes(query.toLowerCase()));
  function remove(id: string) {
    onChange(value.mode === "AUTO" ? { ...value, excludedIds: [...new Set([...value.excludedIds, id])] }
      : { ...value, manualIds: value.manualIds.filter(item => item !== id) });
  }
  return <div className="skill-selector">
    <details>
      <summary>{en ? "Skills" : "스킬"}: {value.mode === "AUTO" ? en ? "Auto" : "자동" : en ? `Manual (${value.manualIds.length})` : `직접 선택 (${value.manualIds.length})`}</summary>
      <section className="skill-panel" aria-label={en ? "Choose built-in skills" : "기본 스킬 선택"}>
        <p>{en ? "All 60 skills are free. AI execution uses actual API cost and your weekly limit." : "기본 스킬 60개는 무료예요. AI 실행은 실제 API 비용과 주간 한도를 사용해요."}</p>
        <div className="skill-modes">
          <button type="button" disabled={disabled} aria-pressed={value.mode === "AUTO"} onClick={() => onChange({ ...value, mode: "AUTO", manualIds: [] })}>{en ? "Auto" : "자동"}</button>
          <button type="button" disabled={disabled} aria-pressed={value.mode === "MANUAL"} onClick={() => onChange({ ...value, mode: "MANUAL", manualIds: resolved.selected })}>{en ? "Choose manually" : "직접 선택"}</button>
          <button type="button" disabled={disabled} onClick={() => onChange({ ...value, mode: "MANUAL", manualIds: [] })}>{en ? "Without a skill" : "스킬 없이"}</button>
        </div>
        <label>{en ? "Search skills" : "스킬 검색"}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={en ? "Korean or English" : "한국어 또는 영어"} /></label>
        <label>{en ? "Category" : "분야"}<select value={category} onChange={event => setCategory(event.target.value)}><option value="">{en ? "All categories" : "모든 분야"}</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name[locale]}</option>)}</select></label>
        <p className="skill-limit">{en ? "Up to 3 skills per run. Manual choices stay fixed; selecting skills does not grant tools or permissions." : "한 번에 최대 3개. 직접 고른 스킬은 유지되며 도구나 권한은 추가되지 않아요."}</p>
        <div className="skill-results">{visible.map(skill => {
          const selected = value.mode === "MANUAL" && value.manualIds.includes(skill.id);
          return <button key={skill.id} type="button" disabled={disabled || !selected && value.mode === "MANUAL" && value.manualIds.length >= 3} aria-pressed={selected} onClick={() => onChange({ ...value, mode: "MANUAL", manualIds: selected ? value.manualIds.filter(id => id !== skill.id) : [...(value.mode === "MANUAL" ? value.manualIds : []), skill.id] })}>
            <strong>{skill.name[locale]} <small>FREE</small></strong><span>{skill.summary[locale]}</span>
          </button>;
        })}{!visible.length && <p>{en ? "No matching skills" : "검색 결과가 없어요"}</p>}</div>
        {!!value.excludedIds.length && <button type="button" disabled={disabled} onClick={() => onChange({ ...value, excludedIds: [] })}>{en ? "Restore excluded Auto skills" : "자동 선택 제외 초기화"}</button>}
      </section>
    </details>
    <div className="skill-active" aria-live="polite">{resolved.selected.map(id => <span key={id} title={en ? value.mode === "AUTO" ? "Matched the task’s requested output" : "Chosen manually" : value.mode === "AUTO" ? "요청한 결과물과 일치" : "직접 선택한 스킬"}>{skills.find(skill => skill.id === id)?.name[locale]} <button type="button" disabled={disabled} aria-label={`${en ? "Remove" : "제외"} ${skills.find(skill => skill.id === id)?.name[locale]}`} onClick={() => remove(id)}>×</button></span>)}</div>
    {value.mode === "MANUAL" && !resolved.selected.length && <small>{en ? "General assistance, no skill selected" : "스킬 없이 일반 도움으로 진행"}</small>}
    {!!resolved.deferred.length && <p className="skill-deferred"><SkillNames ids={resolved.deferred} prefix={en ? "Next stage needed: " : "다음 단계 필요: "} />{en ? ". These workflows are not loaded in this run; choose them for a follow-up." : ". 이번 실행에는 로드되지 않아요. 후속 요청에서 선택해 주세요."}</p>}
  </div>;
}
