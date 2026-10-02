const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const apiOrigin = "http://localhost:8080";
const project = {
  id: "project-one", workspaceId: "local-space", clientId: null, title: "Original project title",
  requirementText: "Original user requirements stay unchanged", currency: "KRW", deadline: null,
  budgetMin: null, budgetMax: null, status: "LEAD", updatedAt: "2026-10-01T00:00:00Z",
};

export async function fixture(page) {
  const state = { starts: [], history: [], run: null, policy: { workspaceId: "local-space", defaultTaxRate: .1, defaultRiskBufferRate: .1, maximumDiscountRate: .1, version: 1 }, proposal: null, confirms: 0, blocked: [], permissions: ["project.read", "agent.run", "agent.cancel", "agent.respond", "quotation.read", "quotation.write"], startFailures: 0, resumeFailures: 0, resumes: [], streamFailures: 0, streamRequests: 0, events: null };
  await page.addInitScript(() => sessionStorage.setItem("freelance-ops-session-v1", JSON.stringify({
    userId: "local-user", workspaceId: "local-space", accessToken: "fixture-token", refreshToken: "fixture-token",
    accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer",
  })));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === localOrigin || url.origin === apiOrigin) return route.continue();
    state.blocked.push(url.href);
    return route.abort();
  });
  await page.route("**/api/v2/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.origin !== apiOrigin || !path.includes("/local-space/") && path !== "/api/v2/me") return json({}, 404);
    if (path === "/api/v2/me") return json({ id: "local-user", email: "fixture@example.invalid", displayName: "Fixture", status: "ACTIVE", workspaces: [{ workspaceId: "local-space", name: "Fixture", slug: "fixture", effectivePermissions: state.permissions }] });
    if (path.endsWith("/projects") && method === "GET") return json([project]);
    if (path.endsWith("/clients") && method === "GET") return json([]);
    if (path.endsWith("/ai-connections") && method === "GET") return json({ available: true, models: { OPENAI: ["fixture-model"], GEMINI: [] }, connections: [] });
    if (path.endsWith("/agent-runs/latest") && method === "GET") return json(state.run);
    if (path.endsWith("/agent-runs/history") && method === "GET") return json(state.history);
    if (path.endsWith("/agent-runs") && method === "POST") {
      const body = req.postDataJSON();
      state.starts.push(body);
      if (state.startFailures-- > 0) return json({message: "Fixture send failure"}, 503);
      state.run = { runId: "run-one", status: "RUNNING", activeDepartment: "Requirements", interruption: null, result: null, errorCode: null, metadata: null, usage: null, updatedAt: "2026-10-01T00:01:00Z" };
      state.history = [{ runId: "run-one", requirementText: body.requirementText, status: "RUNNING", createdAt: "2026-10-01T00:01:00Z" }];
      return json({ runId: "run-one", status: "RUNNING", acceptedAt: "2026-10-01T00:01:00Z" }, 202);
    }
    if (/\/agent-runs\/[^/]+$/.test(path) && method === "GET") {
      if (state.pollFailures > 0) { state.pollFailures--; return json({message: "Fixture poll failure"}, 503); }
      return json(state.run?.runId === path.split("/").at(-1) ? state.run : { runId: path.split("/").at(-1), status: "CANCELLED", interruption: null, result: null, updatedAt: "2026-10-01T00:00:00Z" });
    }
    if (path.endsWith("/responses") && method === "POST") {
      state.resumes.push(req.postDataJSON());
      if (state.resumeFailures-- > 0) return json({message: "Fixture resume failure"}, 503);
      state.run = {...state.run, status: "RUNNING", interruption: null};
      return json({runId: state.run.runId, status: "RUNNING", acceptedAt: "2026-10-01T00:02:00Z"}, 202);
    }
    if (path.endsWith("/agent-runs/run-one/cancel") && method === "POST") {
      state.run = { ...state.run, status: "CANCELLED" };
      state.history[0].status = "CANCELLED";
      return json(state.run);
    }
    if (path.endsWith("/events") && method === "GET") {
      state.streamRequests++;
      if (state.streamFailures-- > 0) return json({}, 503);
      if (state.events) return route.fulfill({status: 200, contentType: "text/event-stream", body: state.events.map(e => `id: ${e.eventId}\ndata: ${JSON.stringify(e)}\n\n`).join("")});
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: 'id: 1\ndata: {"eventId":1,"runId":"run-one","type":"task.delegated","occurredAt":"2026-10-01T00:01:00Z","data":{"taskId":"task-one","department":"Requirements"}}\n\n' });
    }
    if (path.endsWith("/estimation-policy") && method === "GET") return json(state.policy);
    if (path.endsWith("/projects/project-one/estimation-policy/proposals") && method === "GET") return json(state.proposal ? [state.proposal] : []);
    if (path.endsWith("/estimation-policy/proposals") && method === "POST") {
      const body = req.postDataJSON();
      state.proposal = { proposalId: "proposal-one", projectId: body.projectId, sourceMessage: body.sourceMessage, createdAt: "2026-10-01T00:01:00Z", status: "PENDING", before: { ...state.policy }, after: { ...state.policy, ...body, version: state.policy.version }, confirmationToken: "token-one", expiresAt: "2099-01-01T00:00:00Z", appliedAt: null };
      return json(state.proposal);
    }
    if (path.endsWith("/estimation-policy/proposals/proposal-one") && method === "GET") return json(state.proposal);
    if (path.endsWith("/estimation-policy/proposals/proposal-one/confirm") && method === "POST") {
      if (req.postDataJSON().confirmationToken !== "token-one") return json({}, 403);
      if (state.proposal.status !== "APPLIED") {
        state.confirms++;
        state.policy = { ...state.proposal.after, version: state.policy.version + 1 };
        state.proposal = { ...state.proposal, status: "APPLIED", after: state.policy, appliedAt: "2026-10-01T00:02:00Z" };
      }
      return json(state.proposal);
    }
    if (method === "GET") return json([]);
    return json({}, 404);
  });
  return state;
}

