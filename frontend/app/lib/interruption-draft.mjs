const DRAFT_VERSION = 1;
const DRAFT_PREFIX = "freelance-ops-interruption-draft-v1";
const MAX_DRAFT_AGE_MS = 24 * 60 * 60 * 1_000;

export function interruptionDraftKey(userId, workspaceId, runId, interruptionId) {
  return [DRAFT_PREFIX, userId, workspaceId, runId, interruptionId]
    .map((part, index) => index === 0 ? part : encodeURIComponent(part))
    .join(":");
}

export function createInterruptionDraft({ workspaceId, runId, interruptionId, questions, answers }, now = Date.now()) {
  return {
    version: DRAFT_VERSION,
    workspaceId,
    runId,
    interruptionId,
    questions,
    answers,
    updatedAt: new Date(now).toISOString(),
  };
}

export function parseInterruptionDraft(raw, expected, now = Date.now()) {
  try {
    const draft = JSON.parse(raw);
    const updatedAt = Date.parse(draft.updatedAt);
    if (draft.version !== DRAFT_VERSION
      || draft.workspaceId !== expected.workspaceId
      || draft.runId !== expected.runId
      || draft.interruptionId !== expected.interruptionId
      || !Array.isArray(draft.questions)
      || !Array.isArray(draft.answers)
      || draft.questions.length !== expected.questions.length
      || draft.answers.length !== expected.questions.length
      || !draft.questions.every((question, index) => typeof question === "string" && question === expected.questions[index])
      || !draft.answers.every((answer) => typeof answer === "string")
      || !Number.isFinite(updatedAt)
      || updatedAt > now + 60_000
      || now - updatedAt > MAX_DRAFT_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}
