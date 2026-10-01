import { useT } from "../../../../app/lib/ui-language";
import {
  QuotationItemInput
} from "@/app/lib/api";
import {
  CaretDown,
  CircleNotch,
  Waveform
} from "@phosphor-icons/react";
import { formatMoney, toDateTimeLocal } from "../../shared/formatters";

import type { QuoteBuilderModel } from "./use-quote-builder";


// 단가와 산정 근거를 하나의 작업 항목에 적용합니다.
export function QuoteItemBasis({ model, item, index }: { model: QuoteBuilderModel; item: QuotationItemInput; index: number }) {
  const t = useT();
  const { rateCards, canWrite, updateItem, project, assumptionBusyIndex, modelSelection, suggestAssumption } = model;

  const selectRateCard = (rateCardId: string) => {
    const card = rateCards.find((candidate) => candidate.id === rateCardId);
    updateItem(index, (current) => {
      if (card) {
        return { ...current, rateCardId: card.id, unit: card.unit, unitRate: card.rate };
      }
      return { ...current, rateCardId: null };
    });
  };

  return (
    <div className="basis-row">
      <label className="quote-select-control">
        <span>{t("단가 기준")}</span>
        <div>
          <select
            aria-label={t("서비스 단가표")}
            value={item.rateCardId ?? ""}
            disabled={!canWrite}
            onChange={(event) => selectRateCard(event.target.value)}
          >
            <option value="">{t("직접 입력")}</option>
            {rateCards
              .filter((card) => card.currency === project.currency)
              .map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name} · {formatMoney(card.rate, card.currency)}
                </option>
              ))}
          </select>
          <CaretDown size={16} aria-hidden="true" />
        </div>
        <small>
          {item.rateCardId
            ? t("등록된 단가가 적용되었습니다.")
            : t("적합한 단가를 선택하거나 직접 입력하세요.")}
        </small>
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
      <div className="basis-copy">
        <div className="basis-copy-heading">
          <label htmlFor={`quotation-basis-${index}`}>
            {item.basis.type === "ASSUMPTION" ? t("가정 내용") : t("근거 내용")}
          </label>
          {canWrite && item.basis.type === "ASSUMPTION" && (
            <button
              type="button"
              className="ai-assumption-button"
              disabled={
                assumptionBusyIndex !== null || !item.title.trim() || !modelSelection.model.trim()
              }
              onClick={() => void suggestAssumption(index)}
            >
              {assumptionBusyIndex === index ? (
                <CircleNotch className="spin" size={15} />
              ) : (
                <Waveform size={15} />
              )}{" "}
              {item.basis.content.trim() ? t("AI로 다듬기") : t("AI로 제안받기")}
            </button>
          )}
        </div>
        <textarea
          id={`quotation-basis-${index}`}
          rows={3}
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
      </div>
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
                    sourceType: event.target.value as NonNullable<
                      QuotationItemInput["basis"]["sourceType"]
                    >
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
                    retrievedAt: event.target.value
                      ? new Date(event.target.value).toISOString()
                      : null
                  }
                }))
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
