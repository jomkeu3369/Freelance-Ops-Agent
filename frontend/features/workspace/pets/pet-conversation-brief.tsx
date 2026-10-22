import { useEffect, useMemo, useState } from "react";
import { getEstimationPolicy, listRateCards, type AgentRunView, type AuthSession,
  type Project, type RateCard } from "../../../app/lib/api";
import { useT } from "../../../app/lib/ui-language";
import { quotationDraftItems, quotationCalculationInput } from "../project/quotation/quotation-helpers";
import { useQuotationPreview } from "../project/quotation/use-quotation-preview";
import type { PetConversationState } from "./use-pet-conversation";
import { conversationText } from "./pet-conversation-text.mjs";
import { conversationVerified, PetConversationQuality } from "./pet-conversation-quality";

export function PetConversationBrief({ session, project, state, run, canRead, canWrite, onReview }: {
  session: AuthSession; project: Project; state: PetConversationState; run: AgentRunView | null;
  canRead: boolean; canWrite: boolean; onReview: () => void
}) {
  const t = useT();
  const [pricing, setPricing] = useState<{rates:RateCard[];tax:number}|null>(null);
  const [loadError, setLoadError] = useState<string|null>(null);
  const [revision, setRevision] = useState(0);
  const [rejected, setRejected] = useState<string|null>(null);
  const proposal = run?.result?.petMessages?.length && run.result.quotationDraft
    && state.view?.settings.draftSourceRunId !== run.runId && rejected !== run.runId
    && ["COMPLETED","PARTIAL"].includes(run.status) ? run.result.quotationDraft : null;
  const draft = canRead ? proposal ?? state.view?.settings.acceptedDraft : null;
  const items = useMemo(() => draft && pricing ? quotationDraftItems(draft,pricing.rates,project.currency) : [],[draft,pricing,project.currency]);
  const missing = !pricing || items.some(item => !item.rateCardId);
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    Promise.all([listRateCards(session),getEstimationPolicy(session)]).then(([rates,policy]) => {
      if (!cancelled) { setPricing({rates:rates.filter(rate => rate.active),tax:policy.defaultTaxRate}); setLoadError(null); }
    }).catch(() => { if (!cancelled) { setPricing(null); setLoadError(t("단가와 계산 기준을 확인하지 못했습니다.")); } });
    return () => { cancelled = true; };
  },[session,canRead,revision,t]);
  const input = useMemo(() => draft && pricing ? quotationCalculationInput({scenario:draft.scenario,
    currency:project.currency,taxRate:pricing.tax,validUntil:null,items}) : null,[draft,pricing,project.currency,items]);
  const calculation = useQuotationPreview(session,project.id,input,!!draft && !missing && canWrite);
  const preview = calculation.preview;
  const questions = (run?.result?.openQuestions ?? []).map(conversationText).filter(Boolean);
  const money = (value:number) => new Intl.NumberFormat("ko-KR",{style:"currency",currency:project.currency,maximumFractionDigits:2}).format(value);
  const unit = (value:string) => ({HOUR:t("시간"),DAY:t("일"),FIXED:t("건")}[value] ?? value);
  return <aside className="pet-conversation-brief" aria-label={t("함께 정리한 견적")}>
    <header><h2>{t("함께 정리한 견적")}</h2><span>{proposal ? t("미반영 제안") : t("검토할 초안")}</span></header>
    <div className="pet-conversation-brief-body"><h3>{t("확인한 내용")}</h3>
      <dl><div><dt>{t("만들 것")}</dt><dd>{project.title}</dd></div><div><dt>{t("예산 상한")}</dt><dd>{project.budgetMax == null ? t("미정") : money(project.budgetMax)}</dd></div><div><dt>{t("희망 일정")}</dt><dd>{project.deadline ?? t("미정")}</dd></div></dl>
      <details className="pet-conversation-evidence"><summary>{t("문의 원문 확인")}</summary><p>{project.requirementText}</p></details>
      {questions.length ? <div className="pet-conversation-question"><h3>{t("아직 맞춰볼 것")}</h3>{questions.map(question => <p key={question}>{question}</p>)}</div> : null}
      <hr/><h3>{t("범위와 공수")}</h3>
      {proposal && canRead && state.view?.settings.acceptedDraft && <details className="pet-conversation-evidence"><summary>{t("현재 초안과 비교")}</summary><p>{state.view.settings.acceptedDraft.items.map(item => `${item.title} · ${item.quantity} ${unit(item.unit)}`).join("\n")}</p></details>}
      {!draft && <p className="model-selection-note">{t("대화에서 범위를 정리하면 견적 변경안이 여기에 모입니다.")}</p>}
      {draft && <><ul>{draft.items.map((item,index) => <li key={index}><span>{item.title}</span><span>{item.quantity} {unit(item.unit)}</span><details><summary>{item.basis.type === "ASSUMPTION" ? t("확인 전 가정") : t("근거 확인")}</summary><p>{item.basis.content}</p><p>{item.basis.sourceTitle}</p><p>{item.basis.sourceReference}</p></details></li>)}</ul>
        {missing && <p role="status">{t("연결할 단가를 확인해야 합니다. 미정 항목은 무료로 계산하지 않습니다.")}</p>}
        {calculation.loading && <p role="status">{t("견적을 계산하고 있습니다.")}</p>}
        {preview && <><dl><div><dt>{t("항목 합계")}</dt><dd>{money(preview.subtotal)}</dd></div>{preview.discountTotal > 0 && <div><dt>{t("할인 금액")}</dt><dd>{money(preview.discountTotal)}</dd></div>}<div><dt>{t("위험 대비 금액")} ({Math.round(preview.riskBufferRate*100)}%)</dt><dd>{money(preview.riskBufferAmount)}</dd></div><div><dt>{t("세금")}</dt><dd>{money(preview.taxAmount)}</dd></div></dl><p className="pet-conversation-total">{t("예상 견적")}<strong>{money(preview.total)}</strong></p><p className="model-selection-note">{t("위험 대비 금액과 세금을 포함하며, 같은 계산 기준으로 저장합니다.")}</p>{project.budgetMax != null && preview.total > project.budgetMax && <p className="permission-note">{t("예산을 넘습니다. 범위나 예산을 다시 맞춰 주세요.")}</p>}</>}
      </>}
      <PetConversationQuality run={run}/>
      {(loadError || calculation.error) && <p role="alert">{loadError || t(calculation.error ?? "")}<button type="button" className="quiet-button" onClick={() => { setRevision(value => value + 1); calculation.refresh(); }}>{t("다시 확인")}</button></p>}
      {state.error && <p role="alert">{t(state.error)}</p>}
      {proposal && canRead && <div className="pet-conversation-proposal"><p>{t("이 제안은 아직 기존 초안에 반영되지 않았습니다.")}</p><button type="button" className="primary-button" disabled={!canWrite || state.saving || !conversationVerified(run)} onClick={() => run && void state.accept(run.runId)}>{t("초안에 반영")}</button><button type="button" className="quiet-button" disabled={state.saving} onClick={() => setRejected(run?.runId ?? null)}>{t("유지할게")}</button></div>}
      <button type="button" className="primary-button" disabled={!canRead || !state.view?.settings.acceptedDraft} onClick={onReview}>{t("견적 검토하기")}</button><p className="model-selection-note">{t("직접 검토하고 확정한 뒤 전달합니다.")}</p>
    </div>
  </aside>;
}
