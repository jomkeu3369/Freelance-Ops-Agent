import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const folder = (id, name, parentId = null) => ({ id, name, parentId, workspaceId: "local-space", version: 0 });
const rate = (id, name, folderId = null) => ({ id, name, folderId, workspaceId: "local-space", unit: "HOUR", rate: 100, minimumAmount: 0, currency: "KRW", active: true, version: 1 });
async function openLibrary(page, { width = 1440, locale = "ko", theme = "light", readOnly = false, longNames = false, initialFolders, initialCards } = {}) {
  const state = await fixture(page);
  if (readOnly) state.permissions = ["project.read", "quotation.read"];
  const server = {
    folders: initialFolders ?? [folder("dev", longNames ? "Development and implementation ".repeat(4) : "개발"), folder("design", "디자인"), folder("web", "웹", "dev"), folder("front", "프론트엔드", "web")],
    cards: initialCards ?? [rate("root", "미분류 서비스"), rate("web-rate", "웹 서비스", "web"), rate("front-rate", "프론트엔드 서비스", "front")],
    folderWrites: [], folderDeletes: [], folderReads: 0, rateWrites: [], moves: [], failRead: false, loseFolderResponse: false, loseDeleteResponse: false, failDelete: false, failMove: false, barrier: null, folderError: null
  };
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ locale, theme }) => {
    localStorage.setItem("freelance-ops-ui-locale-v1", locale);
    localStorage.setItem("theme", theme);
  }, { locale, theme });
  await page.route("**/api/v2/workspaces/local-space/rate-card-folders**", async route => {
    const request = route.request(), id = new URL(request.url()).pathname.split("/").at(-1);
    if (request.method() === "GET") { server.folderReads += 1; return route.fulfill({ status: server.failRead ? 503 : 200, json: server.failRead ? { message: "Synthetic folder read failure" } : server.folders }); }
    if (request.method() === "DELETE") {
      server.folderDeletes.push(id);
      if (server.failDelete) return route.fulfill({ status: 503, json: { message: "Synthetic folder delete failure" } });
      if (!server.folders.some(item => item.id === id)) return route.fulfill({ status: 404, json: { message: "Not Found" } });
      if (server.folders.some(item => item.parentId === id) || server.cards.some(item => item.folderId === id)) return route.fulfill({ status: 409, json: { message: "only empty folders can be deleted" } });
      server.folders = server.folders.filter(item => item.id !== id);
      if (server.loseDeleteResponse) { server.loseDeleteResponse = false; return route.fulfill({ status: 503, json: { message: "Synthetic lost delete response" } }); }
      return route.fulfill({ status: 204 });
    }
    const input = request.postDataJSON(); server.folderWrites.push({ id, input });
    if (server.folderError) return route.fulfill({ status: 409, json: { message: server.folderError } });
    const previous = server.folders.find(item => item.id === id);
    const unchanged = previous && previous.name === input.name && previous.parentId === input.parentId;
    if (!previous && input.expectedVersion != null || previous && !unchanged && (input.expectedVersion == null || previous.version !== input.expectedVersion)) return route.fulfill({ status: 409, json: { message: "folder changed; reload and try again" } });
    const saved = unchanged ? previous : { ...folder(id), name: input.name, parentId: input.parentId, version: previous ? previous.version + 1 : 0 };
    server.folders = [...server.folders.filter(item => item.id !== id), saved];
    if (server.loseFolderResponse) { server.loseFolderResponse = false; return route.fulfill({ status: 503, json: { message: "Synthetic lost folder response" } }); }
    return route.fulfill({ json: saved });
  });
  await page.route("**/api/v2/workspaces/local-space/rate-cards**", async route => {
    const request = route.request(), parts = new URL(request.url()).pathname.split("/");
    if (request.method() === "GET") return route.fulfill({ json: server.cards });
    const input = request.postDataJSON(), moving = parts.at(-1) === "folder", id = moving ? parts.at(-2) : parts.at(-1);
    if (moving) {
      server.moves.push({ id, input });
      if (server.failMove) return route.fulfill({ status: 503, json: { message: "Synthetic move failure" } });
    } else server.rateWrites.push({ id, input });
    if (server.barrier) await server.barrier.wait();
    const previous = server.cards.find(item => item.id === id);
    const saved = { ...rate(id, id), ...previous, ...input, version: (previous?.version ?? 0) + 1 };
    server.cards = [...server.cards.filter(item => item.id !== id), saved];
    return route.fulfill({ json: saved });
  });
  await page.goto("/workspace/settings");
  const library = page.locator(".rate-card-library");
  await expect(library.locator(".rate-folder-list > button")).toHaveCount(server.folders.filter(item => item.parentId === null).length);
  await page.evaluate(() => document.fonts.ready);
  return { library, state, server };
}
const folders = library => library.locator(".rate-folder-list > button");
const rates = library => library.locator(".rate-card-list > button");
const editor = library => library.locator(".rate-card-form");
async function fillRate(library, name, destination = "") {
  if (await editor(library).count() === 0) await library.getByRole("button", { name: "새 단가", exact: true }).click();
  await editor(library).getByLabel("서비스 이름", { exact: true }).fill(name);
  await editor(library).getByLabel("기본 단가", { exact: true }).fill("250");
  await editor(library).getByLabel("단가 폴더", { exact: true }).selectOption(destination);
}
async function saveFolder(library, name) {
  const form = library.locator(".rate-folder-form");
  await form.getByLabel("폴더 이름", { exact: true }).fill(name);
  await form.getByRole("button", { name: "폴더 저장", exact: true }).click();
  await expect(form).toHaveCount(0);
}
async function refreshFolders(page, accessToken) {
  await page.evaluate(accessToken => {
    const key = "freelance-ops-session-v1", session = JSON.parse(sessionStorage.getItem(key));
    const recovered = { ...session, accessToken, refreshToken: accessToken };
    sessionStorage.setItem(key, JSON.stringify(recovered));
    window.dispatchEvent(new CustomEvent("freelance-ops-session-recovery", { detail: recovered }));
  }, accessToken);
}

