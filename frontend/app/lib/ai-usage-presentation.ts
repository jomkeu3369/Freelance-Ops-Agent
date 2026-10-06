export type Decimal = number | string;
export interface AiUsageModel {
  provider: string; model: string; catalogued: boolean; enabled: boolean; available: boolean;
  providerAccessVerified: boolean; reasoningEfforts: string[]; maxRunUsd: Decimal | null; unavailableReason: string | null;
}
export interface AiUsage {
  currency: "USD";
  limitUsd: Decimal; settledUsd: Decimal; reservedUsd: Decimal; remainingUsd: Decimal;
  remainingPercent: Decimal | null; reservedPercent: Decimal | null;
  periodStart: string; resetAt: string; timezone: "Asia/Seoul";
  spendingEnabled: boolean; models: AiUsageModel[];
}
export interface AiUsageHistoryItem {
  runId: string; model: string; status: string; startedAt: string;
  platformCostUsd: Decimal | null; platformReservedUsd: Decimal | null; usageKnown: boolean;
  byokInputTokens: number | null; byokOutputTokens: number | null;
  providerCalls?: { fundingSource: string; usageKnown: boolean }[];
}
const decimal = (value: unknown): value is Decimal => (typeof value === "number" || typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) && Number.isFinite(Number(value)) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
export function parseAiUsage(value: unknown): AiUsage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as AiUsage;
  if (typeof item.spendingEnabled !== "boolean" || !Array.isArray(item.models) || !item.models.every(model => model
    && typeof model.provider === "string" && typeof model.model === "string"
    && [model.catalogued, model.enabled, model.available, model.providerAccessVerified].every(value => typeof value === "boolean")
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
/** Presentation follows the same catalog guard as Send; provider access is separate. */
export function isUsageModelSelectable(model: AiUsageModel): boolean {
  return model.catalogued && model.enabled && model.available && model.maxRunUsd !== null
    && Number(model.maxRunUsd) > 0 && model.reasoningEfforts.some(effort => effort.toUpperCase() === "LOW");
}
export function modelUnavailableMessage(reason: string | null): string {
  return ({
    SPENDING_DISABLED: "기본 제공 AI 실행이 현재 중지되어 있습니다.",
    MODEL_DISABLED: "이 모델은 현재 기본 제공 AI에서 비활성화되어 있습니다.",
    TARIFF_REVIEW_REQUIRED: "요금 검토가 끝날 때까지 이 모델을 사용할 수 없습니다.",
    ACCOUNT_BUDGET_EXHAUSTED: "기본 제공 AI의 주간 잔여 예산이 없습니다.",
    GLOBAL_BUDGET_EXHAUSTED: "서비스 운영 예산이 소진되어 기본 제공 AI를 사용할 수 없습니다.",
  } as Record<string, string>)[reason ?? ""] ?? "모델 지원 상태와 예약 상한을 확인해야 합니다.";
}
export function reasoningEffortLabel(effort: string): string {
  return ({ NONE: "없음", MINIMAL: "최소", LOW: "낮음", MEDIUM: "보통", HIGH: "높음", XHIGH: "매우 높음" } as Record<string, string>)[effort.toUpperCase()] ?? "확인 필요";
}
export function includedUsageBlocker(usage: AiUsage | null, provider: string, model: string): "unverified" | "paused" | "model" | "insufficient" | null {
  if (!usage) return "unverified";
  if (!usage.spendingEnabled) return "paused";
  const selected = usage.models.find(item => item.provider === provider && item.model === model);
  if (!selected || !isUsageModelSelectable(selected)) return "model";
  return Number(usage.remainingUsd) <= 0 ? "insufficient" : null;
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
  const valid = page.items.every(item => item && [item.runId, item.model, item.status].every(value => typeof value === "string")
    && (item.providerCalls == null || Array.isArray(item.providerCalls) && item.providerCalls.every((call: { fundingSource?: unknown; usageKnown?: unknown }) => call && ["PLATFORM", "BYOK"].includes(String(call.fundingSource)) && typeof call.usageKnown === "boolean"))
    && date(item.startedAt) && typeof item.usageKnown === "boolean"
    && [item.platformCostUsd, item.platformReservedUsd].every(value => value === null || decimal(value))
    && [item.byokInputTokens, item.byokOutputTokens].every(value => value == null || Number.isSafeInteger(value) && value >= 0));
  return valid ? { items: page.items, nextCursor: page.nextCursor ?? null } : null;
}
