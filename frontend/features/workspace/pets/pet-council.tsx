import { useId, useState } from "react";
import { previewQuotation, type AuthSession, type QuotationItemInput, type QuotationPreview } from "@/app/lib/api";
import { formatMoney } from "../shared/formatters";
import { quotationDraftItems } from "../project/quotation/quotation-helpers";
import type { QuoteBuilderModel } from "../project/quotation/use-quote-builder";
import { petAdvisors, duplicateTaskTitles } from "./pet-state.mjs";
import { PetArt } from "./pet-art";

type Comparison = { fingerprint: string; before: QuotationPreview | null; after: QuotationPreview; items: QuotationItemInput[] };

export function PetCouncil({ model, session }: { model: QuoteBuilderModel; session: AuthSession }) {
  const inputPrefix = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const candidates = model.availableAIDrafts.flatMap(draft => quotationDraftItems(draft, model.rateCards, model.project.currency).map((item, index) => ({ id: `${draft.scenario}:${index}`, item })));
  const chosen = candidates.filter(candidate => selected.includes(candidate.id));
  const duplicateTitles = duplicateTaskTitles(chosen.map(candidate => candidate.item));
  const missingRates = chosen.some(candidate => !candidate.item.rateCardId);
  const fingerprint = JSON.stringify({ selected, candidates, items: model.items, taxRate: model.taxRate, scenario: model.scenario, base: model.saved?.id, validUntil: model.validUntil, workspace: session.workspaceId, project: model.project.id });
  const currentComparison = comparison?.fingerprint === fingerprint ? comparison : null;
  const canPreview = model.canWrite && !model.busy && !loading && chosen.length > 0 && duplicateTitles.length === 0 && !missingRates;

  function toggle(id: string) {
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    setMessage(null);
  }

  async function compare() {
    if (!canPreview) return;
    setLoading(true);
    setMessage(null);
    setComparison(null);
    const nextItems = structuredClone(chosen.map(candidate => candidate.item));
    const input = { scenario: model.scenario, currency: model.project.currency, taxRate: model.taxRate, applyDefaultRiskBuffer: true, validUntil: model.validUntil || null };
    try {
      const [before, after] = await Promise.allSettled([
        previewQuotation(session, model.project.id, { ...input, items: model.items }),
        previewQuotation(session, model.project.id, { ...input, items: nextItems })
      ]);
      if (after.status === "rejected") throw after.reason;
      setComparison({ fingerprint, before: before.status === "fulfilled" ? before.value : null, after: after.value, items: nextItems });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "변경 금액을 계산하지 못했습니다. 다시 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!currentComparison || !model.canWrite || model.busy || loading) return;
    model.setItems(structuredClone(currentComparison.items));
    model.setSelectedBasisIndex(0);
    setComparison(null);
    setSelected([]);
    setMessage("선택한 작업으로 편집 초안을 변경했습니다. 항목을 검토하고 ‘검토용 초안 저장’을 눌러 주세요.");
  }

  if (!model.availableAIDrafts.length) return null;

  return <section className="pet-council" aria-label="AI 펫 의견 비교">
    <header><span className="pet-eyebrow">서로 다른 관점, 결정은 나에게</span><h3>어떤 제안으로 만들어 볼까요?</h3><p>각 제안의 작업을 선택해 조합하세요. 선택한 작업이 현재 편집 중인 견적의 전체 항목을 대신합니다.</p></header>
    <div className="pet-proposals">
      {petAdvisors.map(pet => {
        const draft = model.availableAIDrafts.find(value => value.scenario === pet.scenario);
        if (!draft) return null;
        const opinion = draft.petPerspective;
        return <article key={pet.id} className={`pet-proposal pet-proposal-${pet.id}`}>
          <div className="pet-proposal-title"><PetArt kind={pet.id} state="ready" /><div><strong>{pet.name}</strong><span>{pet.role}</span><small>{pet.priority}</small></div></div>
          {opinion ? <><h4>{opinion.proposal}</h4><p>{opinion.rationale}</p><div className="pet-tradeoff"><strong>함께 생각할 점</strong><p>{opinion.tradeoff}</p></div></> : <p className="pet-legacy-note">이전 분석에는 동료의 의견이 기록되어 있지 않습니다. 기존 견적 항목은 비교할 수 있어요.</p>}
          <fieldset disabled={!model.canWrite || loading || model.busy}><legend>이 제안의 작업 선택</legend>
            {draft.items.map((item, index) => <label key={`${draft.scenario}:${index}`} className="pet-task" htmlFor={`${inputPrefix}-${draft.scenario}-${index}`}><input id={`${inputPrefix}-${draft.scenario}-${index}`} aria-label={`${pet.name}의 제안: ${item.title}`} type="checkbox" checked={selected.includes(`${draft.scenario}:${index}`)} onChange={() => toggle(`${draft.scenario}:${index}`)} /><span><strong>{item.title}</strong><small>{item.quantity} {item.unit === "DAY" ? "일" : item.unit === "HOUR" ? "시간" : "건"}</small><span>{item.basis.type === "EVIDENCE" ? "근거" : "가정"} · {item.basis.content}</span></span></label>)}
          </fieldset>
        </article>;
      })}
    </div>
    <div className="pet-apply-panel">
      <div><strong>{chosen.length}개 작업 선택</strong><p>금액은 단가·최소 금액·할인·위험 대비·세금을 포함해 서버에서 계산합니다.</p></div>
      <button type="button" className="secondary-button" disabled={!canPreview} onClick={() => void compare()}>{loading ? "금액 확인 중…" : "변경 미리보기"}</button>
      {duplicateTitles.length > 0 && <p role="alert">같은 작업이 중복 선택됐습니다. 하나만 남겨 주세요: {duplicateTitles.join(", ")}</p>}
      {missingRates && <p role="status">선택한 작업에 연결할 단가가 없습니다. 설정의 작업 단가표를 먼저 등록·확인해 주세요.</p>}
      {currentComparison && <section className="pet-change-preview" aria-label="견적 변경 미리보기">
        <h4>저장 전, 변경 내용을 확인하세요.</h4>
        <dl><div><dt>현재 초안 · {model.items.length}개 항목</dt><dd>{currentComparison.before ? formatMoney(currentComparison.before.total, model.project.currency) : "현재 초안 계산 실패"}</dd></div><div><dt>변경 후 · {currentComparison.items.length}개 항목</dt><dd>{formatMoney(currentComparison.after.total, model.project.currency)}</dd></div>{currentComparison.before && <div><dt>금액 차이</dt><dd>{formatMoney(currentComparison.after.total - currentComparison.before.total, model.project.currency)}</dd></div>}<div><dt>변경 후 위험 대비 / 세금</dt><dd>{formatMoney(currentComparison.after.riskBufferAmount, model.project.currency)} / {formatMoney(currentComparison.after.taxAmount, model.project.currency)}</dd></div></dl>
        <details><summary>교체할 현재 작업과 적용할 작업 확인</summary><strong>현재 작업</strong><ul>{model.items.map((item, index) => <li key={index}>{item.title || "제목 없음"} · {item.quantity} {item.unit}</li>)}</ul><strong>변경 후 작업</strong><ul>{currentComparison.items.map((item, index) => <li key={index}>{item.title} · {item.quantity} {item.unit}</li>)}</ul></details>
        <p>현재 항목 전체가 교체됩니다. 아직 저장·발행되지 않으며 저장 시 최신 정책과 권한을 다시 확인합니다.</p>
        <button type="button" className="primary-button" disabled={!model.canWrite || model.busy || loading} onClick={apply}>확인한 작업으로 편집 초안 변경</button>
      </section>}
      {message && <p role="status">{message}</p>}
    </div>
  </section>;
}
