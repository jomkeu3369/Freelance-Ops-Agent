import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

export const api = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:18221";
const password = "Synthetic-test-password-23!";
const evidenceForPage = new WeakMap();

export function installLiveGuards() {
  test.beforeAll(async ({ request }) => {
    expect(process.env.PLAYWRIGHT_LIVE_MODELS, "Launch the real Agent with only a synthetic model provider").toBe("synthetic-provider");
    for (const url of [api, process.env.PLAYWRIGHT_BASE_URL]) {
      const target = new URL(url);
      expect(["127.0.0.1", "localhost", "[::1]"]).toContain(target.hostname);
      expect(Number(target.port)).toBeGreaterThanOrEqual(18200);
      expect(Number(target.port)).toBeLessThanOrEqual(18249);
    }
    expect((await request.get(`${api}/actuator/health/readiness`)).status()).toBe(200);
    expect((await request.get("http://127.0.0.1:18223/health/readiness")).status()).toBe(200);
  });
  
  test.afterEach(async ({ page }, testInfo) => {
    const evidence = evidenceForPage.get(page);
    if (evidence) {
      const file = testInfo.outputPath("sanitized-real-api-traffic.json");
      await writeFile(file, JSON.stringify({ boundary: "Actual local API responses; no browser API route handlers. Headers, tokens and auth bodies excluded.", outcome: testInfo.status, ...evidence }, null, 2));
      await testInfo.attach("sanitized-real-api-traffic", { path: file, contentType: "application/json" });
    }
  });
  
}

export function collectTraffic(page) {
  const traffic = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin === new URL(api).origin && url.pathname.startsWith("/api/")) {
      traffic.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    }
  });
  const evidence = { traffic, errors };
  evidenceForPage.set(page, evidence);
  return evidence;
}

export async function latestStatus(request, base, headers) {
  const response = await request.get(`${base}/agent-runs/latest`, { headers });
  if (response.status() === 204) return "NOT_ACCEPTED_YET";
  if (response.status() !== 200) return `HTTP_${response.status()}`;
  return (await response.json()).status;
}

export async function account(request) {
  const email = `live-${randomUUID()}@example.invalid`;
  const response = await request.post(`${api}/api/v2/auth/register`, { data: { email, password, displayName: "합성 검증 사용자", workspaceName: "격리 검증 작업공간", ageAtLeast14: true } });
  expect(response.status()).toBe(201);
  const session = await response.json();
  return { email, session };
}

export async function login(page, email) {
  await page.goto("/workspace/projects");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('#auth-panel-login button[type="submit"]').evaluate(node => { node.click(); node.click(); });
  await expect(page.getByRole("heading", { name: "첫 고객 문의를 등록하세요.", exact: true })).toBeVisible();
  await openNavigation(page, "고객 관리");
}

export async function openNavigation(page, name) {
  const target = page.getByRole("button", { name, exact: true });
  if (!await target.isVisible()) await page.getByRole("button", { name: "메뉴 펼치기", exact: true }).click();
  await expect(target).toBeVisible();
  return target;
}

export async function intake(page, request, session, title, requirementText) {
  await page.getByRole("button", { name: "고객 관리", exact: true }).click();
  await page.getByRole("textbox", { name: "담당자 이름", exact: true }).fill("합성 검증 고객");
  await page.getByRole("button", { name: "고객 등록", exact: true }).click();
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const root = `${api}/api/v2/workspaces/${session.workspaceId}`;
  await expect.poll(async () => (await (await request.get(`${root}/clients`, { headers })).json()).length).toBe(1);
  const clients = await (await request.get(`${root}/clients`, { headers })).json();
  await (await openNavigation(page, "신규 문의 등록")).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="title"]').fill(title);
  await dialog.locator('textarea[name="requirementText"]').fill(requirementText);
  await dialog.locator(".quick-intake-options summary").click();
  await dialog.locator('select[name="clientId"]').selectOption(clients[0].id);
  await dialog.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
  await expect(page).toHaveURL(/\/intake$/);
  const projects = await (await request.get(`${root}/projects`, { headers })).json();
  expect(projects).toHaveLength(1);
  expect(projects[0].clientId).toBe(clients[0].id);
  expect(projects[0].workspaceId).toBe(session.workspaceId);
  expect(projects[0].requirementText).toBe(requirementText);
  return { project: projects[0], root, headers };
}

export async function selectSyntheticConnection(page, session) {
  const credentialId = seedSyntheticConnection(session);
  expect(credentialId).toMatch(/^[0-9a-f-]{36}$/);
  await page.reload();
  await page.getByRole("button", { name: /AI 모델 선택:/ }).click();
  await page.getByRole("combobox", { name: "AI 연결", exact: true }).selectOption(credentialId);
  await page.getByRole("dialog", { name: "AI 모델 선택", exact: true }).getByRole("button", { name: "닫기", exact: true }).click();
  return credentialId;
}

export function seedSyntheticConnection(session) {
  const id = execFileSync(process.env.LIVE_FIXTURE_PYTHON, ["-B", process.env.LIVE_CONNECTION_SEED, session.userId, session.workspaceId], { encoding: "utf8" }).trim();
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id;
}

