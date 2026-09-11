import { quotationScenarioLabels } from "../../shared/constants";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuoteToolbar({ model }: { model: QuoteBuilderModel }) {
  const { availableAIDrafts, canWrite, scenario, activateScenario, aiDraftByScenario, saved, discardGeneratedAIDraft, resetQuotation } = model;

  return (
    <>
      <div className="quote-toolbar">
        <div>
          <span>{availableAIDrafts.length > 0 ? "AI 초안 비교" : "견적 직접 작성"}</span>
          <h2>
            {availableAIDrafts.length === 3
              ? "범위와 공수가 다른 세 견적안을 비교하세요."
              : availableAIDrafts.length > 0
                ? "AI가 정리한 작업과 공수를 확인하세요."
                : "항목별 공수와 근거를 함께 기록하세요."}
          </h2>
        </div>
        <div className="scenario-switch" role="group" aria-label="견적 시나리오">
          {(["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => (
            <button
              type="button"
              key={value}
              disabled={!canWrite}
              className={scenario === value ? "active" : ""}
              onClick={() => activateScenario(value)}
            >
              {value === "LEAN" ? "핵심" : value === "RECOMMENDED" ? "권장" : "확장"}
            </button>
          ))}
        </div>
        {canWrite && aiDraftByScenario[scenario] && !saved && (
          <button
            type="button"
            className="quiet-button danger discard-ai-draft"
            onClick={discardGeneratedAIDraft}
          >
            AI {quotationScenarioLabels[scenario]} 버리기
          </button>
        )}
        {canWrite && (
          <button type="button" className="quiet-button" onClick={() => resetQuotation()}>
            새 견적안
          </button>
        )}
      </div>
    </>
  );
}
