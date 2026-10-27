import { useT } from "../../../../app/lib/ui-language";
import { QuotationItemInput } from "@/app/lib/api";
import { CaretDown, Plus, Trash } from "@phosphor-icons/react";
import { formatMoney } from "../../shared/formatters";
import { emptyQuoteItem } from "./quotation-helpers";
import { QuoteItemBasis } from "./quote-item-basis";
import { useId } from "react";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuoteItemsEditor({ model }: { model: QuoteBuilderModel }) {
  const t = useT();
  const disclosureGroup = useId();
  const { items, selectedBasisIndex, setSelectedBasisIndex, canWrite, updateItem, project, setItems, preview, rateCards } = model;
  const availableRates = rateCards.filter((card) => card.currency === project.currency);
  const unitLabel = (unit: QuotationItemInput["unit"]) => unit === "HOUR" ? t("시간") : unit === "DAY" ? t("작업일") : t("고정");
  const amount = (index: number) => preview?.items?.[index]
    ? formatMoney(preview.items[index].total, project.currency) : t("계산 확인 중");

  const removeItem = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setSelectedBasisIndex((current) => Math.max(0, Math.min(current, items.length - 2)));
  };

  const selectRateCard = (index: number, rateCardId: string) => {
    const card = availableRates.find((candidate) => candidate.id === rateCardId);
    updateItem(index, (current) => card
      ? { ...current, rateCardId: card.id, title: current.title.trim() ? current.title : card.name, unit: card.unit, unitRate: card.rate }
      : { ...current, rateCardId: null });
  };

  return (
    <>
      <div className="quote-sheet" aria-label={t("견적 항목")}>
        <div className="quote-ledger-heading" aria-hidden="true"><span>{t("작업 항목")}</span><span>{t("금액")}</span></div>
        {items.map((item, index) => (
          <details
            className={`quote-item-block${selectedBasisIndex === index ? " selected" : ""}`}
            key={index}
            name={disclosureGroup}
            onFocusCapture={() => setSelectedBasisIndex(index)}
            aria-label={t("{v0}번 견적 항목", { v0: index + 1 })}
          >
            <summary className="quote-item-disclosure">
              <span className="quote-item-name">
                <small className="quote-item-index">{String(index + 1).padStart(2, "0")}</small>
                <span><strong>{item.title || t("새 작업 항목")}</strong><small>{t("상세·근거")}</small></span>
              </span>
              <span className="quote-item-total">
                {amount(index)}
              </span>
              <CaretDown className="quote-item-caret" size={18} aria-hidden="true" />
            </summary>
            <div className={`quote-row quote-basic-fields${item.rateCardId ? " quote-linked-rate" : ""}`}>
              <label className="quote-select-control quote-rate-selector">
                <span>{t("단가 기준")}</span>
                <div>
                  <select
                    aria-label={t("서비스 단가표")}
                    value={item.rateCardId ?? ""}
                    disabled={!canWrite}
                    onChange={(event) => selectRateCard(index, event.target.value)}
                  >
                    <option value="">{t("직접 입력")}</option>
                    {item.rateCardId && !availableRates.some((card) => card.id === item.rateCardId) && (
                      <option value={item.rateCardId}>{t("저장된 단가")}</option>
                    )}
                    {availableRates.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.name} · {formatMoney(card.rate, card.currency)} / {unitLabel(card.unit)}
                      </option>
                    ))}
                  </select>
                  <CaretDown size={16} aria-hidden="true" />
                </div>
              </label>
              <label className="quote-title-field">
                <span className="quote-field-label">{t("작업 항목")}</span>
                <input
                  value={item.title}
                  readOnly={!canWrite}
                  maxLength={200}
                  placeholder={t("예: 결제 플로우 구현")}
                  onChange={(event) => updateItem(index, (current) => ({ ...current, title: event.target.value }))}
                />
              </label>
              <label>
                <span className="quote-field-label">{t("수량")}</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  readOnly={!canWrite}
                  value={item.quantity}
                  onChange={(event) =>
                    updateItem(index, (current) => ({ ...current, quantity: Number(event.target.value) }))
                  }
                />
              </label>
              {!item.rateCardId && (
                <label>
                  <span className="quote-field-label">{t("단위")}</span>
                  <select
                    value={item.unit}
                    disabled={!canWrite}
                    onChange={(event) =>
                      updateItem(index, (current) => ({
                        ...current,
                        unit: event.target.value as QuotationItemInput["unit"]
                      }))
                    }
                  >
                    <option value="HOUR">{t("시간")}</option>
                    <option value="DAY">{t("일")}</option>
                    <option value="FIXED">{t("고정")}</option>
                  </select>
                </label>
              )}
              {item.rateCardId ? (
                <div className="quote-applied-rate">
                  <span className="quote-field-label">{t("단가")}</span>
                  <strong>{formatMoney(item.unitRate, project.currency)} / {unitLabel(item.unit)}</strong>
                </div>
              ) : (
                <label>
                  <span className="quote-field-label">{t("단가")}</span>
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    readOnly={!canWrite}
                    value={item.unitRate}
                    onChange={(event) =>
                      updateItem(index, (current) => ({ ...current, unitRate: Number(event.target.value) }))
                    }
                  />
                </label>
              )}
              <button
                type="button"
                className="remove-item"
                aria-label={t("{v0}번 항목 삭제", { v0: index + 1 })}
                disabled={!canWrite || items.length === 1}
                onClick={() => removeItem(index)}
              >
                <Trash size={17} />
              </button>
            </div>
            <QuoteItemBasis model={model} item={item} index={index} />
          </details>
        ))}
        {canWrite && (
          <button
            type="button"
            className="add-row"
            onClick={() => setItems((current) => [...current, emptyQuoteItem()])}
          >
            <Plus size={17} /> {t("작업 항목 추가")}
          </button>
        )}
      </div>
    </>
  );
}
