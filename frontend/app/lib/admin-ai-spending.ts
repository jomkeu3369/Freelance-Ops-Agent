/** Decimal USD strings are kept exact from input through the reviewed PATCH payload. */
export const MAX_BUDGET_USD = "100000";
export const MAX_MODEL_RUN_USD = "100";
// Existing NUMERIC(19,8) budgets may exceed the newer administrator edit ceiling.
export const MAX_STORED_BUDGET_USD = "99999999999.99999999";

export interface AiSpendingBudgets {
  accountWeekUsd: string;
  globalDayUsd: string;
  globalWeekUsd: string;
}
export interface AiSpendingModel {
  provider: string;
  model: string;
  maxRunUsd: string;
  enabled: boolean;
}
export interface AiSpendingSettings extends AiSpendingBudgets {
  currency: "USD";
  maxBudgetUsd: string;
  maxModelRunUsd: string;
  revision: number;
  updatedAt: string;
  spendingEnabled: boolean;
  models: AiSpendingModel[];
}

function scaledDigits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}${fraction.padEnd(8, "0")}`.replace(/^0+(?=\d)/, "");
}
/** No exponent syntax, signs, whitespace, locale separators, rounding or floating-point math. */
export function parseUsdAmount(value: string, maximum = MAX_BUDGET_USD): string | null {
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,8})?$/.test(value) || !/^(0|[1-9]\d{0,10})(\.\d{1,8})?$/.test(maximum)) return null;
  const amount = scaledDigits(value);
  const max = scaledDigits(maximum);
  if (amount.length > max.length || amount.length === max.length && amount > max) return null;
  return value;
}
export function canonicalUsd(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

// JSON BigDecimal numbers may use 1e-8. Expand that representation as text, never via multiplication.
function responseDecimal(value: unknown, maximum: string): string | null {
  if (typeof value === "string") return parseUsdAmount(value, maximum);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) return null;
  let text = String(value);
  const small = /^(\d)(?:\.(\d+))?e-(\d+)$/.exec(text);
  if (small) {
    const places = Number(small[3]);
    if (places > 8) return null;
    text = `0.${"0".repeat(places - 1)}${small[1]}${small[2] ?? ""}`;
  }
  // Larger monetary JSON numbers may already have lost ledger precision; require exact strings.
  if (maximum === MAX_STORED_BUDGET_USD && parseUsdAmount(text, MAX_BUDGET_USD) === null) return null;
  return parseUsdAmount(text, maximum);
}
export function spendingModelKey(model: Pick<AiSpendingModel, "provider" | "model">): string {
  return JSON.stringify([model.provider, model.model]);
}

/** Fail closed on malformed, legacy-credit or unreviewable settings responses. */
export function parseAiSpendingSettings(value: unknown): AiSpendingSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const maxBudgetUsd = data.maxBudgetUsd === undefined ? MAX_BUDGET_USD : responseDecimal(data.maxBudgetUsd, MAX_BUDGET_USD);
  const maxModelRunUsd = data.maxModelRunUsd === undefined ? MAX_MODEL_RUN_USD : responseDecimal(data.maxModelRunUsd, MAX_MODEL_RUN_USD);
  if (maxBudgetUsd === null || maxModelRunUsd === null) return null;
  const accountWeekUsd = responseDecimal(data.accountWeekUsd, MAX_STORED_BUDGET_USD);
  const globalDayUsd = responseDecimal(data.globalDayUsd, MAX_STORED_BUDGET_USD);
  const globalWeekUsd = responseDecimal(data.globalWeekUsd, MAX_STORED_BUDGET_USD);
  if (data.currency !== "USD" || accountWeekUsd === null || globalDayUsd === null || globalWeekUsd === null
    || typeof data.revision !== "number" || !Number.isSafeInteger(data.revision) || data.revision < 0
    || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))
    || typeof data.spendingEnabled !== "boolean" || !Array.isArray(data.models)) return null;
  const models: AiSpendingModel[] = [];
  for (const model of data.models) {
    if (!model || typeof model !== "object" || typeof model.provider !== "string" || !model.provider.trim()
      || typeof model.model !== "string" || !model.model.trim() || typeof model.enabled !== "boolean") return null;
    const maxRunUsd = responseDecimal(model.maxRunUsd, maxModelRunUsd);
    if (maxRunUsd === null) return null;
    models.push({ provider: model.provider, model: model.model, maxRunUsd, enabled: model.enabled });
  }
  if (new Set(models.map(spendingModelKey)).size !== models.length) return null;
  return { currency: "USD", accountWeekUsd, globalDayUsd, globalWeekUsd, maxBudgetUsd, maxModelRunUsd,
    revision: data.revision, updatedAt: data.updatedAt, spendingEnabled: data.spendingEnabled, models };
}
export function modelStartsPaused(model: AiSpendingModel): boolean {
  return !model.enabled || canonicalUsd(model.maxRunUsd) === "0";
}
export function platformStartsPaused(settings: AiSpendingSettings): boolean {
  return !settings.spendingEnabled || [settings.accountWeekUsd, settings.globalDayUsd, settings.globalWeekUsd].some(value => canonicalUsd(value) === "0");
}