test("nested folders show only immediate children and their rates, with a return path", async ({ page }) => {
  const { library, state } = await openLibrary(page);
  await expect(rates(library)).toHaveText([/미분류 서비스/]);
  await folders(library).filter({ hasText: "개발" }).click();
  await expect(folders(library)).toHaveText([/웹/]);
  await expect(rates(library)).toHaveCount(0);
  await folders(library).filter({ hasText: "웹" }).click();
  await expect(rates(library)).toHaveText([/웹 서비스/]);
  await folders(library).filter({ hasText: "프론트엔드" }).click();
  await expect(rates(library)).toHaveText([/프론트엔드 서비스/]);
  await expect(library.locator(".rate-folder-breadcrumb")).toContainText("개발웹프론트엔드");
  expect((await library.locator(".rate-folder-breadcrumb").boundingBox()).height).toBeLessThan(80);
  await library.getByRole("button", { name: "전체 폴더", exact: true }).click();
  await expect(rates(library)).toHaveText([/미분류 서비스/]);
  expect(state.writes).toEqual([]);
  expect(state.starts).toEqual([]);
  expect(state.blocked).toEqual([]);
});

test("folders can be created, nested, renamed, moved and deleted when empty", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await library.getByRole("button", { name: "폴더 추가", exact: true }).click();
  await saveFolder(library, "새 분류");
  await folders(library).filter({ hasText: "새 분류" }).click();
  await library.getByRole("button", { name: "하위 폴더 추가", exact: true }).click();
  await saveFolder(library, "하위 분류");
  await folders(library).filter({ hasText: "하위 분류" }).click();
  await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
  await library.locator(".rate-folder-form").getByLabel("상위 폴더", { exact: true }).selectOption("design");
  await saveFolder(library, "이동한 분류");
  await expect(library.locator(".rate-folder-breadcrumb")).toContainText("디자인이동한 분류");
  await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
  await library.getByRole("button", { name: "폴더 삭제", exact: true }).click();
  await library.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(library.locator(".rate-folder-form")).toHaveCount(0);
  expect(server.folders.some(item => item.name === "이동한 분류")).toBe(false);
  await page.reload();
  await expect(folders(library).filter({ hasText: "새 분류" })).toBeVisible();
});

test("nonempty folder deletion is rejected and descendant destinations are excluded", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await folders(library).filter({ hasText: "개발" }).click();
  await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
  const form = library.locator(".rate-folder-form");
  await expect(form.getByLabel("상위 폴더", { exact: true }).locator("option")).toHaveText(["전체 폴더", "디자인"]);
  await form.getByRole("button", { name: "폴더 삭제", exact: true }).click();
  await form.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(library.getByRole("alert").filter({ hasText: "단가나 하위 폴더를 먼저" })).toBeVisible();
  expect(server.folders).toHaveLength(4);
});

