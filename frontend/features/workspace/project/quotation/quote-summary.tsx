import { useT } from "../../../../app/lib/ui-language";
import { CheckCircle, CircleNotch, Receipt } from "@phosphor-icons/react";
import { sourceTypeLabel } from "../../shared/documents";
import { formatMoney } from "../../shared/formatters";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuoteSummary({ model }: { model: QuoteBuilderModel }) {
  const t = useT();
  const {
    preview,
    calculation,
    project,
    taxRate,
    canWrite,
    setTaxRate,
    validUntil,
    setValidUntil,
    selectedBasis,
    busy,
    canSave,
    save
  } = model;

  return (
    <>
      <aside className="quote-summary">
        <span>
          <Receipt size={18} /> {t("계산 미리보기")}
        </span>
        {preview ? <dl>
          <div>
            <dt>{t("항목 합계")}</dt>
            <dd>{formatMoney(preview.subtotal, project.currency)}</dd>
          </div>
          {preview.discountTotal > 0 && <div><dt>{t("할인 금액")}</dt><dd>{formatMoney(preview.discountTotal, project.currency)}</dd></div>}
          <div><dt>{t("위험 대비 금액")} ({Math.round(preview.riskBufferRate * 100)}%)</dt><dd>{formatMoney(preview.riskBufferAmount, project.currency)}</dd></div>
          <div>
            <dt>{t("부가세")}</dt>
            <dd>{formatMoney(preview.taxAmount, project.currency)}</dd>
          </div>
          <div className="quote-total">
            <dt>{t("예상 합계")}</dt>
            <dd>{formatMoney(preview.total, project.currency)}</dd>
          </div>
        </dl> : <p role="status">{t(calculation.loading ? "견적을 계산하고 있습니다." : "항목과 계산 기준을 확인해 주세요.")}</p>}
        {calculation.error && <p role="alert">{t(calculation.error)}<button type="button" className="quiet-button" onClick={calculation.refresh}>{t("다시 확인")}</button></p>}
        {preview && project.budgetMax != null && preview.total > project.budgetMax && <p className="permission-note">{t("예산을 넘습니다. 범위나 예산을 다시 맞춰 주세요.")}</p>}
        <details className="quote-summary-controls workspace-disclosure">
          <summary id="quote-calculation-settings">
            {t("계산 조건")}
            <small>
              {t("세율")}
              {Math.round(taxRate * 100)}%
            </small>
          </summary>
          <label>
            <div>
              <strong>{t("세율")}</strong>
              <small>{t("부가세 적용 비율")}</small>
            </div>
            <div className="quote-tax-control">
              <input
                aria-label={t("세율")}
                type="number"
                min="0"
                max="100"
                step="1"
                readOnly={!canWrite}
                value={Math.round(taxRate * 100)}
                onChange={(event) => setTaxRate(Number(event.target.value) / 100)}
              />
              <span>%</span>
            </div>
          </label>
          <label>
            <div>
              <strong>{t("유효 기간")}</strong>
              <small>{t("고객이 검토할 수 있는 기한")}</small>
            </div>
            <input
              aria-label={t("견적 유효 기간")}
              type="date"
              readOnly={!canWrite}
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          </label>
        </details>
        <p>{t("위험 대비 금액과 세금을 포함하며, 같은 계산 기준으로 저장합니다.")}</p>
        {selectedBasis && (
          <details className="evidence-inspector workspace-disclosure">
            <summary>{t("선택 항목 근거")}</summary>
            <strong>
              {selectedBasis.type === "EVIDENCE" ? selectedBasis.sourceTitle || "제목 없는 근거" : t("확인할 가정")}
            </strong>
            <p>{selectedBasis.content || "근거 또는 가정 내용을 입력하세요."}</p>
            {selectedBasis.type === "EVIDENCE" && (
              <dl>
                <div>
                  <dt>{t("유형")}</dt>
                  <dd>{selectedBasis.sourceType ? sourceTypeLabel[selectedBasis.sourceType] : t("미선택")}</dd>
                </div>
                <div>
                  <dt>{t("참조")}</dt>
                  <dd>{selectedBasis.sourceReference || "미입력"}</dd>
                </div>
                <div>
                  <dt>{t("조회")}</dt>
                  <dd>
                    {selectedBasis.retrievedAt
                      ? new Date(selectedBasis.retrievedAt).toLocaleString("ko-KR")
                      : t("미지정")}
                  </dd>
                </div>
              </dl>
            )}
          </details>
        )}
        {canWrite ? (
          <button type="button" className="primary-button" disabled={busy || !canSave} onClick={() => void save()}>
            {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} {t("검토용 초안 저장")}
          </button>
        ) : (
          <small className="validation-hint">{t("읽기 전용 견적입니다.")}</small>
        )}
        {canWrite && !canSave && !calculation.loading && !calculation.error && (
          <small className="validation-hint">
            {t("모든 항목에 이름, 수량, 단가와 근거 또는 가정을 입력하세요. 근거는 출처 유형과 참조가 필수입니다.")}
          </small>
        )}
      </aside>
    </>
  );
}
