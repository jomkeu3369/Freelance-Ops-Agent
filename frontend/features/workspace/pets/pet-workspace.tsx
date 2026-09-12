import { useState } from "react";
import type { AgentRunView } from "@/app/lib/api";
import { PetArt } from "./pet-art";
import { petAdvisors, petStateLabels, petWorkState } from "./pet-state.mjs";

export function PetWorkspace({ run }: { run: AgentRunView | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const advisor = petAdvisors.find(pet => pet.id === selected);
  const heading = !run ? "다음 작업을 함께 준비해요." : run.status === "RUNNING" ? "함께 살펴보고 있어요." : run.status === "WAITING_FOR_USER" ? "확인이 필요한 순간이에요." : run.status === "QUEUED" ? "분석을 시작할 준비 중이에요." : "동료들의 작업 결과를 확인해요.";
  const results = run?.result?.departmentResults.filter(result => advisor?.departments.includes(result.department)) ?? [];
  return (
    <section className="pet-workspace" aria-label="AI 펫 동료 작업 공간">
      <header><div><span className="pet-eyebrow">작은 동료들, 다른 관점</span><h3>{heading}</h3></div><button type="button" className="quiet-button" aria-expanded={!collapsed} aria-controls="pet-workspace-content" onClick={() => setCollapsed(!collapsed)}>{collapsed ? "동료 펼치기" : "동료 접기"}</button></header>
      <p className="pet-workspace-note">{run?.status === "WAITING_FOR_USER" ? "사용자의 답변을 기다리고 있어요. 확인 질문은 분석 결과에서 답변해 주세요." : "하나의 분석에서 일정·근거·수익 관점을 함께 검토합니다."}</p>
      <div id="pet-workspace-content" hidden={collapsed}>
        <div className="pet-desk">
          {petAdvisors.map(pet => {
            const state = petWorkState(run, pet.departments);
            return <button key={pet.id} type="button" className={`pet-station ${selected === pet.id ? "selected" : ""}`} aria-pressed={selected === pet.id} onClick={() => setSelected(selected === pet.id ? null : pet.id)}>
              <PetArt kind={pet.id} state={state} /><strong>{pet.name}<small>{pet.role}</small></strong><span className={`pet-status pet-status-${state}`}>{petStateLabels[state]}</span>
            </button>;
          })}
        </div>
        {advisor && <div className="pet-detail" aria-live="polite"><strong>{advisor.name}의 관점 · {advisor.priority}</strong>{results.length ? results.map(result => <p key={result.department}>{result.summary}</p>) : <p>아직 공개할 분석 결과가 없습니다. 결과가 준비되면 여기서 확인할 수 있어요.</p>}<small>분석 단계의 실제 결과입니다. 견적 탭에서는 세 관점의 제안을 비교할 수 있습니다.</small></div>}
      </div>
    </section>
  );
}