test("a rate saved into another folder never reuses its identity for the next new rate", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await fillRate(library, "분류한 서비스", "front");
  await editor(library).getByRole("button", { name: "단가 등록", exact: true }).click();
  await expect(library.locator(".rate-card-manager .settings-saved")).toContainText("새 단가를 등록했습니다");
  await expect(editor(library)).toHaveCount(0);
  await fillRate(library, "다음 서비스");
  await editor(library).getByRole("button", { name: "단가 등록", exact: true }).click();
  await expect(rates(library)).toHaveCount(2);
  expect(server.rateWrites[0].id).not.toBe(server.rateWrites[1].id);
  expect(server.rateWrites[0].input).not.toHaveProperty("folderId");
  expect(server.cards.find(item => item.name === "분류한 서비스").folderId).toBe("front");
  await page.reload();
  await folders(library).filter({ hasText: "개발" }).click();
  await folders(library).filter({ hasText: "웹" }).click();
  await folders(library).filter({ hasText: "프론트엔드" }).click();
  await expect(rates(library)).toHaveCount(2);
});

test("same selection keeps a dirty draft and navigation confirmation cannot bypass a pending save", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await rates(library).first().click();
  await fillRate(library, "미저장 변경");
  await rates(library).first().click();
  await folders(library).filter({ hasText: "개발" }).click();
  await expect(library.getByRole("button", { name: "변경 버리고 이동", exact: true })).toBeVisible();
  await library.getByRole("button", { name: "계속 편집", exact: true }).click();
  await expect(editor(library).getByLabel("서비스 이름", { exact: true })).toHaveValue("미저장 변경");
  await folders(library).filter({ hasText: "개발" }).click();
  const barrier = requestBarrier(); server.barrier = barrier;
  try {
    await editor(library).getByRole("button", { name: "변경 저장", exact: true }).click();
    await barrier.entered;
    await expect(library.getByRole("button", { name: "변경 버리고 이동", exact: true })).toBeDisabled();
    await expect(folders(library).first()).toBeDisabled();
  } finally { barrier.release(); server.barrier = null; }
  await expect(library.locator(".rate-card-manager .settings-saved")).toContainText("단가 변경을 저장했습니다");
  await library.getByRole("button", { name: "계속 편집", exact: true }).click();
  expect(server.rateWrites).toHaveLength(1);
});

test("a failed folder move preserves the saved rate metadata and a retry uses the same identity", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await rates(library).first().click();
  await fillRate(library, "저장된 새 이름", "design"); server.failMove = true;
  await editor(library).getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(library.locator(".rate-card-manager .inline-error")).toContainText("단가는 저장했지만 폴더를 옮기지 못했습니다");
  await expect(editor(library).getByLabel("서비스 이름", { exact: true })).toHaveValue("저장된 새 이름");
  server.failMove = false;
  await editor(library).getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(library.locator(".rate-card-manager .settings-saved")).toContainText("단가 변경을 저장했습니다");
  expect(server.rateWrites.map(item => item.id)).toEqual(["root", "root"]);
  expect(server.cards.find(item => item.id === "root")).toMatchObject({ name: "저장된 새 이름", rate: 250, folderId: "design" });
});

