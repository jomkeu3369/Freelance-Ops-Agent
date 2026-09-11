const WORKSPACE_VIEWS = new Set(["pipeline", "clients", "knowledge", "project", "settings"]);
const PROJECT_STEPS = new Set(["intake", "agent", "quote", "outcome"]);

export function parseWorkspaceLocation(search) {
  const params = new URLSearchParams(search);
  const requestedView = params.get("view");
  const view = WORKSPACE_VIEWS.has(requestedView) ? requestedView : "pipeline";

  if (view !== "project") return { view };

  const projectId = params.get("project")?.trim() || null;
  const requestedStep = params.get("step");
  const step = PROJECT_STEPS.has(requestedStep) ? requestedStep : "intake";
  return { view, projectId, step };
}

export function buildWorkspaceSearch(location) {
  if (location.view === "pipeline") return "";

  const params = new URLSearchParams({ view: location.view });
  if (location.view === "project" && location.projectId) {
    params.set("project", location.projectId);
    params.set("step", PROJECT_STEPS.has(location.step) ? location.step : "intake");
  }
  return `?${params.toString()}`;
}

/** 메뉴 및 프로젝트 단계에 대응하는 독립 주소를 만듭니다. */
export function buildWorkspacePath(location) {
  if (location.view === "project" && location.projectId) {
    const step = PROJECT_STEPS.has(location.step) ? location.step : "intake";
    return `/workspace/projects/${encodeURIComponent(location.projectId)}/${step}`;
  }
  if (["clients", "knowledge", "settings"].includes(location.view)) return `/workspace/${location.view}`;
  return "/workspace/projects";
}

/** 브라우저 새로고침과 뒤로가기도 같은 화면 상태로 복원합니다. */
export function parseWorkspacePath(pathname, search = "") {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "workspace") return { view: "pipeline" };
  // 로그인 화면이 하위 페이지의 서버 이동보다 먼저 표시되어도 기존 상세 링크를 보존합니다.
  if (segments.length === 1) return parseWorkspaceLocation(search);
  if (["clients", "knowledge", "settings"].includes(segments[1])) return { view: segments[1] };
  if (segments[1] === "projects" && segments[2]) {
    let projectId;
    try {
      projectId = decodeURIComponent(segments[2]);
    } catch {
      return { view: "pipeline" };
    }
    return { view: "project", projectId, step: PROJECT_STEPS.has(segments[3]) ? segments[3] : "intake" };
  }
  return { view: "pipeline" };
}
