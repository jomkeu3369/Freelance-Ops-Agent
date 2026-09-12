import { quotationScenarioLabels } from "../../shared/constants";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuoteToolbar({ model }: { model: QuoteBuilderModel }) {
  const { availableAIDrafts, canWrite, scenario, activateScenario, aiDraftByScenario, saved, discardGeneratedAIDraft, resetQuotation } = model;

  return (
    <>
      <div className="quote-toolbar">
        <div className="quote-toolbar-copy">
          <span>{availableAIDrafts.length > 0 ? "AI 초안 비교" : "견적 직접 작성"}</span>
          <h2>
            {availableAIDrafts.length === 3
              ? "견적 비교·검토"
              : availableAIDrafts.length > 0
                ? "견적 초안 검토"
                : "새 견적 작성"}
          </h2>
        </div>
        <div className="quote-toolbar-actions">
          <div className="scenario-switch" role="group" aria-label="견적 시나리오">
            {(["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => (
              <button
                type="button"
                key={value}
                disabled={!canWrite}
                className={scenario === value ? "active" : ""}
                aria-pressed={scenario === value}
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
      </div>
    </>
  );
}