test("lost folder creation responses retry the same folder identity", async ({ page }) => {
  const { library, server } = await openLibrary(page); server.loseFolderResponse = true;
  await library.getByRole("button", { name: "폴더 추가", exact: true }).click();
  const form = library.locator(".rate-folder-form");
  await form.getByLabel("폴더 이름", { exact: true }).fill("재시도 폴더");
  await form.getByRole("button", { name: "폴더 저장", exact: true }).click();
  await expect(library.getByRole("alert")).toContainText("Synthetic lost folder response");
  await form.getByRole("button", { name: "폴더 저장", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(server.folderWrites[0].id).toBe(server.folderWrites[1].id);
  expect(server.folderWrites[0].input).not.toHaveProperty("expectedVersion");
  expect(server.folders.filter(item => item.name === "재시도 폴더")).toHaveLength(1);
});

test("a stale rename and reparent cannot recreate a folder deleted by another PC", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await folders(library).filter({ hasText: "디자인" }).click();
  await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
  const form = library.locator(".rate-folder-form");
  await form.getByLabel("폴더 이름", { exact: true }).fill("삭제 후 수정");
  await form.getByLabel("상위 폴더", { exact: true }).selectOption("dev");
  server.folders = server.folders.filter(item => item.id !== "design");
  await form.getByRole("button", { name: "폴더 저장", exact: true }).click();
  await expect(library.getByRole("alert")).toContainText("폴더가 변경되었습니다");
  await expect(form.getByLabel("폴더 이름", { exact: true })).toHaveValue("삭제 후 수정");
  await expect(form.getByLabel("상위 폴더", { exact: true })).toHaveValue("dev");
  expect(server.folderWrites).toEqual([{ id: "design", input: { name: "삭제 후 수정", parentId: "dev", expectedVersion: 0 } }]);
  expect(server.folders.some(item => item.id === "design")).toBe(false);
});

test("an open edit keeps its original version across a background folder refresh", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await folders(library).filter({ hasText: "디자인" }).click();
  await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
  const form = library.locator(".rate-folder-form");
  await form.getByLabel("폴더 이름", { exact: true }).fill("열린 초안");
  await form.getByLabel("상위 폴더", { exact: true }).selectOption("dev");
  server.folders = server.folders.map(item => item.id === "design" ? { ...item, name: "다른 PC 최신 이름", version: 1 } : item);
  await refreshFolders(page, "changed-folder-token");
  await expect(library.locator(".rate-folder-breadcrumb")).toContainText("다른 PC 최신 이름");
  await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
  await form.getByRole("button", { name: "폴더 저장", exact: true }).click();
  await expect(library.getByRole("alert")).toContainText("폴더가 변경되었습니다");
  expect(server.folderWrites[0].input.expectedVersion).toBe(0);
  expect(server.folders.find(item => item.id === "design")).toMatchObject({ name: "다른 PC 최신 이름", parentId: null, version: 1 });
  await expect(form.getByLabel("폴더 이름", { exact: true })).toHaveValue("열린 초안");
  await expect(form.getByLabel("상위 폴더", { exact: true })).toHaveValue("dev");
  await form.getByRole("button", { name: "취소", exact: true }).click();
  await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
  await saveFolder(library, "최신 버전에서 편집");
  expect(server.folderWrites[1].input.expectedVersion).toBe(1);
});

