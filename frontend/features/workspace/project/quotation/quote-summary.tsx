import {
  CheckCircle,
  CircleNotch,
  Receipt
} from "@phosphor-icons/react";
import { sourceTypeLabel } from "../../shared/documents";
import { formatMoney } from "../../shared/formatters";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuoteSummary({ model }: { model: QuoteBuilderModel }) {
  const { estimatedSubtotal, project, taxRate, canWrite, setTaxRate, validUntil, setValidUntil, selectedBasis, busy, canSave, save } = model;

  return (
    <>
      <aside className="quote-summary">
        <span>
          <Receipt size={18} /> 계산 미리보기
        </span>
        <dl>
          <div>
            <dt>항목 합계</dt>
            <dd>{formatMoney(estimatedSubtotal, project.currency)}</dd>
          </div>
          <div>
            <dt>부가세</dt>
            <dd>{formatMoney(estimatedSubtotal * taxRate, project.currency)}</dd>
          </div>
          <div className="quote-total">
            <dt>예상 합계</dt>
            <dd>{formatMoney(estimatedSubtotal * (1 + taxRate), project.currency)}</dd>
          </div>
        </dl>
        <section className="quote-summary-controls" aria-labelledby="quote-calculation-settings">
          <span id="quote-calculation-settings">계산 조건</span>
          <label>
            <div>
              <strong>세율</strong>
              <small>부가세 적용 비율</small>
            </div>
            <div className="quote-tax-control">
              <input
                aria-label="세율"
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
              <strong>유효 기간</strong>
              <small>고객이 검토할 수 있는 기한</small>
            </div>
            <input
              aria-label="견적 유효 기간"
              type="date"
              readOnly={!canWrite}
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          </label>
        </section>
        <p>저장할 때 위험 대비 금액과 세금까지 반영한 최종 합계를 다시 확인합니다.</p>
        {selectedBasis && (
          <section className="evidence-inspector">
            <span>선택 항목 근거</span>
            <strong>
              {selectedBasis.type === "EVIDENCE"
                ? selectedBasis.sourceTitle || "제목 없는 근거"
                : "확인할 가정"}
            </strong>
            <p>{selectedBasis.content || "근거 또는 가정 내용을 입력하세요."}</p>
            {selectedBasis.type === "EVIDENCE" && (
              <dl>
                <div>
                  <dt>유형</dt>
                  <dd>{selectedBasis.sourceType ? sourceTypeLabel[selectedBasis.sourceType] : "미선택"}</dd>
                </div>
                <div>
                  <dt>참조</dt>
                  <dd>{selectedBasis.sourceReference || "미입력"}</dd>
                </div>
                <div>
                  <dt>조회</dt>
                  <dd>
                    {selectedBasis.retrievedAt
                      ? new Date(selectedBasis.retrievedAt).toLocaleString("ko-KR")
                      : "미지정"}
                  </dd>
                </div>
              </dl>
            )}
          </section>
        )}
        {canWrite ? (
          <button
            type="button"
            className="primary-button"
            disabled={busy || !canSave}
            onClick={() => void save()}
          >
            {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 검토용 초안 저장
          </button>
        ) : (
          <small className="validation-hint">읽기 전용 견적입니다.</small>
        )}
        {canWrite && !canSave && (
          <small className="validation-hint">
            모든 항목에 이름, 수량, 단가와 근거 또는 가정을 입력하세요. 근거는 출처 유형과 참조가
            필수입니다.
          </small>
        )}
      </aside>
    </>
  );
}
