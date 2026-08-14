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
