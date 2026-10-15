import type { Project } from "../../../app/lib/api";

// 상태만 변경해도 API는 전체 프로젝트를 반환한다. 늦게 도착한 응답이
// 요청 중 다른 화면에서 저장한 최신 상세를 덮어쓰지 않게 한다.
export function reconcileProject(current: Project, incoming: Project): Project {
  const currentTime = Date.parse(current.updatedAt);
  const incomingTime = Date.parse(incoming.updatedAt);
  if (!Number.isFinite(currentTime)) return incoming;
  if (!Number.isFinite(incomingTime) || currentTime > incomingTime) return current;
  if (currentTime === incomingTime) {
    // API의 Instant를 비교할 때 밀리초 미만의 순서도 보존한다.
    const fraction = (value: string) =>
      (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "").padEnd(9, "0").slice(3, 9);
    if (fraction(current.updatedAt) > fraction(incoming.updatedAt)) return current;
  }
  return incoming;
}
