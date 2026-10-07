import { test, expect } from "@playwright/test";

const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const key = "freelance-ops-session-v1";
const now = new Date("2026-10-07T00:00:00Z");
const session = { userId: "synthetic-user", workspaceId: "space-one", accessToken: "synthetic-access", refreshToken: "synthetic-refresh", accessTokenExpiresAt: "2026-10-07T00:02:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" };
const nextSession = { ...session, accessToken: "synthetic-access-rotated", refreshToken: "synthetic-refresh-rotated", accessTokenExpiresAt: "2026-10-07T00:17:00Z" };
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function fixture(page, { authenticated = true, expired = false } = {}) {
  const state = { permissions: [], projectBarriers: {}, projectReads: [], refreshes: 0, refreshStatus: 200, refreshBarrier: null, logoutBarrier: null, loginBarrier: null, meStatus: 200, errors: [], blocked: [] };
  await page.clock.install({ time: now });
  await page.addInitScript(({ key, session, authenticated, expired }) => {
    localStorage.setItem("freelance-ops-ui-locale-v1", "en");
    if (authenticated) sessionStorage.setItem(key, JSON.stringify({ ...session, ...(expired ? { accessTokenExpiresAt: "2026-10-06T00:00:00Z" } : {}) }));
  }, { key, session, authenticated, expired });
  page.on("pageerror", error => state.errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === "/api/v2/auth/refresh") {
      state.refreshes++;
      if (state.refreshBarrier) await state.refreshBarrier.promise;
      return json(state.refreshStatus === 200 ? nextSession : { message: "Temporary fixture outage" }, state.refreshStatus);
    }
    if (url.pathname === "/api/v2/auth/logout") { if (state.logoutBarrier) await state.logoutBarrier.promise; return route.fulfill({ status: 204 }); }
    if (url.pathname === "/api/v2/auth/login") { if (state.loginBarrier) await state.loginBarrier.promise; return json(session); }
    if (url.pathname === "/api/v2/me") return json({ id: session.userId, email: "fixture@example.invalid", displayName: "Fixture", workspaces: ["space-one", "space-two"].map(workspaceId => ({ workspaceId, name: workspaceId, slug: workspaceId, effectivePermissions: state.permissions })) }, state.meStatus);
    const projects = url.pathname.match(/^\/api\/v2\/workspaces\/([^/]+)\/projects$/);
    if (projects) {
      state.projectReads.push(projects[1]);
      if (state.projectBarriers[projects[1]]) await state.projectBarriers[projects[1]].promise;
      return json([{ id: `project-${projects[1]}`, workspaceId: projects[1], title: `Project ${projects[1]}`, requirementText: "Synthetic request", currency: "KRW", status: "LEAD", updatedAt: "2026-10-07T00:00:00Z" }]);
    }
    if (url.pathname.startsWith("/api/")) return json({}, 404);
    if (url.origin === origin) return route.continue();
    state.blocked.push(url.href); return route.abort();
  });
  return state;
}
const stored = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null"), key);

test("logout wins over a pending refresh and does not wait for its server response", async ({ page }) => {
  const state = await fixture(page); state.refreshBarrier = barrier(); state.logoutBarrier = barrier();
  await page.goto("/workspace/projects");
  await expect(page.locator(".sidebar-foot")).toContainText("Fixture");
  await page.clock.fastForward(61_000); await expect.poll(() => state.refreshes).toBe(1);
  await page.locator(".sidebar-foot button").click();
  await expect(page.locator('input[name="email"]')).toBeVisible(); expect(await stored(page)).toBeNull();
  state.refreshBarrier.release(); state.logoutBarrier.release();
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await page.clock.fastForward(1_000); expect(await stored(page)).toBeNull(); expect(state.errors).toEqual([]); expect(state.blocked).toEqual([]);
});

