import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const projectA = "project-one";
const projectB = "project-two";
const titleA = "Original project title";
const titleB = "Second project";
const savedTitle = "Updated synthetic project A";
const mutationPath = `/api/v2/workspaces/local-space/projects/${projectA}`;
const projectPath = (id, step = "agent") => `/workspace/projects/${id}/${step}`;
const recentProject = (page, title) => page.getByRole("navigation", { name: "최근 프로젝트 대화", exact: true }).getByTitle(title, { exact: true });
const editDialog = page => page.getByRole("dialog", { name: "문의 조건을 최신 상태로 맞추세요.", exact: true });
const deleteDialog = page => page.getByRole("alertdialog", { name: "정말 삭제하시겠어요?", exact: true });
const input = page => page.locator("#agent-chat-input");
const sendButton = page => page.getByRole("button", { name: "보내기", exact: true });
const stepButton = (page, label) => page.getByRole("navigation", { name: "프로젝트 진행 단계", exact: true }).getByRole("button", { name: new RegExp(`^(?:0[1-4]\\s*)?${label}$`) });

async function mutationFixture(page) {
  // The shared fixture owns all API traffic and blocks external providers. Only
  // this synthetic project's detail endpoint is overridden after its routes.
  const state = await fixture(page);
  state.permissions.push("project.write", "project.delete");
  Object.assign(state.projects[0], { currency: "USD", budgetMin: 1.25, budgetMax: 2.75 });
  state.projects.push({ ...state.projects[0], id: projectB, title: titleB, requirementText: "Synthetic project B requirements" });
  Object.assign(state, { edits: [], deletes: [], nextEdit: null, nextDelete: null, deleteFailure: false, pageErrors: [] });
  page.on("pageerror", error => state.pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "ko"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route(`**${mutationPath}`, async route => {
    const request = route.request();
    const method = request.method();
    if (method === "PATCH") {
      const body = request.postDataJSON();
      state.edits.push(body);
      state.writes.push({ path: mutationPath, method });
      const barrier = state.nextEdit;
      state.nextEdit = null;
      if (barrier) await barrier.wait();
      const updated = { ...state.projects.find(project => project.id === projectA), ...body, updatedAt: "2026-10-02T00:00:00Z" };
      state.projects = state.projects.map(project => project.id === projectA ? updated : project);
      return route.fulfill({ status: 200, json: updated });
    }
    if (method === "DELETE") {
      state.deletes.push(projectA);
      state.writes.push({ path: mutationPath, method });
      const barrier = state.nextDelete;
      state.nextDelete = null;
      if (barrier) await barrier.wait();
      if (state.deleteFailure) return route.fulfill({ status: 503, json: { message: "Synthetic delete failure" } });
      state.projects = state.projects.filter(project => project.id !== projectA);
      return route.fulfill({ status: 204 });
    }
    if (method === "GET") {
      const project = state.projects.find(project => project.id === projectA);
      return route.fulfill({ status: project ? 200 : 404, json: project ?? { message: "Synthetic project is unavailable" } });
    }
    return route.fallback();
  });
  return state;
}

async function openAIntakeFromB(page) {
  await page.goto(projectPath(projectB));
  await expect(page.locator(".project-heading h1")).toHaveText(titleB);
  await expect(input(page)).toBeVisible();
  await recentProject(page, titleA).click();
  await expect(page).toHaveURL(new RegExp(`${projectPath(projectA)}$`));
  await expect(page.locator(".project-heading h1")).toHaveText(titleA);
  await stepButton(page, "문의").click();
  await expect(page).toHaveURL(new RegExp(`${projectPath(projectA, "intake")}$`));
  await expect(page.getByRole("button", { name: "프로젝트 정보 수정", exact: true })).toBeVisible();
}

async function backToB(page) {
  // B/agent → A/agent → A/intake is real SPA history. Browser Back can leave
  // a busy modal without attempting clicks through its backdrop/focus trap.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${projectPath(projectA)}$`));
  await expect(editDialog(page)).toHaveCount(0);
  await expect(deleteDialog(page)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${projectPath(projectB)}$`));
  await expect(page.locator(".project-heading h1")).toHaveText(titleB);
  await expect(input(page)).toBeVisible();
}

async function saveTitle(page) {
  await page.getByRole("button", { name: "프로젝트 정보 수정", exact: true }).click();
  const dialog = editDialog(page);
  await expect(dialog.getByLabel("통화", { exact: true })).toHaveValue("USD");
  await expect(dialog.getByLabel("최소 예산", { exact: true })).toHaveValue("1.25");
  await expect(dialog.getByLabel("최대 예산", { exact: true })).toHaveValue("2.75");
  await dialog.getByLabel("프로젝트 이름", { exact: true }).fill(savedTitle);
  await dialog.getByRole("button", { name: "변경 저장", exact: true }).click();
}

async function confirmDelete(page) {
  await page.getByRole("button", { name: "프로젝트 삭제", exact: true }).click();
  const dialog = deleteDialog(page);
  await expect(dialog.getByRole("button", { name: "영구 삭제", exact: true })).toBeDisabled();
  await dialog.getByPlaceholder("프로젝트명 입력", { exact: true }).fill(titleA);
  await dialog.getByRole("button", { name: "영구 삭제", exact: true }).click();
}

async function startRun(page, state, projectId) {
  const message = `New synthetic request for ${projectId}`;
  await input(page).fill(message);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();
  await expect.poll(() => state.startProjects).toEqual([projectId]);
  const runId = projectId === projectA ? "run-one" : `run-${projectId}`;
  await expect(page.locator(`[data-run-id="${runId}"] .agent-chat-message.user`)).toContainText(message);
  await expect(page.getByRole("button", { name: "작업 취소", exact: true })).toBeVisible();
  await expect(input(page)).toBeEditable();
  await input(page).fill(`Unsent next request for ${projectId}`);
  return runId;
}

async function expectRunPreserved(page, state, projectId, runId) {
  await expect(page).toHaveURL(new RegExp(`${projectPath(projectId)}$`));
  await expect(page.locator(`[data-run-id="${runId}"]`)).toBeVisible();
  // A historical turn alone is not proof of a live run: cancellation must still
  // be available, and a nonempty next draft must remain unsendable while active.
  await expect(page.getByRole("button", { name: "작업 취소", exact: true })).toBeVisible();
  await expect(sendButton(page)).toBeDisabled();
  await expect(input(page)).toHaveValue(`Unsent next request for ${projectId}`);
  await input(page).press("Control+Enter");
  expect(state.startProjects).toEqual([projectId]);
  expect(state.cancels).toEqual([]);
  expect(state.blocked).toEqual([]);
  expect(state.pageErrors).toEqual([]);
}

async function releaseMutation(page, barrier, method) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === mutationPath && response.request().method() === method);
  barrier.release();
  await (await response).finished();
}

test("project title edits preserve both existing fractional USD budgets", async ({ page }) => {
  const state = await mutationFixture(page);
  await openAIntakeFromB(page);
  await saveTitle(page);
  await expect(editDialog(page)).toHaveCount(0);
  await expect(page.locator(".project-heading h1")).toHaveText(savedTitle);
  await expect(recentProject(page, savedTitle)).toBeVisible();
  expect(state.edits).toEqual([{
    clientId: null, title: savedTitle, requirementText: "Original user requirements stay unchanged",
    currency: "USD", deadline: null, budgetMin: 1.25, budgetMax: 2.75, status: "LEAD",
  }]);
  await page.getByRole("button", { name: "프로젝트 정보 수정", exact: true }).click();
  await expect(editDialog(page).getByLabel("프로젝트 이름", { exact: true })).toHaveValue(savedTitle);
  await expect(editDialog(page).getByLabel("최소 예산", { exact: true })).toHaveValue("1.25");
  await expect(editDialog(page).getByLabel("최대 예산", { exact: true })).toHaveValue("2.75");
  await editDialog(page).getByRole("button", { name: "취소", exact: true }).click();
  expect(state.writes).toEqual([{ path: mutationPath, method: "PATCH" }]);
  expect(state.starts).toEqual([]);
  expect(state.blocked).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});

test("a delayed A edit cannot reset B's newer run after browser Back", async ({ page }) => {
  const state = await mutationFixture(page);
  const barrier = state.nextEdit = requestBarrier();
  try {
    await openAIntakeFromB(page);
    await saveTitle(page);
    await barrier.entered;
    await expect(editDialog(page).getByRole("button", { name: "변경 저장", exact: true })).toBeDisabled();
    await backToB(page);
    const runId = await startRun(page, state, projectB);
    await releaseMutation(page, barrier, "PATCH");
    await expect(recentProject(page, savedTitle)).toBeVisible();
    await expect(page.locator(".project-heading h1")).toHaveText(titleB);
    await expectRunPreserved(page, state, projectB, runId);
    expect(state.edits).toHaveLength(1);
    expect(state.deletes).toEqual([]);
  } finally { barrier.release(); }
});

test("an old A edit cannot reset a newer A run after A to B to A navigation", async ({ page }) => {
  const state = await mutationFixture(page);
  const barrier = state.nextEdit = requestBarrier();
  try {
    await openAIntakeFromB(page);
    await saveTitle(page);
    await barrier.entered;
    await backToB(page);
    await recentProject(page, titleA).click();
    await expect(page).toHaveURL(new RegExp(`${projectPath(projectA)}$`));
    await expect(editDialog(page)).toHaveCount(0);
    const runId = await startRun(page, state, projectA);
    const latestReads = [...state.latestReads];
    await releaseMutation(page, barrier, "PATCH");
    await expect(page.locator(".project-heading h1")).toHaveText(savedTitle);
    await expectRunPreserved(page, state, projectA, runId);
    expect(state.latestReads).toEqual(latestReads);
    expect(state.edits).toHaveLength(1);
    expect(state.deletes).toEqual([]);
  } finally { barrier.release(); }
});

test("a delayed A deletion removes A without redirecting or resetting B's run", async ({ page }) => {
  const state = await mutationFixture(page);
  const barrier = state.nextDelete = requestBarrier();
  try {
    await openAIntakeFromB(page);
    await confirmDelete(page);
    await barrier.entered;
    await expect(deleteDialog(page).getByRole("button", { name: "영구 삭제", exact: true })).toBeDisabled();
    await backToB(page);
    const runId = await startRun(page, state, projectB);
    await releaseMutation(page, barrier, "DELETE");
    await expect(recentProject(page, titleA)).toHaveCount(0);
    await expect(page.locator(".project-heading h1")).toHaveText(titleB);
    await expectRunPreserved(page, state, projectB, runId);
    expect(state.deletes).toEqual([projectA]);
    expect(state.edits).toEqual([]);
  } finally { barrier.release(); }
});

test("returning to A before delayed deletion leaves a read-only unavailable view until explicit navigation", async ({ page }) => {
  const state = await mutationFixture(page);
  const barrier = state.nextDelete = requestBarrier();
  try {
    await openAIntakeFromB(page);
    await confirmDelete(page);
    await barrier.entered;
    await backToB(page);
    await recentProject(page, titleA).click();
    await expect(page).toHaveURL(new RegExp(`${projectPath(projectA)}$`));
    await startRun(page, state, projectA);
    await releaseMutation(page, barrier, "DELETE");
    const unavailable = page.getByRole("status").filter({ hasText: "이 프로젝트는 삭제되어 더 이상 수정하거나 실행할 수 없습니다." });
    await expect(unavailable).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${projectPath(projectA)}$`));
    await expect(recentProject(page, titleA)).toHaveCount(0);
    await expect(page.locator(".project-workbench")).toHaveCount(0);
    await expect(input(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "프로젝트 정보 수정", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "프로젝트 삭제", exact: true })).toHaveCount(0);
    await expect(page.locator(".workspace-connection-label")).not.toHaveText("실시간 작업 공간");
    expect(state.startProjects).toEqual([projectA]);
    expect(state.cancels).toEqual([]);
    expect(state.deletes).toEqual([projectA]);

    await unavailable.getByRole("button", { name: "프로젝트 목록으로", exact: true }).click();
    await expect(page).toHaveURL(/\/workspace\/projects$/);
    await expect(unavailable).toHaveCount(0);
    await expect(page.locator(`[data-project-id="${projectA}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-project-id="${projectB}"]`)).toBeVisible();
    expect(state.deletes).toEqual([projectA]);
    expect(state.blocked).toEqual([]);
    expect(state.pageErrors).toEqual([]);
  } finally { barrier.release(); }
});

