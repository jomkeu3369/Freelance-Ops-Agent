import { test, expect } from "@playwright/test";

const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const apiOrigin = "http://localhost:8080";
const project = {
  id: "project-one", workspaceId: "local-space", clientId: null, title: "Original project title",
  requirementText: "Original user requirements stay unchanged", currency: "KRW", deadline: null,
  budgetMin: null, budgetMax: null, status: "LEAD", updatedAt: "2026-10-01T00:00:00Z",
};

async function fixture(page) {
  const state = { starts: [], history: [], run: null, policy: { workspaceId: "local-space", defaultTaxRate: .1, defaultRiskBufferRate: .1, maximumDiscountRate: .1, version: 1 }, proposal: null, confirms: 0, blocked: [] };
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
    if (path === "/api/v2/me") return json({ id: "local-user", email: "fixture@example.invalid", displayName: "Fixture", status: "ACTIVE", workspaces: [{ workspaceId: "local-space", name: "Fixture", slug: "fixture", effectivePermissions: ["project.read", "agent.run", "agent.cancel", "agent.respond", "quotation.read", "quotation.write"] }] });
    if (path.endsWith("/projects") && method === "GET") return json([project]);
    if (path.endsWith("/clients") && method === "GET") return json([]);
    if (path.endsWith("/ai-connections") && method === "GET") return json({ available: true, models: { OPENAI: ["fixture-model"], GEMINI: [] }, connections: [] });
    if (path.endsWith("/agent-runs/latest") && method === "GET") return json(state.run);
    if (path.endsWith("/agent-runs/history") && method === "GET") return json(state.history);
    if (path.endsWith("/agent-runs") && method === "POST") {
      const body = req.postDataJSON();
      state.starts.push(body);
      state.run = { runId: "run-one", status: "RUNNING", activeDepartment: "Requirements", interruption: null, result: null, errorCode: null, metadata: null, usage: null, updatedAt: "2026-10-01T00:01:00Z" };
      state.history = [{ runId: "run-one", requirementText: body.requirementText, status: "RUNNING", createdAt: "2026-10-01T00:01:00Z" }];
      return json({ runId: "run-one", status: "RUNNING", acceptedAt: "2026-10-01T00:01:00Z" }, 202);
    }
    if (path.endsWith("/agent-runs/run-one") && method === "GET") return json(state.run);
    if (path.endsWith("/agent-runs/run-one/cancel") && method === "POST") {
      state.run = { ...state.run, status: "CANCELLED" };
      state.history[0].status = "CANCELLED";
      return json(state.run);
    }
    if (path.endsWith("/agent-runs/run-one/events") && method === "GET") {
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

test("chat sends the exact user text, displays real task events, cancels, and preserves draft and language", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/projects/project-one/agent");
  const input = page.locator("#agent-chat-input");
  await expect(input).toBeVisible();
  await input.fill("  Review the exact customer wording  ");
  await page.locator(".agent-chat-composer button[type=submit]").click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].requirementText).toBe("  Review the exact customer wording  ");
  await expect(page.locator(".agent-chat-message.user")).toContainText("Review the exact customer wording");
  await expect(page.locator(".agent-chat-events")).toContainText("Requirements");
  await page.locator(".agent-chat-actions .danger").click();
  await expect(page.locator(".agent-chat-message.assistant")).toContainText("CANCELLED");
  await input.fill("Unsent draft stays mine");
  await page.locator(".ui-language-selector select").selectOption("en");
  await page.reload();
  await expect(page.locator(".ui-language-selector select")).toHaveValue("en");
  await expect(page.getByRole("region", { name: "Agent conversation" })).toBeVisible();
  await expect(input).toHaveValue("Unsent draft stays mine");
  await expect(page.locator(".agent-chat-message.user")).toContainText("Review the exact customer wording");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "outputs/ui-ux/chat-390-en.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "outputs/ui-ux/chat-1440-en.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.blocked).toEqual([]);
});

test("chat settings proposal needs explicit confirmation and survives refresh", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/workspace/projects/project-one/agent");
  await page.locator("#agent-chat-input").fill("기본 세율 12%, 위험 버퍼 15%, 최대 할인 20%로 변경");
  await page.locator(".agent-chat-composer button[type=submit]").click();
  await expect(page.locator(".agent-chat-policy")).toContainText("10% → 12%");
  await page.screenshot({ path: "outputs/ui-ux/chat-320-ko-proposal.png", fullPage: true });
  expect(state.proposal.sourceMessage).toBe("기본 세율 12%, 위험 버퍼 15%, 최대 할인 20%로 변경");
  expect(state.policy.defaultTaxRate).toBe(.1);
  expect(state.starts).toHaveLength(0);
  await page.reload();
  await expect(page.locator(".agent-chat-policy")).toContainText("10% → 12%");
  await page.locator(".agent-chat-policy button").click();
  await expect(page.locator(".agent-chat-policy")).toContainText("견적 기본 설정이 변경되었습니다.");
  expect(state.policy.defaultTaxRate).toBe(.12);
  expect(state.confirms).toBe(1);
  await page.reload();
  await expect(page.locator(".agent-chat-message.assistant")).toContainText("적용됨");
  expect(state.confirms).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.blocked).toEqual([]);
});
