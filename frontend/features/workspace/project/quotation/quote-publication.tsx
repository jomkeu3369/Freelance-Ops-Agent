import { useT } from "../../../../app/lib/ui-language";
import {
  Archive,
  ArrowRight,
  Copy
} from "@phosphor-icons/react";
import { quotationScenarioLabels, quotationStatusLabels } from "../../shared/constants";
import { formatMoney } from "../../shared/formatters";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuotePublication({ model }: { model: QuoteBuilderModel }) {
  const t = useT();
  const { saved, canPublish, busy, publishSavedQuotation, proposalShare, createCustomerLink, shareCopyState, copyCustomerLink, disableCustomerLink } = model;

  return (
    <>
      {saved && (
        <article className="saved-quote" aria-live="polite">
          <div>
            <span>{t("견적 저장 완료 ·")}{quotationStatusLabels[saved.status] ?? "상태 확인 필요"}</span>
            <h3>
              {quotationScenarioLabels[saved.scenario]} v{saved.versionNumber}
            </h3>
            <p>
              {t("총액")}{formatMoney(saved.total, saved.currency)} {t("· 위험 대비율")}{" "}
              {Math.round(saved.riskBufferRate * 100)}{t("% · 세금")}{formatMoney(saved.taxAmount, saved.currency)}
            </p>
          </div>
          <div className="saved-quote-actions">
            {saved.status === "DRAFT" && canPublish && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy || model.hasUnsavedDraft}
                title={model.hasUnsavedDraft ? t("변경한 초안을 먼저 저장해 주세요.") : undefined}
                onClick={() => void publishSavedQuotation()}
              >
                {t("발행하기")}<ArrowRight size={17} />
              </button>
            )}
            {saved.status === "PUBLISHED" && canPublish && !proposalShare && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void createCustomerLink()}
              >
                {t("고객 링크 만들기")}<ArrowRight size={17} />
              </button>
            )}
          </div>
        </article>
      )}
      {proposalShare && (
        <div className="share-link" role="status">
          <div>
            <span>
              {shareCopyState === "copied"
                ? t("고객 제안서 링크를 만들고 복사했습니다.")
                : t("고객 제안서 링크를 만들었습니다.")}
            </span>
            <small>
              {shareCopyState === "manual"
                ? t("자동 복사가 차단되었습니다. 아래 링크를 직접 복사하세요.")
                : t("{v0}까지 유효", { v0: new Date(proposalShare.expiresAt).toLocaleDateString("ko-KR") })}
            </small>
          </div>
          <a href={proposalShare.url} target="_blank" rel="noopener noreferrer">
            {proposalShare.url}
          </a>
          <div className="share-link-actions">
            <button
              type="button"
              className="quiet-button"
              disabled={busy}
              onClick={() => void copyCustomerLink()}
            >
              <Copy size={17} /> {t("링크 복사")}</button>
            <button
              type="button"
              className="quiet-button danger"
              disabled={busy}
              onClick={() => void disableCustomerLink()}
            >
              <Archive size={17} /> {t("링크 비활성화")}</button>
          </div>
        </div>
      )}
    </>
  );
}
