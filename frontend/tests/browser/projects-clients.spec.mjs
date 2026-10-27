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
  await expect(page.getByRole("alert").filter({ hasText: "다른 곳에서 고객 정보가 변경되어" })).toBeVisible();
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
  expect(state.writes[0].expectedVersion).toBe(1);
});

test("two editors preserve the stale draft and require an explicit comparison before retry", async ({ page, context }) => {
  const other = await context.newPage();
  await setup(page);
  await setup(other);
  let current = { ...clients[0] };
  const writes = [];
  let failRead = false;
  const attach = async (tab) => {
    await tab.route("**/api/v2/workspaces/local-space/clients", route => route.fulfill({ json: [current, clients[1]] }));
    await tab.route("**/api/v2/workspaces/local-space/clients/client-a", route => {
      if (route.request().method() === "GET") return failRead ? route.fulfill({ status: 503, json: { message: "unavailable" } }) : route.fulfill({ json: current });
      const input = route.request().postDataJSON();
      writes.push(input);
      if (input.expectedVersion !== current.version) return route.fulfill({ status: 409, json: { code: "CONCURRENT_MODIFICATION", detail: "stale" } });
      current = { ...current, ...input, version: current.version + 1 };
      return route.fulfill({ json: current });
    });
  };
  await attach(page);
  await attach(other);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/clients");
  await other.goto("/workspace/clients");
  for (const tab of [page, other]) await tab.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await page.getByLabel("관계 메모").fill("첫 번째 탭의 초안");
  await other.getByLabel("관계 메모").fill("다른 PC에서 저장한 내용");
  await other.getByRole("button", { name: "변경 저장" }).click();
  await expect(other.getByText("고객 정보가 저장되었습니다.")).toBeVisible();
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "변경되어 저장하지 않았습니다" })).toBeVisible();
  await expect(page.getByLabel("관계 메모")).toHaveValue("첫 번째 탭의 초안");
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeDisabled();
  failRead = true;
  await page.getByRole("button", { name: "최신 고객 정보 확인" }).click();
  await expect(page.getByText("최신 고객 정보를 불러오지 못했습니다.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("관계 메모")).toHaveValue("첫 번째 탭의 초안");
  failRead = false;
  await page.getByRole("button", { name: "최신 고객 정보 확인" }).click();
  await expect(page.locator(".client-conflict-latest")).toContainText("다른 PC에서 저장한 내용");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".client-conflict").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "outputs/ui-ux/projects-clients/client-conflict-mobile.png" });
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "비교 후 초안 계속 편집" }).click();
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeDisabled();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "비교 후 초안 계속 편집" }).click();
  await expect(page.getByLabel("관계 메모")).toHaveValue("첫 번째 탭의 초안");
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeEnabled();
  current = { ...current, notes: "검토 중 다시 변경됨", version: current.version + 1 };
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "변경되어 저장하지 않았습니다" })).toBeVisible();
  await expect(page.getByLabel("관계 메모")).toHaveValue("첫 번째 탭의 초안");
  expect(current.notes).toBe("검토 중 다시 변경됨");
  await page.getByRole("button", { name: "최신 고객 정보 확인" }).click();
  await expect(page.locator(".client-conflict-latest")).toContainText("검토 중 다시 변경됨");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "비교 후 초안 계속 편집" }).click();
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByText("고객 정보가 저장되었습니다.")).toBeVisible();
  expect(writes.map(input => input.expectedVersion)).toEqual([1, 1, 2, 3]);
  expect(current.notes).toBe("첫 번째 탭의 초안");
  await other.close();
});

test("a delayed conflict is shown in the reopened customer editor", async ({ page }) => {
  await setup(page);
  const barrier = requestBarrier();
  await page.route("**/api/v2/workspaces/local-space/clients/client-a", async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    await barrier.wait();
    return route.fulfill({ status: 409, json: { code: "CONCURRENT_MODIFICATION", detail: "stale" } });
  });
  await page.goto("/workspace/clients");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await page.getByLabel("관계 메모").fill("잃지 않을 초안");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await barrier.entered;
  await page.locator(".workspace-nav").getByRole("button", { name: "프로젝트 현황", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/projects$/);
  await page.goBack();
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  const response = page.waitForResponse(result => result.url().endsWith("/clients/client-a") && result.request().method() === "PATCH");
  barrier.release();
  await response;
  await expect(page.getByRole("alert").filter({ hasText: "변경되어 저장하지 않았습니다" })).toBeVisible();
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeDisabled();
  await expect(page.getByLabel("관계 메모")).toHaveValue("잃지 않을 초안");
});

test("an archived client stays blocked after the unsaved draft is discarded", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v2/workspaces/local-space/clients/client-a", route => route.request().method() === "GET"
    ? route.fulfill({ json: { ...clients[0], status: "ARCHIVED", version: 2 } })
    : route.fulfill({ status: 409, json: { code: "CONCURRENT_MODIFICATION" } }));
  await page.goto("/workspace/clients");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await page.getByLabel("관계 메모").fill("보관 전에 작성한 초안");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await page.getByRole("button", { name: "최신 고객 정보 확인" }).click();
  await expect(page.getByText("이 고객은 보관되어 더 이상 수정할 수 없습니다.")).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "초안 버리기" }).click();
  await expect(page.getByRole("button", { name: "변경 저장" })).toBeDisabled();
  await expect(page.getByText("이 고객은 보관되어 더 이상 수정할 수 없습니다.")).toBeVisible();
});

test("a duplicate-email conflict is not mistaken for a stale version", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v2/workspaces/local-space/clients/client-a", route => route.fulfill({ status: 409, json: { detail: "an active client already uses this email" } }));
  await page.goto("/workspace/clients");
  await page.locator(".client-list").getByRole("button", { name: /고객 A/ }).click();
  await page.getByLabel("이메일").fill("duplicate@example.invalid");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "an active client already uses this email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "최신 고객 정보 확인" })).toHaveCount(0);
  await expect(page.getByLabel("이메일")).toHaveValue("duplicate@example.invalid");
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
  await expect(page.getByText("다른 곳에서 고객 정보가 변경되어", { exact: false })).toHaveCount(0);
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
