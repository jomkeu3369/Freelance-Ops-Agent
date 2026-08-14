const DRAFT_VERSION = 1;
const DRAFT_PREFIX = "freelance-ops-quotation-draft-v1";
const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const SCENARIOS = new Set(["LEAN", "RECOMMENDED", "EXPANDED"]);
const UNITS = new Set(["HOUR", "DAY", "FIXED"]);
const BASIS_TYPES = new Set(["ASSUMPTION", "EVIDENCE"]);

const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const nullableString = (value) => value === null || typeof value === "string";

function validItem(item) {
  if (!item || typeof item !== "object" || !item.basis || typeof item.basis !== "object") return false;
  return nullableString(item.rateCardId)
    && typeof item.title === "string"
    && typeof item.description === "string"
    && finiteNumber(item.quantity)
    && UNITS.has(item.unit)
    && finiteNumber(item.unitRate)
    && finiteNumber(item.discountRate)
    && BASIS_TYPES.has(item.basis.type)
    && typeof item.basis.content === "string"
    && nullableString(item.basis.sourceType)
    && nullableString(item.basis.sourceReference)
    && nullableString(item.basis.sourceTitle)
    && nullableString(item.basis.retrievedAt);
}

export function quotationDraftKey(userId, workspaceId, projectId) {
  return `${DRAFT_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(projectId)}`;
}

export function quotationDraftFingerprint(draft) {
  return JSON.stringify({
    scenario: draft.scenario,
    baseQuotationId: draft.baseQuotationId,
    taxRate: draft.taxRate,
    validUntil: draft.validUntil,
    items: draft.items,
  });
}

export function parseQuotationDraft(raw, expected, now = Date.now()) {
  try {
    const draft = JSON.parse(raw);
    const updatedAt = Date.parse(draft.updatedAt);
    if (draft.version !== DRAFT_VERSION
      || draft.workspaceId !== expected.workspaceId
      || draft.projectId !== expected.projectId
      || !SCENARIOS.has(draft.scenario)
      || !nullableString(draft.baseQuotationId)
      || !finiteNumber(draft.taxRate)
      || draft.taxRate < 0
      || draft.taxRate > 1
      || typeof draft.validUntil !== "string"
      || !Array.isArray(draft.items)
      || draft.items.length < 1
      || draft.items.length > 100
      || !draft.items.every(validItem)
      || !Number.isFinite(updatedAt)
      || updatedAt > now + 60_000
      || now - updatedAt > MAX_DRAFT_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

export function createQuotationDraft({ workspaceId, projectId, scenario, baseQuotationId, taxRate, validUntil, items }, now = Date.now()) {
  return {
    version: DRAFT_VERSION,
    workspaceId,
    projectId,
    scenario,
    baseQuotationId,
    taxRate,
    validUntil,
    items,
    updatedAt: new Date(now).toISOString(),
  };
}
