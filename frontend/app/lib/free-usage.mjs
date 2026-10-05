export const FREE_USAGE_EXHAUSTED = "FREE_USAGE_EXHAUSTED";

export function parseFreeUsageLimit(value, maxLimit) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(maxLimit) || maxLimit < 0) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 0 && limit <= maxLimit ? limit : null;
}

// Never pass an arbitrary returnTo URL to the router or a link.
export function freeUsageReturnPath(value) {
  return typeof value === "string" && /^\/workspace\/projects\/[a-zA-Z0-9_-]+\/(?:agent|intake|quote|outcome)$/.test(value)
    ? value : null;
}

export function freeUsageResetLabel(resetAt, locale) {
  if (typeof resetAt !== "string" || !Number.isFinite(Date.parse(resetAt))) return null;
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(resetAt));
}
