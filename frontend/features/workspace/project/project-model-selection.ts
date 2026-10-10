import type { AuthSession, Provider } from "../../../app/lib/api";
import { configuredModelOptions } from "../shared/constants";

export interface ProjectModelSelection {
  provider: Provider;
  model: string;
  credentialId: string;
}

export const defaultProjectModelSelection: ProjectModelSelection = {
  provider: "OPENAI", model: configuredModelOptions.OPENAI[0] ?? "", credentialId: ""
};

export interface ProjectModelSelections {
  revision: symbol;
  values: Record<string, ProjectModelSelection>;
}

// The layout owns this ephemeral state. Revisions reject callbacks from before
// a list/login boundary; observed removal or explicit recreation drops the ID.
export function createProjectModelSelections(): ProjectModelSelections {
  return { revision: Symbol(), values: {} };
}

export function projectModelSelectionKey(session: Pick<AuthSession, "userId" | "workspaceId">, projectId: string, generation: number): string {
  return JSON.stringify([session.userId, session.workspaceId, generation, projectId]);
}

export function updateProjectModelSelection(state: ProjectModelSelections, revision: symbol, key: string, patch: Partial<ProjectModelSelection>): ProjectModelSelections {
  if (state.revision !== revision) return state;
  return { ...state, values: { ...state.values, [key]: { ...(state.values[key] ?? defaultProjectModelSelection), ...patch } } };
}

export function removeProjectModelSelection(state: ProjectModelSelections, key: string): ProjectModelSelections {
  if (!(key in state.values)) return state;
  const values = { ...state.values };
  delete values[key];
  return { ...state, values };
}

export function renewProjectModelSelections(state: ProjectModelSelections, newProjectKey: string): ProjectModelSelections {
  // Creating B must not discard A's explicit personal-key choice. Only the new
  // ID starts over; rotating the revision also invalidates its former callbacks.
  return { ...removeProjectModelSelection(state, newProjectKey), revision: Symbol() };
}

export function reconcileProjectModelSelections(state: ProjectModelSelections, session: Pick<AuthSession, "userId" | "workspaceId">, projectIds: readonly string[], generation: number): ProjectModelSelections {
  // The API has no immutable project incarnation. Retain still-present IDs;
  // once an ID is observed absent, a later recreation cannot reuse its choice.
  const retained = new Set(projectIds.map(projectId => projectModelSelectionKey(session, projectId, generation)));
  return { revision: Symbol(), values: Object.fromEntries(Object.entries(state.values).filter(([key]) => retained.has(key))) };
}