test("a workspace switch during refresh is preserved in UI and storage", async ({ page }) => {
  const state = await fixture(page); state.refreshBarrier = barrier();
  await page.goto("/workspace/projects"); await expect(page.locator(".workspace-switcher select")).toBeVisible();
  await page.clock.fastForward(61_000); await expect.poll(() => state.refreshes).toBe(1);
  await page.locator(".workspace-switcher select").selectOption("space-two");
  state.refreshBarrier.release();
  await expect.poll(async () => (await stored(page)).accessToken).toBe(nextSession.accessToken);
  await expect(page.locator(".workspace-switcher select")).toHaveValue("space-two");
  expect((await stored(page)).workspaceId).toBe("space-two"); expect(state.errors).toEqual([]); expect(state.blocked).toEqual([]);
});

test("temporary scheduled refresh failure retains login and retries", async ({ page }) => {
  const state = await fixture(page); state.refreshStatus = 503;
  await page.goto("/workspace/projects"); await expect(page.locator(".sidebar-foot")).toContainText("Fixture");
  await page.clock.fastForward(61_000); await expect.poll(() => state.refreshes).toBe(1);
  await expect(page.getByText("Temporary fixture outage", { exact: true })).toBeVisible();
  expect((await stored(page)).accessToken).toBe(session.accessToken);
  state.refreshStatus = 200; await page.clock.fastForward(31_000);
  await expect.poll(async () => (await stored(page)).accessToken).toBe(nextSession.accessToken);
  await expect(page.locator('input[name="email"]')).toHaveCount(0); expect(state.errors).toEqual([]);
});

test("temporary restore refresh failure retains credentials and recovers", async ({ page }) => {
  const state = await fixture(page, { expired: true }); state.refreshStatus = 503;
  await page.goto("/workspace/projects"); await expect(page.getByText("Temporary fixture outage", { exact: true })).toBeVisible();
  expect((await stored(page)).refreshToken).toBe(session.refreshToken);
  state.refreshStatus = 200; await page.clock.fastForward(31_000);
  await expect(page.locator(".sidebar-foot")).toContainText("Fixture");
  expect((await stored(page)).accessToken).toBe(nextSession.accessToken); expect(state.errors).toEqual([]);
});

test("leaving login before its response prevents a late authenticated session", async ({ page }) => {
  const state = await fixture(page, { authenticated: false }); state.loginBarrier = barrier();
  await page.goto("/workspace/projects");
  await page.locator('input[name="email"]').fill("fixture@example.invalid"); await page.locator('input[name="password"]').fill("synthetic-password");
  const login = page.waitForRequest(url => url.url().endsWith("/auth/login"));
  await page.locator('button[type="submit"]').click(); await login;
  await page.locator(".auth-brand").click(); await expect(page).toHaveURL(`${origin}/`);
  state.loginBarrier.release(); await page.clock.fastForward(1_000);
  expect(await stored(page)).toBeNull(); expect(state.errors).toEqual([]);
});


test("a superseded workspace read cannot replace current data or leave a stale error", async ({ page }) => {
  const state = await fixture(page); state.permissions = ["project.read"];
  await page.goto("/workspace/projects"); await expect(page.locator(".workspace-switcher select")).toBeVisible();
  state.projectBarriers["space-two"] = barrier();
  await page.locator(".workspace-switcher select").selectOption("space-two");
  await expect.poll(() => state.projectReads.includes("space-two")).toBe(true);
  await page.locator(".workspace-switcher select").selectOption("space-one");
  await expect(page.locator(".workspace-switcher select")).toHaveValue("space-one");
  state.projectBarriers["space-two"].release(); await page.clock.fastForward(1_000);
  await expect(page.locator(".workspace-project-list")).toContainText("Project space-one");
  await expect(page.locator(".workspace-project-list")).not.toContainText("Project space-two");
  await expect(page.getByText("로그인 세션이 변경되었습니다. 다시 시도해 주세요.", { exact: true })).toHaveCount(0);
  expect((await stored(page)).workspaceId).toBe("space-one"); expect(state.errors).toEqual([]);
});
