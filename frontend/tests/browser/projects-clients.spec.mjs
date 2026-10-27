import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const clients = [
  { id: "client-a", workspaceId: "local-space", name: "고객 A", companyName: "회사 A", email: null, phone: null, notes: null, status: "ACTIVE", createdBy: "local-user", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", version: 1 },
  { id: "client-b", workspaceId: "local-space", name: "고객 B", companyName: null, email: null, phone: null, notes: null, status: "ACTIVE", createdBy: "local-user", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", version: 1 }
];

async function setup(page) {
  const state = await fixture(page);
  state.permissions.push("client.read", "client.write", "client.delete", "project.write");
  state.projects[0].clientId = "client-a";
  await page.route("**/api/v2/workspaces/local-space/clients", route => route.request().method() === "GET" ? route.fulfill({ json: clients }) : route.continue());
  await page.addInitScript(() => { localStorage.setItem("freelance-ops-ui-locale-v1", "ko"); localStorage.setItem("theme", "dark"); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  return state;
}

test("customer drafts survive selection, navigation and reload without writing to the server", async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/clients");
  await page.getByLabel("담당자 이름").fill("임시 고객");
  await page.getByLabel("관계 메모").fill("임시 메모");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await expect(page.locator("#client-editor-title")).toBeInViewport();
  await page.getByLabel("관계 메모").fill("고객 A 초안");
  await page.getByPlaceholder("이름, 회사, 이메일 검색").fill("고객 B");
  await expect(page.getByText("현재 편집 중인 고객은 검색 결과에 없습니다.")).toBeVisible();
  await page.locator(".client-list").getByRole("button", { name: /고객 B/ }).click();
  await expect(page.getByLabel("관계 메모")).toHaveValue("");
  await page.getByPlaceholder("이름, 회사, 이메일 검색").fill("");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await expect(page.getByLabel("관계 메모")).toHaveValue("고객 A 초안");
  await expect(page.getByRole("button", { name: /Original project title/ })).toBeVisible();
  await page.screenshot({ path: "outputs/ui-ux/projects-clients/clients-mobile.png" });
  await page.getByRole("button", { name: /Original project title/ }).click();
  await expect(page).toHaveURL(/\/projects\/project-one\//, { timeout: 30000 });
  await page.goto("/workspace/clients");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await expect(page.getByLabel("관계 메모")).toHaveValue("고객 A 초안");
  await page.reload();
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await expect(page.getByLabel("관계 메모")).toHaveValue("고객 A 초안");
  await page.getByRole("button", { name: "새 고객", exact: true }).click();
  await expect(page.getByLabel("담당자 이름")).toHaveValue("임시 고객");
  await expect(page.getByLabel("관계 메모")).toHaveValue("임시 메모");
  expect(state.writes).toEqual([]);
});

test("board stage navigation reveals the final column and list buttons have concise names", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/workspace/projects");
  const board = page.locator(".pipeline-board");
  await page.screenshot({ path: "outputs/ui-ux/projects-clients/board-desktop.png" });
  await page.getByRole("navigation", { name: "보드 단계로 이동" }).getByRole("button", { name: "결과 회고" }).click();
  await expect.poll(() => board.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "목록 보기" }).click();
  await expect(page.locator(".pipeline-list-open")).toHaveAccessibleName("Original project title 프로젝트 열기, 신규 문의");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a restored draft is blocked when the loaded customer version is newer", async ({ page }) => {
  const state = await setup(page);
  await page.addInitScript(() => {
    const key = "freelance-ops-client-drafts-v1:local-user:local-space";
    sessionStorage.setItem(key, JSON.stringify({ "client-a": { name: "고객 A", companyName: "회사 A", email: "", phone: "", notes: "이전 초안", baseVersion: 0 } }));
  });
  await page.goto("/workspace/clients");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "다른 곳에서 고객 정보가 변경되었습니다" })).toBeVisible();
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeDisabled();
  await expect(page.getByLabel("관계 메모")).toHaveValue("이전 초안");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "초안 버리기" }).click();
  await expect(page.getByLabel("관계 메모")).toHaveValue("");
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeEnabled();
  expect(state.writes).toEqual([]);
});

test("saving one customer clears only that customer's draft", async ({ page }) => {
  const state = await setup(page);
  await page.route("**/api/v2/workspaces/local-space/clients/client-a", async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    const input = route.request().postDataJSON();
    state.writes.push(input);
    return route.fulfill({ json: { ...clients[0], ...input, version: 2 } });
  });
  await page.goto("/workspace/clients");
  await page.getByLabel("담당자 이름").fill("새 고객 초안");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await page.getByLabel("관계 메모").fill("저장할 메모");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByText("고객 정보가 저장되었습니다.")).toBeVisible();
  await expect(page.getByText("저장하지 않은 입력을 이 탭에 보관 중입니다.")).toHaveCount(0);
  await page.getByRole("button", { name: "새 고객", exact: true }).click();
  await expect(page.getByLabel("담당자 이름")).toHaveValue("새 고객 초안");
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].notes).toBe("저장할 메모");
});

