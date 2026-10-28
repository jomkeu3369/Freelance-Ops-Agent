import type { ActualOutcome } from "../../../../app/lib/api";

export interface OutcomeDraft {
  revision: string;
  baseId: string | null;
  baseVersion: number | null;
  approvedQuotationId: string;
  totalRevenue: string;
  actualCost: string;
  actualHours: string;
  completedOn: string;
  changeReason: string;
  workItems: Array<{ title: string; actualHours: string; actualCost: string; notes: string }>;
}

// 저장소를 사용할 수 없어도 같은 탭의 화면 이동에서는 입력을 유지한다.
const memoryDrafts = new Map<string, string | null>();
const unavailableDrafts = new Set<string>();

export function outcomeDraftFromResult(outcome: ActualOutcome | null): OutcomeDraft {
  return {
    revision: "", baseId: outcome?.id ?? null, baseVersion: outcome?.version ?? null,
    approvedQuotationId: outcome?.approvedQuotationId ?? "",
    totalRevenue: outcome ? String(outcome.totalRevenue) : "", actualCost: outcome ? String(outcome.actualCost) : "",
    actualHours: outcome ? String(outcome.actualHours) : "", completedOn: outcome?.completedOn ?? "",
    changeReason: outcome?.changeReason ?? "",
    workItems: outcome?.workItems.map((item) => ({ title: item.title, actualHours: String(item.actualHours), actualCost: String(item.actualCost), notes: item.notes ?? "" })) ?? []
  };
}

export function readOutcomeDraft(key: string): { draft: OutcomeDraft | null; unavailable: boolean; cleanupPending: boolean } {
  let raw = memoryDrafts.get(key) ?? null;
  let unavailable = unavailableDrafts.has(key);
  const cleanupPending = memoryDrafts.has(key) && raw === null;
  try { if (!memoryDrafts.has(key)) raw = window.sessionStorage.getItem(key); } catch { unavailable = true; }
  if (!raw) return { draft: null, unavailable, cleanupPending };
  try {
    const draft = JSON.parse(raw);
    if (draft && draft.version === 1 && typeof draft.revision === "string" &&
      (draft.baseId === null || typeof draft.baseId === "string") &&
      (draft.baseVersion === null || Number.isSafeInteger(draft.baseVersion) && draft.baseVersion >= 0) &&
      [draft.approvedQuotationId, draft.totalRevenue, draft.actualCost, draft.actualHours, draft.completedOn, draft.changeReason].every((value) => typeof value === "string") &&
      Array.isArray(draft.workItems) && draft.workItems.length <= 500 && draft.workItems.every((item: OutcomeDraft["workItems"][number]) =>
        item && [item.title, item.actualHours, item.actualCost, item.notes].every((value) => typeof value === "string"))) return { draft, unavailable, cleanupPending };
  } catch { /* 잘못된 저장 자료는 편집기에 적용하지 않는다. */ }
  return { draft: null, unavailable, cleanupPending };
}

export function writeOutcomeDraft(key: string, draft: OutcomeDraft): boolean {
  const raw = JSON.stringify({ ...draft, version: 1 });
  memoryDrafts.set(key, raw);
  try { window.sessionStorage.setItem(key, raw); unavailableDrafts.delete(key); return true; }
  catch { unavailableDrafts.add(key); return false; }
}

export function clearOutcomeDraft(key: string, revision: string): { cleared: boolean; unavailable: boolean } {
  const current = readOutcomeDraft(key);
  if (current.draft?.revision !== revision) return { cleared: false, unavailable: current.unavailable };
  try {
    window.sessionStorage.removeItem(key);
    memoryDrafts.delete(key);
    unavailableDrafts.delete(key);
    return { cleared: true, unavailable: false };
  } catch {
    // 같은 탭에서는 이전 저장소 값이 다시 나타나지 않게 한다. 재시작 후에는 정리를 보장하지 못한다.
    memoryDrafts.set(key, null);
    unavailableDrafts.add(key);
    return { cleared: true, unavailable: true };
  }
}
