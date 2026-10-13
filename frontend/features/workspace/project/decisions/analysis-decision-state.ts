import type { AgentQuotationDraft } from "@/app/lib/api";
import type { AnalysisDecision, AnalysisSource } from "./analysis-decisions-api";

const scenarios = ["LEAN", "RECOMMENDED", "EXPANDED"] as const;

export function selectableOpinions(source: AnalysisSource | null, projectVersion: number | undefined) {
  if (projectVersion === undefined || !source || source.sourceProjectVersion !== projectVersion || !source.sourceCurrent || source.view.status !== "COMPLETED" || !source.view.result) return [];
  const drafts = source.view.result.quotationDrafts ?? [];
  if (!Array.isArray(drafts) || drafts.length !== 3 || drafts.some(draft => !draft || typeof draft !== "object")
    || new Set(drafts.map(draft => draft.scenario)).size !== 3) return [];
  const opinions = scenarios.flatMap(scenario => {
    const draft = drafts.find(value => value.scenario === scenario);
    const nonblank = (value: unknown): value is string => typeof value === "string" && !!value.trim();
    if (!draft?.petPerspective || !nonblank(draft.petPerspective.proposal) || !nonblank(draft.petPerspective.rationale)
      || !nonblank(draft.petPerspective.tradeoff) || !Array.isArray(draft.items) || !draft.items.length || draft.items.length > 50
      || draft.items.some(item => !item || !nonblank(item.title) || typeof item.quantity !== "number" || !Number.isFinite(item.quantity)
        || item.quantity <= 0 || !["HOUR", "DAY", "FIXED"].includes(item.unit) || !item.basis
        || !["EVIDENCE", "ASSUMPTION"].includes(item.basis.type) || !nonblank(item.basis.content))) return [];
    return [{ id: `${source.runId}:${scenario}`, scenario, draft }];
  });
  return opinions.length === 3 ? opinions : [];
}

export function opinionLabel(scenario: AgentQuotationDraft["scenario"]) {
  return scenario === "LEAN" ? "핵심 범위 관점" : scenario === "RECOMMENDED" ? "권장 범위 관점" : "확장 범위 관점";
}

export function latestFamilyDecision(history: AnalysisDecision[], decision: AnalysisDecision) {
  return history.filter(value => value.familyId === decision.familyId)
    .reduce((latest, value) => value.versionNumber > latest.versionNumber ? value : latest, decision);
}

/** Exact bodies keep an ambiguous retry on its original idempotency key. */
export class DecisionRequestKeys {
  private keys = new Map<string, string>();
  constructor(saved: unknown = null) {
    if (!Array.isArray(saved)) return;
    for (const entry of saved.slice(-20)) {
      if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && entry[0].length <= 110000
        && typeof entry[1] === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(entry[1])) this.keys.set(entry[0], entry[1]);
    }
  }
  requestId(kind: string, input: unknown) {
    const signature = JSON.stringify([kind, input]);
    const existing = this.keys.get(signature);
    if (existing) return existing;
    const id = crypto.randomUUID(); this.keys.set(signature, id); return id;
  }
  settle(kind: string, input: unknown) { this.keys.delete(JSON.stringify([kind, input])); }
  snapshot() { return [...this.keys.entries()].slice(-20); }
}

export function decisionStorageKey(userId: string, workspaceId: string, projectId: string) {
  return `freelance-ops-analysis-decision-v1:${JSON.stringify([userId, workspaceId, projectId])}`;
}

export function restoredDecisionDraft(saved: unknown, decision: AnalysisDecision) {
  if (!saved || typeof saved !== "object") return null;
  const draft = saved as Record<string, unknown>;
  return draft.baseId === decision.id && draft.baseHash === decision.contentHash && typeof draft.bodyText === "string"
    && draft.bodyText.length > 0 && draft.bodyText.length <= 100000 ? draft.bodyText : null;
}
