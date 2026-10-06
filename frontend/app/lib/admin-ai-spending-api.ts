import { request, type AuthSession } from "./api";
import type { AiSpendingBudgets, AiSpendingModel } from "./admin-ai-spending";

export function getAiSpendingSettings(session: AuthSession): Promise<unknown> {
  return request("/api/v2/admin/ai-spending", { cache: "no-store" }, session.accessToken);
}
// Never replay a settings write automatically after a 401 or account/session rotation.
// A fresh read can recover authentication before the administrator reviews a new write.
export function updateAiSpendingBudgets(session: AuthSession, expectedRevision: number, budgets: AiSpendingBudgets): Promise<unknown> {
  return request("/api/v2/admin/ai-spending", {
    method: "PATCH", body: JSON.stringify({ ...budgets, expectedRevision })
  }, session.accessToken, false);
}
export function updateAiSpendingModel(session: AuthSession, expectedRevision: number, model: AiSpendingModel): Promise<unknown> {
  return request("/api/v2/admin/ai-spending/models", {
    method: "PATCH", body: JSON.stringify({ ...model, expectedRevision })
  }, session.accessToken, false);
}
