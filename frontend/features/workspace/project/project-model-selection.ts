import type { AuthSession, Provider } from "../../../app/lib/api";
import { configuredModelOptions } from "../shared/constants";

export interface ProjectModelSelection {
  provider: Provider;
  model: string;
  credentialId: string;
}

export const defaultProjectModelSelection: ProjectModelSelection = {
  provider: "OPENAI",
  model: configuredModelOptions.OPENAI[0] ?? "",
  credentialId: ""
};

export interface ProjectModelSelections {
  revision: symbol;
  values: Record<string, ProjectModelSelection>;
}

// 레이아웃에서 관리하는 임시 상태다. 목록·로그인 경계가 바뀌면
// 이전 콜백을 거부하고 삭제나 재생성이 확인된 ID의 선택을 초기화한다.
export function createProjectModelSelections(): ProjectModelSelections {
  return { revision: Symbol(), values: {} };
}

export function projectModelSelectionKey(session: Pick<AuthSession, "userId" | "workspaceId">, projectId: string, generation: number): string {
  return JSON.stringify([session.userId, session.workspaceId, generation, projectId]);
}

export function updateProjectModelSelection(state: ProjectModelSelections, revision: symbol, key: string, patch: Partial<ProjectModelSelection>): ProjectModelSelections {
  if (state.revision !== revision) return state;
  return {
    ...state,
    values: { ...state.values, [key]: { ...(state.values[key] ?? defaultProjectModelSelection), ...patch } }
  };
}

export function removeProjectModelSelection(state: ProjectModelSelections, key: string): ProjectModelSelections {
  if (!(key in state.values)) return state;
  const values = { ...state.values };
  delete values[key];
  return { ...state, values };
}

export function renewProjectModelSelections(state: ProjectModelSelections, newProjectKey: string): ProjectModelSelections {
  // 새 프로젝트를 만들 때 기존 프로젝트의 개인 키 선택을 버리지 않는다.
  // 새 ID만 초기화하고 버전을 바꿔 해당 ID의 이전 콜백을 무효화한다.
  return { ...removeProjectModelSelection(state, newProjectKey), revision: Symbol() };
}

export function reconcileProjectModelSelections(state: ProjectModelSelections, session: Pick<AuthSession, "userId" | "workspaceId">, projectIds: readonly string[], generation: number): ProjectModelSelections {
  // API에 불변 생성 식별자가 없으므로 목록에 남은 ID의 선택은 유지한다.
  // 한 번 사라진 ID가 재생성되면 이전 선택을 재사용하지 않는다.
  const retained = new Set(projectIds.map((projectId) => projectModelSelectionKey(session, projectId, generation)));
  return {
    revision: Symbol(),
    values: Object.fromEntries(Object.entries(state.values).filter(([key]) => retained.has(key)))
  };
}
