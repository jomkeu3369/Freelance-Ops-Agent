import { useT } from "../../../../app/lib/ui-language";
import { quotationScenarioLabels, quotationStatusLabels } from "../../shared/constants";
import { formatMoney } from "../../shared/formatters";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuoteHistory({ model }: { model: QuoteBuilderModel }) {
  const t = useT();
  const { quotations, loadQuotation } = model;

  return (
    <>
      {quotations.length > 0 && (
        <details className="quote-history workspace-disclosure">
          <summary>{t("견적 이력")}<small>{quotations.length}{t("건")}</small></summary>
          {quotations.map((quotation) => (
            <button type="button" key={quotation.id} onClick={() => loadQuotation(quotation)}>
              <strong>
                {t(quotationScenarioLabels[quotation.scenario])} v{quotation.versionNumber}
              </strong>
              <small>{t(quotationStatusLabels[quotation.status]) ?? t("상태 확인 필요")}</small>
              <span>{formatMoney(quotation.total, quotation.currency)}</span>
            </button>
          ))}
        </details>
      )}
    </>
  );
}
