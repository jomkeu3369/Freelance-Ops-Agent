import { useT } from "../../../../app/lib/ui-language";
import { QuotationItemInput } from "@/app/lib/api";
import { CaretDown } from "@phosphor-icons/react";
import { toDateTimeLocal } from "../../shared/formatters";

import type { QuoteBuilderModel } from "./use-quote-builder";

// 기본 메모와 필요할 때 펼치는 할인·출처 설정을 편집합니다.
export function QuoteItemBasis({ model, item, index }: { model: QuoteBuilderModel; item: QuotationItemInput; index: number; }) {
  const t = useT();
  const { items, setItems, canWrite, updateItem } = model;
  const emptyAssumptions = items.filter((candidate, itemIndex) =>
    itemIndex !== index && candidate.basis.type === "ASSUMPTION" && !candidate.basis.content.trim()
  ).length;
  const missingSource = item.basis.type === "EVIDENCE" && (!item.basis.sourceType || !item.basis.sourceReference?.trim());

  return (
    <div className="basis-row quote-basis-editor">
      <div className="basis-copy">
        <div className="basis-copy-heading">
          <label htmlFor={`quotation-basis-${index}`}>
            {item.basis.type === "ASSUMPTION" ? t("가정 내용") : t("근거 내용")}
          </label>
        </div>
        <textarea
          id={`quotation-basis-${index}`}
          rows={2}
          value={item.basis.content}
          readOnly={!canWrite}
          maxLength={3000}
          placeholder={t("이 공수와 단가를 정한 근거 또는 아직 확인되지 않은 가정을 입력하세요.")}
          onChange={(event) =>
            updateItem(index, (current) => ({
              ...current,
              basis: { ...current.basis, content: event.target.value }
            }))
          }
        />
        {canWrite && item.basis.type === "ASSUMPTION" && item.basis.content.trim() && emptyAssumptions > 0 && (
          <button
            type="button"
            className="quiet-button quote-reuse-assumption"
            onClick={() => setItems((current) => current.map((candidate, itemIndex) =>
              itemIndex !== index && candidate.basis.type === "ASSUMPTION" && !candidate.basis.content.trim()
                ? { ...candidate, basis: { ...candidate.basis, content: item.basis.content } }
                : candidate
            ))}
          >
            {t("{count}개 빈 항목에 같은 가정 적용", { count: emptyAssumptions })}
          </button>
        )}
      </div>
      <details className="workspace-disclosure quote-item-options">
        <summary>
          {t("할인·출처 설정")}
          <small>
            {missingSource ? t("출처 확인 필요") : item.basis.type === "EVIDENCE" ? t("검증된 근거") : t("확인이 필요한 가정")}
            {item.discountRate > 0 && <> · {t("할인 {rate}%", { rate: Math.round(item.discountRate * 100) })}</>}
          </small>
        </summary>
        <div className="quote-option-fields">
          <label className="quote-select-control">
            <span>{t("할인율 (%)")}</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              readOnly={!canWrite}
              value={Math.round(item.discountRate * 100)}
              onChange={(event) => updateItem(index, (current) => ({ ...current, discountRate: Number(event.target.value) / 100 }))}
            />
          </label>
          <label className="quote-select-control">
            <span>{t("산정 근거")}</span>
            <div>
              <select
                aria-label={t("근거 유형")}
                value={item.basis.type}
                disabled={!canWrite}
                onChange={(event) =>
                  updateItem(index, (current) => ({
                    ...current,
                    basis:
                      event.target.value === "ASSUMPTION"
                        ? {
                            type: "ASSUMPTION",
                            content: current.basis.content,
                            sourceType: null,
                            sourceReference: null,
                            sourceTitle: null,
                            retrievedAt: null
                          }
                        : { ...current.basis, type: "EVIDENCE" }
                  }))
                }
              >
                <option value="ASSUMPTION">{t("확인이 필요한 가정")}</option>
                <option value="EVIDENCE">{t("검증된 근거")}</option>
              </select>
              <CaretDown size={16} aria-hidden="true" />
            </div>
            <small>
              {item.basis.type === "ASSUMPTION"
                ? t("저장 전 확인이 필요한 조건입니다.")
                : t("출처 정보와 함께 저장됩니다.")}
            </small>
          </label>
          {item.basis.type === "EVIDENCE" && (
            <div className="evidence-fields">
              <label>
                <span>{t("출처 유형")}</span>
                <select
                  required
                  aria-label={t("출처 유형")}
                  value={item.basis.sourceType ?? ""}
                  disabled={!canWrite}
                  onChange={(event) =>
                    updateItem(index, (current) => ({
                      ...current,
                      basis: {
                        ...current.basis,
                        sourceType: event.target.value as NonNullable<QuotationItemInput["basis"]["sourceType"]>
                      }
                    }))
                  }
                >
                  <option value="">{t("선택")}</option>
                  <option value="PAST_PROJECT">{t("과거 프로젝트")}</option>
                  <option value="POLICY">{t("내부 정책")}</option>
                  <option value="PLATFORM_TERMS">{t("플랫폼 약관")}</option>
                  <option value="USER_TEMPLATE">{t("사용자 자료")}</option>
                  <option value="EXTERNAL_SOURCE">{t("외부 자료")}</option>
                </select>
              </label>
              <label>
                <span>{t("출처 참조")}</span>
                <input
                  required
                  maxLength={1000}
                  readOnly={!canWrite}
                  value={item.basis.sourceReference ?? ""}
                  placeholder={t("문서 ID 또는 원문 URL")}
                  onChange={(event) =>
                    updateItem(index, (current) => ({
                      ...current,
                      basis: { ...current.basis, sourceReference: event.target.value }
                    }))
                  }
                />
              </label>
              <label>
                <span>{t("출처 제목")}</span>
                <input
                  maxLength={300}
                  readOnly={!canWrite}
                  value={item.basis.sourceTitle ?? ""}
                  onChange={(event) =>
                    updateItem(index, (current) => ({
                      ...current,
                      basis: { ...current.basis, sourceTitle: event.target.value || null }
                    }))
                  }
                />
              </label>
              <label>
                <span>{t("조회 시점")}</span>
                <input
                  type="datetime-local"
                  readOnly={!canWrite}
                  value={toDateTimeLocal(item.basis.retrievedAt)}
                  onChange={(event) =>
                    updateItem(index, (current) => ({
                      ...current,
                      basis: {
                        ...current.basis,
                        retrievedAt: event.target.value ? new Date(event.target.value).toISOString() : null
                      }
                    }))
                  }
                />
              </label>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
