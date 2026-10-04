import type { CreditQuote, Provider } from "./api";
export interface PendingRunInput { userId: string; workspaceId: string; projectId: string; provider: Provider; model: string; credentialId?: string; message: string; creditQuote?: CreditQuote; }
export interface PendingRunRetry extends PendingRunInput { id: string; }
interface Entry { signature: string; request: PendingRunRetry; uncertain: boolean; }

/** Ambiguous retries retain the first authorized body, including its exact price version. */
export class PendingRunStore {
  private entries = new Map<string, Entry>();
  getOrCreate(input: PendingRunInput): PendingRunRetry {
    const signature = JSON.stringify([input.userId, input.workspaceId, input.projectId, input.provider, input.model, input.credentialId ?? null, input.message]);
    const previous = this.entries.get(signature);
    if (previous) return previous.request;
    const request = { ...input, id: crypto.randomUUID(), creditQuote: input.credentialId ? undefined : input.creditQuote ? { ...input.creditQuote } : undefined };
    this.entries.set(signature, { signature, request, uncertain: false });
    return request;
  }
  settle(id: string, outcome: "accepted" | "rejected" | "uncertain") {
    for (const [signature, entry] of this.entries) {
      if (entry.request.id !== id) continue;
      if (outcome === "uncertain") entry.uncertain = true;
      else this.entries.delete(signature);
      break;
    }
  }
  retries(): PendingRunRetry[] { return [...this.entries.values()].filter(entry => entry.uncertain).map(entry => ({ ...entry.request })); }
  clear() { this.entries.clear(); }
}