test("a failed deletion preserves A and never retries on timers, dismissal or Back and Forward", async ({ page }) => {
  const state = await mutationFixture(page);
  state.deleteFailure = true;
  const barrier = state.nextDelete = requestBarrier();
  await page.clock.install();
  try {
    await openAIntakeFromB(page);
    await confirmDelete(page);
    await barrier.entered;
    await releaseMutation(page, barrier, "DELETE");
    await expect(deleteDialog(page).getByRole("alert")).toHaveText("Synthetic delete failure");
    await expect(deleteDialog(page).getByPlaceholder("프로젝트명 입력", { exact: true })).toHaveValue(titleA);
    await expect(deleteDialog(page).getByRole("button", { name: "영구 삭제", exact: true })).toBeEnabled();
    await page.clock.runFor(10_000);
    expect(state.deletes).toEqual([projectA]);
    await deleteDialog(page).getByRole("button", { name: "취소", exact: true }).click();
    await backToB(page);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${projectPath(projectA)}$`));
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${projectPath(projectA, "intake")}$`));
    await expect(page.locator(".project-heading h1")).toHaveText(titleA);
    await expect(deleteDialog(page)).toHaveCount(0);
    await page.getByRole("button", { name: "프로젝트 삭제", exact: true }).click();
    await expect(deleteDialog(page).getByPlaceholder("프로젝트명 입력", { exact: true })).toHaveValue("");
    await expect(deleteDialog(page).getByRole("button", { name: "영구 삭제", exact: true })).toBeDisabled();
    await expect(recentProject(page, titleA)).toHaveCount(1);
    expect(state.deletes).toEqual([projectA]);
    expect(state.writes).toEqual([{ path: mutationPath, method: "DELETE" }]);
    expect(state.starts).toEqual([]);
    expect(state.blocked).toEqual([]);
    expect(state.pageErrors).toEqual([]);
  } finally { barrier.release(); }
});

