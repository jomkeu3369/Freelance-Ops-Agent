import { useMemo } from "react";
import { useT } from "../../../../app/lib/ui-language";
import { quotationStatusLabels } from "../../shared/constants";
import { formatMoney } from "../../shared/formatters";
import { quotationDraftItems, quotationCalculationInput } from "./quotation-helpers";
import { useQuotationPreview } from "./use-quotation-preview";
import type { QuotationScenario } from "@/app/lib/api";
import type { QuoteBuilderModel } from "./use-quote-builder";

function ScenarioCard({ model, value }: { model: QuoteBuilderModel; value: QuotationScenario }) {
  const t = useT();
  const { latestByScenario, aiDraftByScenario, rawAIDraftByScenario, rateCards, project,
    taxRate, scenario, activateScenario, session, canWrite } = model;
  const quotation = latestByScenario[value];
  const generated = aiDraftByScenario[value];
  const dismissed = Boolean(rawAIDraftByScenario[value] && !generated);
  const input = useMemo(() => generated ? quotationCalculationInput({
    scenario: value, currency: project.currency, taxRate, validUntil: null,
    items: quotationDraftItems(generated, rateCards, project.currency)
  }) : null, [generated, value, project.currency, taxRate, rateCards]);
  const calculation = useQuotationPreview(session, project.id, input,
    !quotation && !!input && canWrite && input.items.every(item => !!item.rateCardId));
  return (
    <button type="button" className={scenario === value ? "active" : ""}
      disabled={!quotation && !generated} onClick={() => activateScenario(value)}>
      <span>{value === "LEAN" ? t("핵심") : value === "RECOMMENDED" ? t("권장") : t("확장")}</span>
      {quotation ? <>
        <strong>{formatMoney(quotation.total, quotation.currency)}</strong>
        <small>v{quotation.versionNumber} · {t(quotationStatusLabels[quotation.status]) ?? t("상태 확인 필요")}</small>
      </> : generated ? <>
        <strong>{calculation.preview ? formatMoney(calculation.preview.total, project.currency) : t("금액 확인 필요")}</strong>
        <small>{t("AI 초안 ·")}{generated.items.length}{t("개 작업")}</small>
      </> : dismissed ? <>
        <strong>{t("초안 폐기됨")}</strong><small>{t("새 분석에서 다시 생성됩니다.")}</small>
      </> : <>
        <strong>{t("작성 전")}</strong><small>{t("저장된 견적 없음")}</small>
      </>}
    </button>
  );
}

export function ScenarioComparison({ model }: { model: QuoteBuilderModel }) {
  const t = useT();
  return <section className="scenario-comparison" aria-label={t("견적 시나리오 비교")}>
    <header>
      <div><span>{t("견적안 비교")}</span><strong>{t("핵심안·권장안·확장안을 한눈에 비교하세요.")}</strong></div>
      <small>{t("카드를 선택하면 해당 견적안을 이어서 편집할 수 있습니다.")}</small>
    </header>
    <div>{(["LEAN", "RECOMMENDED", "EXPANDED"] as const).map(value =>
      <ScenarioCard key={value} value={value} model={model} />)}</div>
  </section>;
}
