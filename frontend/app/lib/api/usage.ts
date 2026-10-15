import type { AuthSession } from "./contracts/auth";
import type { CreditModelRate, FreeUsage, FreeUsageSettings } from "./contracts/usage";
import { request } from "./http";

export function getFreeUsage(session: AuthSession): Promise<FreeUsage> {
  return request("/api/v2/usage/free", { cache: "no-store" }, session.accessToken);
}

// 사용량 응답은 화면 어댑터에서 계약을 확인한 뒤 표시한다.
export function getAiUsage(session: AuthSession): Promise<unknown> {
  return request("/api/v2/me/ai-usage", { cache: "no-store" }, session.accessToken);
}

export function getAiUsageHistory(session: AuthSession, cursor?: string): Promise<unknown> {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return request(`/api/v2/me/ai-usage/history?${query}`, { cache: "no-store" }, session.accessToken);
}

export function getFreeUsageSettings(session: AuthSession): Promise<FreeUsageSettings> {
  return request("/api/v2/admin/free-usage", { cache: "no-store" }, session.accessToken);
}

export function updateFreeUsageLimit(session: AuthSession, settings: FreeUsageSettings, limit: number): Promise<FreeUsageSettings> {
  return request(
    "/api/v2/admin/free-usage",
    {
      method: "PATCH",
      body: JSON.stringify({ limit, expectedEpoch: settings.epoch, expectedUpdatedAt: settings.updatedAt })
    },
    session.accessToken
  );
}

export function updateFreeModelRate(session: AuthSession, settings: FreeUsageSettings, rate: CreditModelRate): Promise<FreeUsageSettings> {
  return request(
    "/api/v2/admin/free-usage/models",
    {
      method: "PATCH",
      body: JSON.stringify({ ...rate, expectedEpoch: settings.epoch, expectedUpdatedAt: settings.updatedAt })
    },
    session.accessToken
  );
}

export function resetAllFreeUsage(session: AuthSession, settings: FreeUsageSettings): Promise<FreeUsageSettings> {
  return request(
    "/api/v2/admin/free-usage/reset",
    {
      method: "POST",
      body: JSON.stringify({
        confirmation: "RESET_ALL_FREE_USAGE",
        expectedEpoch: settings.epoch,
        expectedUpdatedAt: settings.updatedAt
      })
    },
    session.accessToken
  );
}