test("explicit model and personal connection selections survive steps within the same project", async ({ page }) => {
  const state = await mutationFixture(page);
  state.connections = [{ id: "synthetic-personal-connection", provider: "OPENAI", model: "gpt-6-luna", maskedKey: "synthetic-...mask", updatedAt: "2026-10-01T00:00:00Z" }];
  await page.goto(projectPath(projectA));
  await input(page).fill("Keep this request unsent across project steps");
  const settings = page.getByRole("dialog", { name: "AI 설정", exact: true });
  const openSettings = page.getByRole("button", { name: "AI 설정 열기", exact: true });
  await openSettings.click();
  const model = settings.getByLabel("AI 모델", { exact: true });
  await expect(model).toBeEnabled();
  const defaultModel = await model.inputValue();
  const explicitModel = state.aiUsage.models.find(item => item.model !== defaultModel)?.model;
  expect(explicitModel).toBeTruthy();
  await model.selectOption(explicitModel);
  await page.keyboard.press("Escape");
  await stepButton(page, "문의").click();
  await expect(page).toHaveURL(new RegExp(`${projectPath(projectA, "intake")}$`));
  await stepButton(page, "AI 분석").click();
  await expect(page).toHaveURL(new RegExp(`${projectPath(projectA)}$`));
  await openSettings.click();
  await expect(model).toHaveValue(explicitModel);
  await expect(settings.getByLabel("AI 연결", { exact: true })).toHaveValue("");

  await settings.getByLabel("AI 연결", { exact: true }).selectOption("synthetic-personal-connection");
  await page.keyboard.press("Escape");
  await stepButton(page, "문의").click();
  await expect(page).toHaveURL(new RegExp(`${projectPath(projectA, "intake")}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${projectPath(projectA)}$`));
  await openSettings.click();
  await expect(settings.getByLabel("AI 연결", { exact: true })).toHaveValue("synthetic-personal-connection");
  await page.keyboard.press("Escape");
  await expect(page.locator(".chat-model-trigger")).toContainText("내 키");
  await expect(page.locator(".chat-model-trigger")).toContainText("gpt-6-luna");
  await expect(input(page)).toHaveValue("Keep this request unsent across project steps");
  expect(state.starts).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.blocked).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});

