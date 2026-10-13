import { specificationWorkflowFixture } from "./specification-workflow-fixture.mjs";
import { completeWorkflowRun, workflowRunId } from "./analysis-workflow-fixture.mjs";
const clone = value => structuredClone(value);
const now = "2026-10-13T16:00:00.123456Z";
const questionRun = "a1000000-0000-4000-8000-000000000002";

/** Call after the initial guest page loads, so the login UI is genuinely used. */
export async function fullWorkflowFixture(page) {
  const result = await specificationWorkflowFixture(page), { state, workflow, sourceMessages } = result;
  const flow = { logins: [], clients: [], clientCreates: [], projectCreates: [] };
  state.permissions.push("client.read", "client.write");
  state.projects = []; state.run = null; state.history = []; state.events = []; workflow.sourceEnabled = false;
  await page.route("**/api/v2/auth/login", route => {
    const { email } = route.request().postDataJSON(); flow.logins.push({ email });
    return route.fulfill({ json: { userId: "local-user", workspaceId: "local-space", accessToken: "fixture-token", refreshToken: "fixture-token",
      accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" } });
  });
  await page.route("**/api/v2/workspaces/local-space/clients", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: clone(flow.clients) });
    if (route.request().method() !== "POST") return route.fulfill({ status: 404, json: {} });
    const body = route.request().postDataJSON(); flow.clientCreates.push(clone(body));
    const client = { ...body, id: "e1000000-0000-4000-8000-000000000001", workspaceId: "local-space", status: "ACTIVE", createdBy: "local-user", createdAt: now, updatedAt: now, version: 0 };
    flow.clients.unshift(client); return route.fulfill({ json: clone(client) });
  });
  await page.route("**/api/v2/workspaces/local-space/projects", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: clone(state.projects) });
    if (route.request().method() !== "POST") return route.fulfill({ status: 404, json: {} });
    const body = route.request().postDataJSON(); flow.projectCreates.push(clone(body));
    const project = { ...body, id: "project-one", workspaceId: "local-space", status: "LEAD", updatedAt: now, version: 0 };
    sourceMessages.forEach(source => { source.content = project.requirementText; });
    state.projects.unshift(project); return route.fulfill({ json: clone(project) });
  });
  await page.route("**/api/v2/workspaces/local-space/projects/project-one/agent-runs", route => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON(); state.starts.push(clone(body)); state.startProjects.push("project-one");
    if (body.workflowMode === "PROJECT_ANALYSIS") {
      workflow.sourceEnabled = true;
      state.run = { ...completeWorkflowRun(), status: "WAITING_FOR_USER", result: null,
        interruption: { interruptionId: "f1000000-0000-4000-8000-000000000001", kind: "CLARIFICATION", questions: ["고객 제공 자료와 제외 범위를 확인해 주세요."] } };
    } else {
      workflow.sourceEnabled = false;
      state.run = { ...completeWorkflowRun(questionRun), result: { projectSummary: "펫 질문의 합성 응답", openQuestions: [], departmentResults: [], quotationDraft: null, quotationDrafts: [], referencedDocumentIds: [] } };
    }
    state.history = [{ runId: state.run.runId, requirementText: body.requirementText, status: state.run.status, createdAt: now }, ...state.history];
    state.projectRuns["project-one"] = clone(state.run); state.projectHistory["project-one"] = clone(state.history);
    return route.fulfill({ status: 202, json: { runId: state.run.runId, status: "RUNNING", acceptedAt: now } });
  });
  await page.route(`**/api/v2/workspaces/local-space/agent-runs/${workflowRunId}/responses`, route => {
    const body = route.request().postDataJSON(); state.resumes.push(clone(body));
    sourceMessages.push({ id: "b1000000-0000-4000-8000-000000000003", eventOrder: 3, kind: "USER_CLARIFICATION", content: body.answers[0].answer,
      prompt: "고객 제공 자료와 제외 범위를 확인해 주세요.", createdAt: now });
    state.run = completeWorkflowRun(); state.projectRuns["project-one"] = clone(state.run); state.history[0].status = "COMPLETED";
    state.projectHistory["project-one"] = clone(state.history);
    return route.fulfill({ status: 202, json: { runId: workflowRunId, status: "RUNNING", acceptedAt: now } });
  });
  return { ...result, flow };
}