test("a lost folder edit response retries its original version without another revision", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await folders(library).filter({ hasText: "디자인" }).click();
  await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
  const form = library.locator(".rate-folder-form");
  await form.getByLabel("폴더 이름", { exact: true }).fill("편집 응답 재시도");
  server.loseFolderResponse = true;
  await form.getByRole("button", { name: "폴더 저장", exact: true }).click();
  await expect(library.getByRole("alert")).toContainText("Synthetic lost folder response");
  await form.getByRole("button", { name: "폴더 저장", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(server.folderWrites.map(item => item.input.expectedVersion)).toEqual([0, 0]);
  expect(server.folders.find(item => item.id === "design").version).toBe(1);
});

for (const scenario of ["deleted elsewhere", "lost response", "lost response and failed read", "failed deletion"]) {
  test(`folder deletion verifies absence after ${scenario}`, async ({ page }) => {
    const { library, server } = await openLibrary(page);
    await folders(library).filter({ hasText: "디자인" }).click();
    await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
    await library.getByRole("button", { name: "폴더 삭제", exact: true }).click();
    if (scenario === "deleted elsewhere") server.folders = server.folders.filter(item => item.id !== "design");
    else if (scenario === "failed deletion") server.failDelete = true;
    else server.loseDeleteResponse = true;
    if (scenario === "lost response and failed read") server.failRead = true;
    await library.getByRole("button", { name: "삭제 확인", exact: true }).click();
    if (scenario === "lost response and failed read" || scenario === "failed deletion") {
      await expect(library.getByRole("alert").filter({ hasText: "Synthetic" })).toBeVisible();
      await expect(library.locator(".rate-folder-form")).toBeVisible();
      server.failRead = false; server.failDelete = false;
      await library.getByRole("button", { name: "삭제 확인", exact: true }).click();
    }
    await expect(library.locator(".rate-folder-form")).toHaveCount(0);
    await expect(library.locator(".rate-folder-breadcrumb")).toHaveText("전체 폴더");
    await expect(folders(library).filter({ hasText: "디자인" })).toHaveCount(0);
    await expect(library.getByRole("status")).toContainText("빈 폴더를 삭제했습니다");
    expect(server.folderReads).toBeGreaterThan(1);
    expect(server.folderDeletes).toHaveLength(scenario === "lost response and failed read" || scenario === "failed deletion" ? 2 : 1);
  });
}

for (const [message, expected] of [
  ["a workspace can contain at most 200 rate-card folders", "이 작업 공간에는 폴더를 최대 200개까지 만들 수 있습니다."],
  ["rate-card folders can be nested at most 8 levels", "폴더는 루트를 포함해 최대 8단계까지 중첩할 수 있습니다."]
]) {
  test(`folder capacity errors keep the draft retryable: ${message}`, async ({ page }) => {
    const { library, server } = await openLibrary(page); server.folderError = message;
    await library.getByRole("button", { name: "폴더 추가", exact: true }).click();
    const form = library.locator(".rate-folder-form");
    await form.getByLabel("폴더 이름", { exact: true }).fill("재시도할 분류");
    await form.getByRole("button", { name: "폴더 저장", exact: true }).click();
    await expect(library.getByRole("alert")).toHaveText(expected);
    await expect(form.getByLabel("폴더 이름", { exact: true })).toHaveValue("재시도할 분류");
    await expect(form.locator(".rate-folder-limits")).toContainText("200개");
    expect(server.folders).toHaveLength(4);
    server.folderError = null;
    await form.getByRole("button", { name: "폴더 저장", exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(server.folderWrites[0].id).toBe(server.folderWrites[1].id);
  });
}

test("deactivation after a partial folder save preserves the newly saved name and price", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await rates(library).first().click();
  await fillRate(library, "이미 저장한 이름", "design"); server.failMove = true;
  await editor(library).getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(library.locator(".rate-card-manager .inline-error")).toBeVisible();
  await editor(library).getByRole("button", { name: "비활성화", exact: true }).click();
  await editor(library).locator(".archive-confirm").getByRole("button", { name: "비활성화", exact: true }).click();
  await expect(library.locator(".rate-card-manager .settings-saved")).toContainText("선택 항목에서 제외했습니다");
  expect(server.rateWrites.at(-1).input).toMatchObject({ name: "이미 저장한 이름", rate: 250, active: false });
  await expect(editor(library).getByLabel("단가 폴더", { exact: true })).toHaveValue("design");
  await expect(editor(library).getByLabel("서비스 이름", { exact: true })).toHaveValue("이미 저장한 이름");
  await folders(library).filter({ hasText: "개발" }).click();
  await expect(library.getByRole("button", { name: "변경 버리고 이동", exact: true })).toBeVisible();
  await library.getByRole("button", { name: "계속 편집", exact: true }).click();
  server.failMove = false;
  await editor(library).getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(library.locator(".rate-card-manager .settings-saved")).toContainText("단가 변경을 저장했습니다");
  expect(server.cards.find(item => item.id === "root")).toMatchObject({ name: "이미 저장한 이름", rate: 250, active: false, folderId: "design" });
});

test("toggling a dirty rate preserves every unsaved field and selected destination", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await rates(library).first().click();
  await fillRate(library, "토글 중 유지할 초안", "design");
  await editor(library).getByRole("button", { name: "비활성화", exact: true }).click();
  await editor(library).locator(".archive-confirm").getByRole("button", { name: "비활성화", exact: true }).click();
  await expect(library.locator(".rate-card-manager .settings-saved")).toContainText("선택 항목에서 제외했습니다");
  await expect(editor(library).getByLabel("서비스 이름", { exact: true })).toHaveValue("토글 중 유지할 초안");
  await expect(editor(library).getByLabel("기본 단가", { exact: true })).toHaveValue("250");
  await expect(editor(library).getByLabel("단가 폴더", { exact: true })).toHaveValue("design");
  expect(server.cards.find(item => item.id === "root")).toMatchObject({ name: "미분류 서비스", rate: 100, active: false, folderId: null });
  await editor(library).getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(library.locator(".rate-card-manager .settings-saved")).toContainText("단가 변경을 저장했습니다");
  expect(server.cards.find(item => item.id === "root")).toMatchObject({ name: "토글 중 유지할 초안", rate: 250, active: false, folderId: "design" });
});

test("a folder deleted elsewhere does not discard a new rate draft on refresh", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await folders(library).filter({ hasText: "디자인" }).click();
  await fillRate(library, "다른 PC 변경에도 보존", "design");
  server.folders = server.folders.filter(item => item.id !== "design");
  await page.evaluate(() => {
    const key = "freelance-ops-session-v1", session = JSON.parse(sessionStorage.getItem(key));
    const recovered = { ...session, accessToken: "folder-deleted-token", refreshToken: "folder-deleted-token" };
    sessionStorage.setItem(key, JSON.stringify(recovered));
    window.dispatchEvent(new CustomEvent("freelance-ops-session-recovery", { detail: recovered }));
  });
  await expect(library.getByRole("status")).toContainText("다른 곳에서 이 폴더를 삭제했습니다");
  await expect(editor(library).getByLabel("서비스 이름", { exact: true })).toHaveValue("다른 PC 변경에도 보존");
  await editor(library).getByRole("button", { name: "단가 등록", exact: true }).click();
  await expect(library.locator(".rate-card-manager .settings-saved")).toContainText("새 단가를 등록했습니다");
  expect(server.cards.find(item => item.name === "다른 PC 변경에도 보존").folderId).toBeNull();
});

