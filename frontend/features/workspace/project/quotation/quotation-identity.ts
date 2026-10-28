import type { Quotation } from "../../../../app/lib/api";

export function quotationIdentity(quotation: Quotation, locale: "ko" | "en") {
  const created = new Date(quotation.createdAt);
  const date = Number.isNaN(created.getTime()) ? "—" : new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(created);
  return `${date} · ID ${quotation.id}`;
}
