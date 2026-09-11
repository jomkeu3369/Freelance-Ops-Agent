import { quotationStatusLabels } from "../../shared/constants";
import { formatMoney } from "../../shared/formatters";
import {
  quotationDraftItems
} from "./quotation-helpers";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function ScenarioComparison({ model }: { model: QuoteBuilderModel }) {
  const { latestByScenario, aiDraftByScenario, rawAIDraftByScenario, rateCards, project, taxRate, scenario, activateScenario } = model;

  return (
    <>
      <section className="scenario-comparison" aria-label="견적 시나리오 비교">
        <header>
          <div>
            <span>견적안 비교</span>
            <strong>핵심안·권장안·확장안을 한눈에 비교하세요.</strong>
          </div>
          <small>카드를 선택하면 해당 견적안을 이어서 편집할 수 있습니다.</small>
        </header>
        <div>
          {(["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => {
            const quotation = latestByScenario[value];
            const generated = aiDraftByScenario[value];
            const dismissed = Boolean(rawAIDraftByScenario[value] && !generated);
            const generatedItems = generated
              ? quotationDraftItems(generated, rateCards, project.currency)
              : [];
            const generatedTotal =
              generatedItems.reduce(
                (sum, item) => sum + item.quantity * item.unitRate * (1 - item.discountRate),
                0
              ) *
              (1 + taxRate);
            return (
              <button
                type="button"
                key={value}
                className={scenario === value ? "active" : ""}
                disabled={!quotation && !generated}
                onClick={() => activateScenario(value)}
              >
                <span>{value === "LEAN" ? "핵심" : value === "RECOMMENDED" ? "권장" : "확장"}</span>
                {quotation ? (
                  <>
                    <strong>{formatMoney(quotation.total, quotation.currency)}</strong>
                    <small>
                      v{quotation.versionNumber} ·{" "}
                      {quotationStatusLabels[quotation.status] ?? "상태 확인 필요"}
                    </small>
                  </>
                ) : generated ? (
                  <>
                    <strong>{formatMoney(generatedTotal, project.currency)}</strong>
                    <small>AI 초안 · {generated.items.length}개 작업</small>
                  </>
                ) : dismissed ? (
                  <>
                    <strong>초안 폐기됨</strong>
                    <small>새 분석에서 다시 생성됩니다.</small>
                  </>
                ) : (
                  <>
                    <strong>작성 전</strong>
                    <small>저장된 견적 없음</small>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
