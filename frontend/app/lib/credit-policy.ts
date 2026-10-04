import type { CreditModelRate, CreditQuote, FreeUsage, FreeUsageSettings } from "./api";

export interface WeeklyCreditUsage extends FreeUsage {
  unit: "CREDITS";
  periodType: "WEEKLY";
  modelRates: CreditModelRate[];
  pricingUpdatedAt: string;
}
export interface WeeklyCreditSettings extends FreeUsageSettings {
  unit: "CREDITS";
  periodType: "WEEKLY";
  modelRates: CreditModelRate[];
}
const integer = (value: unknown, minimum = 0) => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
function rates(value: unknown): value is CreditModelRate[] {
  return Array.isArray(value) && value.every(rate => rate && typeof rate === "object" && typeof rate.provider === "string" && typeof rate.model === "string" && rate.model.length > 0 && integer(rate.credits, 1) && rate.credits <= 100000 && typeof rate.enabled === "boolean")
    && new Set(value.map(rate => `${rate.provider}:${rate.model}`)).size === value.length;
}
export function isWeeklyCreditUsage(value: unknown): value is WeeklyCreditUsage {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<WeeklyCreditUsage>;
  return data.unit === "CREDITS" && data.periodType === "WEEKLY"
    && [data.limit, data.used, data.reserved, data.remaining, data.epoch].every(value => integer(value))
    && data.remaining === Math.max(0, data.limit! - data.used! - data.reserved!)
    && date(data.resetAt) && date(data.pricingUpdatedAt) && typeof data.period === "string"
    && data.timezone === "Asia/Seoul" && typeof data.canManage === "boolean" && rates(data.modelRates);
}
export function isWeeklyCreditSettings(value: unknown): value is WeeklyCreditSettings {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<WeeklyCreditSettings>;
  return data.unit === "CREDITS" && data.periodType === "WEEKLY" && rates(data.modelRates)
    && integer(data.limit) && integer(data.maxLimit) && data.limit! <= data.maxLimit! && integer(data.epoch) && date(data.updatedAt);
}
export type CreditDecision = { kind: "byok" | "unavailable" | "disabled" }
  | { kind: "ready" | "insufficient"; quote: CreditQuote; remaining: number };
export function creditDecision(data: unknown, provider: string, model: string, credentialId?: string): CreditDecision {
  if (credentialId) return { kind: "byok" };
  if (!isWeeklyCreditUsage(data)) return { kind: "unavailable" };
  const rate = data.modelRates.find(rate => rate.provider === provider && rate.model === model);
  if (!rate?.enabled) return { kind: "disabled" };
  return { kind: data.remaining >= rate.credits ? "ready" : "insufficient", quote: { credits: rate.credits, pricingUpdatedAt: data.pricingUpdatedAt }, remaining: data.remaining };
}
