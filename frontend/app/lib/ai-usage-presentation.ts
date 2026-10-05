export type Decimal = number | string;
export interface AiUsageModel {
  provider: string; model: string; catalogued: boolean; enabled: boolean; available: boolean;
  reasoningEfforts: string[]; maxRunUsd: Decimal | null; unavailableReason: string | null;
}
export interface AiUsage {
  currency: "USD";
  limitUsd: Decimal; settledUsd: Decimal; reservedUsd: Decimal; remainingUsd: Decimal;
  remainingPercent: Decimal | null; reservedPercent: Decimal | null;
  periodStart: string; resetAt: string; timezone: "Asia/Seoul";
  spendingEnabled: boolean; models: AiUsageModel[];
}
export interface AiUsageHistoryItem {
  runId: string; workspaceId: string; model: string; status: string; startedAt: string;
  platformCostUsd: Decimal | null; platformReservedUsd: Decimal | null; usageKnown: boolean;
  byokInputTokens: number | null; byokOutputTokens: number | null;
}
const decimal = (value: unknown): value is Decimal => (typeof value === "number" || typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) && Number.isFinite(Number(value)) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
export function parseAiUsage(value: unknown): AiUsage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as AiUsage;
  if (typeof item.spendingEnabled !== "boolean" || !Array.isArray(item.models) || !item.models.every(model => model
    && typeof model.provider === "string" && typeof model.model === "string"
    && [model.catalogued, model.enabled, model.available].every(value => typeof value === "boolean")
    && Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.every(value => typeof value === "string")
    && (model.maxRunUsd === null || decimal(model.maxRunUsd))
    && (model.unavailableReason === null || typeof model.unavailableReason === "string"))) return null;
  if (item.currency !== "USD" || item.timezone !== "Asia/Seoul" || !date(item.periodStart) || !date(item.resetAt)
    || ![item.limitUsd, item.settledUsd, item.reservedUsd, item.remainingUsd].every(decimal)) return null;
  const percentage = (value: unknown) => decimal(value) && Number(value) <= 100;
  if (Number(item.limitUsd) === 0) {
    if (![item.remainingPercent, item.reservedPercent].every(value => value === null || percentage(value) && Number(value) === 0)) return null;
  } else if (!percentage(item.remainingPercent) || !percentage(item.reservedPercent)) return null;
  return item;
}
export function includedUsageBlocker(usage: AiUsage | null, provider: string, model: string): "unverified" | "paused" | "model" | "insufficient" | null {
  if (!usage) return "unverified";
  if (!usage.spendingEnabled) return "paused";
  const selected = usage.models.find(item => item.provider === provider && item.model === model);
  if (!selected?.catalogued || !selected.enabled || !selected.available || selected.maxRunUsd === null || Number(selected.maxRunUsd) <= 0 || !selected.reasoningEfforts.length) return "model";
  return Number(usage.remainingUsd) < Number(selected.maxRunUsd) ? "insufficient" : null;
}
export function formatUsagePercent(value: Decimal | null, locale: string): string {
  if (value === null) return "—";
  const rounded = Math.round(Number(value) * 100) / 100;
  const approximate = rounded !== Number(value);
  return `${approximate ? "≈" : ""}${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rounded)}%`;
}
export function parseAiUsageHistory(value: unknown): { items: AiUsageHistoryItem[]; nextCursor: string | null } | null {
  // Support a plain list or the cursor envelope; unrecognized responses stay unavailable.
  const page = Array.isArray(value) ? { items: value, nextCursor: null } : value as { items?: unknown; nextCursor?: unknown } | null;
  if (!page || !Array.isArray(page.items) || page.nextCursor != null && typeof page.nextCursor !== "string") return null;
  const valid = page.items.every(item => item && [item.runId, item.workspaceId, item.model, item.status].every(value => typeof value === "string")
    && date(item.startedAt) && typeof item.usageKnown === "boolean"
    && [item.platformCostUsd, item.platformReservedUsd].every(value => value === null || decimal(value))
    && [item.byokInputTokens, item.byokOutputTokens].every(value => value == null || Number.isSafeInteger(value) && value >= 0));
  return valid ? { items: page.items, nextCursor: page.nextCursor ?? null } : null;
}