test("an old edit response cannot change a same-ID project's newer login and run", async ({ page }) => {
  const state = await mutationFixture(page);
  const barrier = requestBarrier();
  const oldProject = { ...state.projects[0] };
  const newTitle = "Project A from the new login";
  const newSession = {
    userId: "local-user", workspaceId: "local-space", accessToken: "synthetic-new-login-access", refreshToken: "synthetic-new-login-refresh",
    accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer",
  };
  let logins = 0;
  let logouts = 0;
  // Hold an old server snapshot, rather than rewriting the new session's fixture
  // when its response is finally delivered. All auth values are synthetic.
  await page.route(`**${mutationPath}`, async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    state.edits.push(body);
    state.writes.push({ path: mutationPath, method: "PATCH" });
    await barrier.wait();
    return route.fulfill({ status: 200, json: { ...oldProject, ...body, updatedAt: "2026-10-02T00:00:00Z" } });
  });
  await page.route("**/api/v2/auth/logout", route => {
    if (route.request().method() !== "POST") return route.fallback();
    logouts++;
    return route.fulfill({ status: 204 });
  });
  await page.route("**/api/v2/auth/login", route => {
    if (route.request().method() !== "POST") return route.fallback();
    logins++;
    return route.fulfill({ status: 200, json: newSession });
  });
  try {
    await openAIntakeFromB(page);
    await saveTitle(page);
    await barrier.entered;
    await backToB(page);
    await page.locator(".sidebar-foot").getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("freelance-ops-session-v1"))).toBeNull();
    state.projects[0] = { ...oldProject, title: newTitle, updatedAt: "2026-10-03T00:00:00Z" };
    await page.locator('input[name="email"]').fill("fixture@example.invalid");
    await page.locator('input[name="password"]').fill("synthetic-password-only");
    await page.locator('.auth-panel button[type="submit"]').click();
    await expect(recentProject(page, newTitle)).toBeVisible();
    await recentProject(page, newTitle).click();
    await expect(page).toHaveURL(new RegExp(`${projectPath(projectA)}$`));
    const runId = await startRun(page, state, projectA);
    await releaseMutation(page, barrier, "PATCH");
    // Observe a committed render after the rejected stale response. There is no
    // successful title/list change to use as a positive reconciliation signal.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator(".project-heading h1")).toHaveText(newTitle);
    await expect(recentProject(page, savedTitle)).toHaveCount(0);
    await expect(editDialog(page)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expectRunPreserved(page, state, projectA, runId);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("freelance-ops-session-v1")))).toEqual(newSession);
    expect(logins).toBe(1);
    expect(logouts).toBe(1);
    expect(state.edits).toHaveLength(1);
    expect(state.deletes).toEqual([]);
  } finally { barrier.release(); }
});
