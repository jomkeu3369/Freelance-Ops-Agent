import type { Specification } from "./specification-api";
export interface SpecificationDraft { title: string; bodyText: string }
interface StoredDraft extends SpecificationDraft { contentHash: string }
export function specificationDraftKey(user: string, workspace: string, project: string, id: string) {
  return `freelance-ops-specification-v1:${user}:${workspace}:${project}:${id}`;
}
export function readSpecificationDraft(storage: Storage, key: string, specification: Specification): SpecificationDraft {
  try {
    const saved = JSON.parse(storage.getItem(key) ?? "null") as StoredDraft | null;
    if (saved?.contentHash === specification.contentHash && typeof saved.title === "string" && typeof saved.bodyText === "string"
      && saved.title.length <= 300 && saved.bodyText.length <= 100000) return { title: saved.title, bodyText: saved.bodyText };
  } catch { /* Unavailable session storage never changes the saved version. */ }
  return { title: specification.title, bodyText: specification.bodyText };
}
export function writeSpecificationDraft(storage: Storage, key: string, specification: Specification, draft: SpecificationDraft) {
  try { storage.setItem(key, JSON.stringify({ ...draft, contentHash: specification.contentHash })); } catch { /* Keep editing available. */ }
}
export function forgetSpecificationDraft(storage: Storage, key: string) {
  try { storage.removeItem(key); } catch { /* Session storage is optional. */ }
}
export function specificationRequestId(storage: Storage, key: string, operation: string) {
  const requestKey = `${key}:request`;
  try {
    const saved = JSON.parse(storage.getItem(requestKey) ?? "null") as { operation?: unknown; requestId?: unknown } | null;
    if (saved?.operation === operation && typeof saved.requestId === "string" && /^[a-f0-9-]{36}$/i.test(saved.requestId)) return saved.requestId;
  } catch { /* Server also prevents duplicate generation. */ }
  const requestId = crypto.randomUUID();
  try { storage.setItem(requestKey, JSON.stringify({ operation, requestId })); } catch { /* The caller keeps its in-flight ID. */ }
  return requestId;
}