test("background folder read failure keeps rate draft mounted until retry recovers", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await fillRate(library, "보존할 초안"); server.failRead = true;
  await page.evaluate(() => {
    const key = "freelance-ops-session-v1", session = JSON.parse(sessionStorage.getItem(key));
    const recovered = { ...session, accessToken: "refreshed-token", refreshToken: "refreshed-token" };
    sessionStorage.setItem(key, JSON.stringify(recovered));
    window.dispatchEvent(new CustomEvent("freelance-ops-session-recovery", { detail: recovered }));
  });
  await expect(library.getByRole("alert")).toContainText("폴더를 불러오지 못했습니다");
  await expect(editor(library).getByLabel("서비스 이름", { exact: true })).toHaveValue("보존할 초안");
  server.failRead = false;
  await library.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(library.getByRole("alert")).toHaveCount(0);
  await expect(editor(library).getByLabel("서비스 이름", { exact: true })).toHaveValue("보존할 초안");
});

test("editing a folder deleted elsewhere never creates a replacement folder", async ({ page }) => {
  const { library, server } = await openLibrary(page);
  await folders(library).filter({ hasText: "디자인" }).click();
  await library.getByRole("button", { name: "폴더 관리", exact: true }).click();
  await library.locator(".rate-folder-form").getByLabel("폴더 이름", { exact: true }).fill("수정 중 이름");
  server.folders = server.folders.filter(item => item.id !== "design");
  await page.evaluate(() => {
    const key = "freelance-ops-session-v1", session = JSON.parse(sessionStorage.getItem(key));
    const recovered = { ...session, accessToken: "deleted-edit-token", refreshToken: "deleted-edit-token" };
    sessionStorage.setItem(key, JSON.stringify(recovered));
    window.dispatchEvent(new CustomEvent("freelance-ops-session-recovery", { detail: recovered }));
  });
  await expect(library.getByRole("status")).toContainText("다른 곳에서 이 폴더를 삭제했습니다");
  await expect(library.getByRole("button", { name: "폴더 저장", exact: true })).toBeDisabled();
  expect(server.folderWrites).toEqual([]);
});

for (const [width, locale, theme] of [[1440, "ko", "light"], [842, "en", "light"], [390, "ko", "dark"], [320, "en", "dark"]]) {
  test(`${width}px ${locale} ${theme}: long nested folder controls stay inside the card`, async ({ page }) => {
    const { library, state } = await openLibrary(page, { width, locale, theme, longNames: true });
    await folders(library).filter({ hasText: "Development" }).click();
    await folders(library).filter({ hasText: "웹" }).click();
    await library.getByRole("button", { name: locale === "en" ? "Manage folder" : "폴더 관리", exact: true }).click();
    const clipped = await library.locator("nav, .rate-folder-form, label, input, select, button, .rate-card-form").evaluateAll(elements => {
      const bounds = elements[0].closest("#rate-cards").getBoundingClientRect();
      return elements.filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
      }).map(element => element.tagName);
    });
    expect(clipped).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440 || width === 320) await library.screenshot({ path: `outputs/ui-ux/rate-folders-${width}-${locale}.png` });
    expect(state.blocked).toEqual([]);
  });
}

