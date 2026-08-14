const MAX_TIMER_DELAY_MS = 2_147_000_000;
const REFRESH_EARLY_MS = 60_000;

export function sessionRefreshDelay(expiresAt, now = Date.now()) {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return 1_000;
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(1_000, expiresAtMs - now - REFRESH_EARLY_MS));
}