test("a delayed save does not erase a newer draft after leaving and returning", async ({ page }) => {
  const state = await setup(page);
  const barrier = requestBarrier();
  await page.route("**/api/v2/workspaces/local-space/clients/client-a", async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    const input = route.request().postDataJSON();
    state.writes.push(input);
    await barrier.wait();
    return route.fulfill({ json: { ...clients[0], ...input, version: 2 } });
  });
  await page.goto("/workspace/clients");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await page.getByLabel("관계 메모").fill("처음 저장한 메모");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await barrier.entered;
  await page.locator(".workspace-nav").getByRole("button", { name: "프로젝트 현황", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/projects$/);
  await page.goBack();
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await page.getByLabel("관계 메모").fill("새로 작성한 메모");
  const response = page.waitForResponse(result => result.url().endsWith("/clients/client-a") && result.request().method() === "PATCH");
  barrier.release();
  await response;
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("freelance-ops-client-drafts-v1:local-user:local-space"))?.["client-a"]?.notes)).toBe("새로 작성한 메모");
  expect(state.writes).toHaveLength(1);
});

test("a delayed save clears the same draft in the reopened editor", async ({ page }) => {
  await setup(page);
  const barrier = requestBarrier();
  await page.route("**/api/v2/workspaces/local-space/clients/client-a", async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    const input = route.request().postDataJSON();
    await barrier.wait();
    return route.fulfill({ json: { ...clients[0], ...input, version: 2 } });
  });
  await page.goto("/workspace/clients");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await page.getByLabel("관계 메모").fill("저장할 메모");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await barrier.entered;
  await page.locator(".workspace-nav").getByRole("button", { name: "프로젝트 현황", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/projects$/);
  await page.goBack();
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await expect(page.getByText("저장하지 않은 입력을 이 탭에 보관 중입니다.")).toBeVisible();
  const response = page.waitForResponse(result => result.url().endsWith("/clients/client-a") && result.request().method() === "PATCH");
  barrier.release();
  await response;
  await expect(page.getByText("저장하지 않은 입력을 이 탭에 보관 중입니다.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeEnabled();
  await page.locator(".client-list").getByRole("button", { name: /고객 B/ }).click();
  await page.getByLabel("관계 메모").fill("다른 고객의 초안");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("freelance-ops-client-drafts-v1:local-user:local-space"))?.["client-a"])).toBeUndefined();
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await page.getByLabel("관계 메모").fill("저장 후 새 변경");
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeEnabled();
  await expect(page.getByText("다른 곳에서 고객 정보가 변경되었습니다.", { exact: false })).toHaveCount(0);
});

test("a delayed creation opens the saved customer in the reopened editor", async ({ page }) => {
  await setup(page);
  const barrier = requestBarrier();
  await page.route("**/api/v2/workspaces/local-space/clients", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: clients });
    const input = route.request().postDataJSON();
    await barrier.wait();
    return route.fulfill({ json: { ...clients[0], ...input, id: "client-c", version: 1 } });
  });
  await page.goto("/workspace/clients");
  await page.getByLabel("담당자 이름").fill("새로 등록할 고객");
  await page.getByRole("button", { name: "고객 등록" }).click();
  await barrier.entered;
  await page.locator(".workspace-nav").getByRole("button", { name: "프로젝트 현황", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/projects$/);
  await page.goBack();
  await expect(page.getByLabel("담당자 이름")).toHaveValue("새로 등록할 고객");
  const response = page.waitForResponse(result => result.url().endsWith("/clients") && result.request().method() === "POST");
  barrier.release();
  await response;
  await expect(page.locator("#client-editor-title")).toHaveText("새로 등록할 고객");
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeVisible();
  await expect(page.getByText("저장하지 않은 입력을 이 탭에 보관 중입니다.")).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440]) {
  test(`${width}px English light mode keeps customer controls within the viewport`, async ({ page }) => {
    await setup(page);
    await page.addInitScript(() => { localStorage.setItem("freelance-ops-ui-locale-v1", "en"); localStorage.setItem("theme", "light"); });
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto("/workspace/clients");
    await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
    await expect(page.getByText("Individual client")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await page.locator(".clients-page input, .clients-page textarea, .clients-page button").evaluateAll(elements => elements.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
    }).length);
    expect(overflow).toBe(0);
  });
}
