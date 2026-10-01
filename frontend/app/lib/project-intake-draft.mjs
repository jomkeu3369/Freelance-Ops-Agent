// Keep raw strings until submission so closing a dialog never changes the user's work.
export function createProjectIntakeDraft() {
  return { title: "", requirementText: "", clientId: "", currency: "KRW", deadline: "", budgetMin: "", budgetMax: "" };
}

/** @param {FormData} data */
export function readProjectIntakeDraft(data) {
  const draft = createProjectIntakeDraft();
  for (const field of Object.keys(draft)) {
    draft[field] = String(data.get(field) ?? draft[field]);
  }
  return draft;
}

/** @param {ReturnType<typeof createProjectIntakeDraft>} draft */
export function hasProjectIntakeDraft(draft) {
  const empty = createProjectIntakeDraft();
  return Object.keys(empty).some((field) => draft[field] !== empty[field]);
}

/** @param {{userId: string, workspaceId: string}} session */
export function projectIntakeDraftScope(session) {
  return JSON.stringify([session.userId, session.workspaceId]);
}
