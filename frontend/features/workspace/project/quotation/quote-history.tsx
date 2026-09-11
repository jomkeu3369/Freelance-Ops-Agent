import { quotationScenarioLabels, quotationStatusLabels } from "../../shared/constants";
import { formatMoney } from "../../shared/formatters";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuoteHistory({ model }: { model: QuoteBuilderModel }) {
  const { quotations, loadQuotation } = model;

  return (
    <>
      {quotations.length > 0 && (
        <div className="quote-history">
          <span>견적 이력</span>
          {quotations.map((quotation) => (
            <button type="button" key={quotation.id} onClick={() => loadQuotation(quotation)}>
              <strong>
                {quotationScenarioLabels[quotation.scenario]} v{quotation.versionNumber}
              </strong>
              <small>{quotationStatusLabels[quotation.status] ?? "상태 확인 필요"}</small>
              <span>{formatMoney(quotation.total, quotation.currency)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
