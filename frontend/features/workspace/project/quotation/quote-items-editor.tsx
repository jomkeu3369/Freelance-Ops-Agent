import { useT } from "../../../../app/lib/ui-language";
import {
  QuotationItemInput
} from "@/app/lib/api";
import {
  Plus,
  Trash
} from "@phosphor-icons/react";
import { formatMoney } from "../../shared/formatters";
import {
  emptyQuoteItem
} from "./quotation-helpers";
import { QuoteItemBasis } from "./quote-item-basis";

import type { QuoteBuilderModel } from "./use-quote-builder";

export function QuoteItemsEditor({ model }: { model: QuoteBuilderModel }) {
  const t = useT();
  const { items, selectedBasisIndex, setSelectedBasisIndex, canWrite, updateItem, project, setItems } = model;

  const removeItem = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setSelectedBasisIndex((current) => Math.max(0, Math.min(current, items.length - 2)));
  };

  return (
    <>
      <div className="quote-sheet" aria-label={t("견적 항목")}>
        {items.map((item, index) => (
          <details
            className={`quote-item-block${selectedBasisIndex === index ? " selected" : ""}`}
            key={index}
            onFocusCapture={() => setSelectedBasisIndex(index)}
            aria-label={t("{v0}번 견적 항목", { v0: index + 1 })}
          >
            <summary className="quote-item-disclosure">
              <span><small>{t("항목")}{String(index + 1).padStart(2, "0")}</small><strong>{item.title || "새 작업 항목"}</strong></span>
              <span>{formatMoney(item.quantity * item.unitRate * (1 - item.discountRate), project.currency)}<small>{t("상세·근거")}</small></span>
            </summary>
            <div className="quote-row">
              <label className="quote-title-field">
                <span className="quote-field-label">{t("작업 항목")}</span>
                <input
                  value={item.title}
                  readOnly={!canWrite}
                  maxLength={200}
                  placeholder={t("예: 결제 플로우 구현")}
                  onChange={(event) =>
                    updateItem(index, (current) => ({ ...current, title: event.target.value }))
                  }
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
              <label>
                <span className="quote-field-label">{t("단위")}</span>
                <select
                  value={item.unit}
                  disabled={!canWrite || Boolean(item.rateCardId)}
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
              <label>
                <span className="quote-field-label">{t("단가")}</span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  readOnly={!canWrite || Boolean(item.rateCardId)}
                  value={item.unitRate}
                  onChange={(event) =>
                    updateItem(index, (current) => ({ ...current, unitRate: Number(event.target.value) }))
                  }
                />
              </label>
              <label>
                <span className="quote-field-label">{t("할인율 (%)")}</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  readOnly={!canWrite}
                  value={Math.round(item.discountRate * 100)}
                  onChange={(event) =>
                    updateItem(index, (current) => ({
                      ...current,
                      discountRate: Number(event.target.value) / 100
                    }))
                  }
                />
              </label>
              <div className="quote-amount-field">
                <span className="quote-field-label">{t("예상 금액")}</span>
                <div className="quote-amount">
                  <strong>
                    {formatMoney(item.quantity * item.unitRate * (1 - item.discountRate), project.currency)}
                  </strong>
                </div>
              </div>
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
            <Plus size={17} /> {t("작업 항목 추가")}</button>
        )}
      </div>
    </>
  );
}
