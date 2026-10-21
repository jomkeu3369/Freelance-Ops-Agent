import { AgentQuotationDraft, Quotation, QuotationItemInput, QuotationPreview, RateCard, type createQuotation } from "../../../../app/lib/api";
import { selectRateCardForDraftItem } from "../../../../app/lib/rate-card-match.mjs";

export function quotationCalculationInput(input: Omit<Parameters<typeof createQuotation>[2], "applyDefaultRiskBuffer">) {
  return {...input, applyDefaultRiskBuffer: true};
}

export function sameQuotationCalculation(left: QuotationPreview, right: QuotationPreview) {
  const values = (value: QuotationPreview) => [value.subtotal, value.discountTotal, value.riskBufferRate,
    value.riskBufferAmount, value.taxRate, value.taxAmount, value.total,
    value.items?.map(item => [item.subtotal, item.discountAmount, item.total])];
  return JSON.stringify(values(left)) === JSON.stringify(values(right));
}

export const emptyQuoteItem = (): QuotationItemInput => ({
  rateCardId: null,
  title: "",
  description: "",
  quantity: 1,
  unit: "HOUR",
  unitRate: 0,
  discountRate: 0,
  basis: {
    type: "ASSUMPTION",
    content: "",
    sourceType: null,
    sourceReference: null,
    sourceTitle: null,
    retrievedAt: null
  }
});

export function quotationItemsAsInput(quotation: Quotation): QuotationItemInput[] {
  return quotation.items.map((item) => ({
    rateCardId: item.rateCardId,
    title: item.title,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitRate: item.unitRate,
    discountRate: item.discountRate,
    basis: { ...item.basis }
  }));
}

export function quotationDraftItems(draft: AgentQuotationDraft, rateCards: RateCard[], currency: string): QuotationItemInput[] {
  return draft.items.map((item) => {
    const card = selectRateCardForDraftItem(item, rateCards, currency) as RateCard | null;
    const hasEvidence = item.basis.type === "EVIDENCE" && Boolean(item.basis.sourceReference?.trim());
    return {
      rateCardId: card?.id ?? null,
      title: item.title,
      description: item.description,
      quantity: item.quantity,
      unit: card?.unit ?? item.unit,
      unitRate: card?.rate ?? 0,
      discountRate: 0,
      basis: {
        type: hasEvidence ? "EVIDENCE" : "ASSUMPTION",
        content: item.basis.content,
        sourceType: hasEvidence ? "EXTERNAL_SOURCE" : null,
        sourceReference: hasEvidence ? item.basis.sourceReference : null,
        sourceTitle: hasEvidence ? item.basis.sourceTitle : null,
        retrievedAt: null
      }
    };
  });
}

export async function copyToClipboard(value: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