test("read-only nested folder browsing exposes saved rates without mutation controls", async ({ page }) => {
  const { library, server } = await openLibrary(page, { width: 320, readOnly: true });
  await folders(library).filter({ hasText: "개발" }).click();
  await folders(library).filter({ hasText: "웹" }).click();
  await expect(rates(library)).toHaveText([/웹 서비스/]);
  await expect(editor(library)).toHaveCount(0);
  await expect(library.getByRole("button", { name: "하위 폴더 추가", exact: true })).toHaveCount(0);
  expect(server.folderWrites).toEqual([]);
  expect(server.rateWrites).toEqual([]);
});

for (const [width, locale, theme] of [[1440, "ko", "light"], [390, "ko", "dark"], [320, "en", "dark"]]) {
  test(`${width}px ${locale}: a truly empty library starts collapsed and opens only on request`, async ({ page }) => {
    const { library, server } = await openLibrary(page, { width, locale, theme, initialFolders: [], initialCards: [] });
    await expect(editor(library)).toHaveCount(0);
    await expect(library.locator(".rate-card-toolbar")).toHaveText(locale === "en" ? /No rates yet\. Add your first rate\./ : /등록된 단가가 없습니다\. 첫 단가를 추가하세요\./);
    await library.getByRole("button", { name: locale === "en" ? "New rate" : "새 단가", exact: true }).click();
    await expect(editor(library)).toBeVisible();
    await expect(editor(library).getByRole("textbox")).toHaveValue("");
    await editor(library).getByRole("button", { name: locale === "en" ? "Close" : "닫기", exact: true }).click();
    await expect(editor(library)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(server.rateWrites).toEqual([]);
  });

  test(`${width}px ${locale}: organized rates and empty folders explain their actual contents`, async ({ page }) => {
    const { library, server } = await openLibrary(page, { width, locale, theme, initialCards: [rate("web-rate", "웹 서비스", "web"), rate("front-rate", "프론트엔드 서비스", "front")] });
    await expect(editor(library)).toHaveCount(0);
    await expect(rates(library)).toHaveCount(0);
    await expect(library.locator(".rate-card-toolbar")).toContainText(locale === "en" ? "All rates are organized into folders." : "모든 단가가 폴더에 정리되어 있습니다.");
    const development = folders(library).filter({ hasText: "개발" });
    await expect(development.locator("small")).toHaveText(locale === "en" ? "Total rates 2 · Subfolders 1" : "전체 단가 2개 · 하위 폴더 1개");
    await development.click();
    await expect(editor(library)).toHaveCount(0);
    await expect(library.locator(".rate-card-toolbar")).toContainText(locale === "en" ? "The rates in this folder are organized into subfolders." : "이 폴더의 단가는 하위 폴더에 정리되어 있습니다.");
    await library.getByRole("button", { name: locale === "en" ? "All folders" : "전체 폴더", exact: true }).click();
    await folders(library).filter({ hasText: "디자인" }).click();
    await expect(editor(library)).toHaveCount(0);
    await expect(library.locator(".rate-card-toolbar")).toContainText(locale === "en" ? "No rates are registered in this folder." : "이 폴더에 등록된 단가가 없습니다.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(server.rateWrites).toEqual([]);
  });
}

for (const locale of ["ko", "en"]) {
  test(`${locale}: folder totals include every nested and inactive rate without counting another branch`, async ({ page }) => {
    const { library, server } = await openLibrary(page, { locale, initialCards: [
      rate("root", "미분류 서비스"), rate("dev-rate", "개발 직접 단가", "dev"), rate("web-rate", "웹 서비스", "web"),
      rate("front-rate", "프론트엔드 서비스", "front"), { ...rate("inactive-rate", "비활성 프론트엔드", "front"), active: false }, rate("design-rate", "디자인 서비스", "design")
    ] });
    const count = (rates, folders) => locale === "en" ? `Total rates ${rates} · Subfolders ${folders}` : `전체 단가 ${rates}개 · 하위 폴더 ${folders}개`;
    await expect(folders(library).filter({ hasText: "개발" }).locator("small")).toHaveText(count(4, 1));
    await expect(folders(library).filter({ hasText: "디자인" }).locator("small")).toHaveText(count(1, 0));
    await folders(library).filter({ hasText: "개발" }).click();
    await expect(folders(library).filter({ hasText: "웹" }).locator("small")).toHaveText(count(3, 1));
    await folders(library).filter({ hasText: "웹" }).click();
    await expect(folders(library).filter({ hasText: "프론트엔드" }).locator("small")).toHaveText(count(2, 0));
    await expect(editor(library)).toHaveCount(0);
    expect(server.rateWrites).toEqual([]);
  });
}
