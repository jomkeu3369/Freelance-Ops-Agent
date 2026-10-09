import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const companion = page => page.locator(".workspace-companion");
const pet = (id, name, archived = false) => ({ id, archived, revision: 1, profile: {
  petId: id, slot: "RECOMMENDED", name, animal: "cat", color: "sky", accessory: "scarf", tone: "WARM",
  valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED", duty: "GENERAL"
} });
function collection(pets = [], selectedPetId = null) {
  return { pets, selectedPetId, maxActivePets: 8, maxStoredPets: 24, maxPromptLength: 500, maxPreferenceRequests: 6, generationMode: "RULE_BASED_PREVIEW", aiGenerationAvailable: false };
}
async function companionFixture(page) {
  const state = await fixture(page);
  state.permissions.push("client.read", "document.read");
  const server = {
    libraries: { "local-space": collection([pet("first", "나만의 친구")], "first"), "other-space": collection([pet("other", "다른 공간 친구")], "other") },
    account: "local-user", nextRead: null, nextMutation: null, readFailures: 0, reads: [], mutations: [], blocked: state.blocked
  };
  await page.route("**/api/v2/me", route => route.fulfill({ json: { id: server.account, displayName: "Fixture", email: "fixture@example.invalid", workspaces: ["local-space", "other-space"].map(workspaceId => ({ workspaceId, name: workspaceId, effectivePermissions: state.permissions })) } }));
  await page.route("**/api/v2/workspaces/other-space/projects", route => route.fulfill({ json: [] }));
  await page.route("**/api/v2/workspaces/other-space/clients", route => route.fulfill({ json: [] }));
  await page.route("**/api/v2/auth/logout", route => route.fulfill({ status: 204 }));
  await page.route("**/api/v2/auth/login", route => route.fulfill({ json: {
    userId: server.account, workspaceId: "local-space", accessToken: `fixture-${server.account}`, refreshToken: `fixture-${server.account}`,
    accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer"
  } }));
  await page.route("**/api/v2/workspaces/*/agent-pets**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const workspace = url.pathname.split("/")[4];
    const library = server.libraries[workspace];
    if (request.method() === "GET") {
      server.reads.push(workspace);
      const snapshot = structuredClone(library);
      const barrier = server.nextRead;
      server.nextRead = null;
      const failed = server.readFailures > 0;
      if (failed) server.readFailures--;
      if (barrier) await barrier.wait();
      return route.fulfill({ status: failed ? 503 : 200, json: failed ? { message: "Fixture unavailable" } : snapshot });
    }
    server.mutations.push(request.method());
    if (request.method() === "PATCH") {
      const target = library.pets.find(item => item.id === url.pathname.split("/").at(-1));
      const { action } = request.postDataJSON();
      if (action === "SELECT") library.selectedPetId = target.id;
      if (action === "ARCHIVE") { target.archived = true; target.revision++; if (library.selectedPetId === target.id) library.selectedPetId = null; }
      const barrier = server.nextMutation; server.nextMutation = null;
      if (barrier) await barrier.wait();
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 400, json: {} });
  });
  page.on("pageerror", error => { (server.errors ??= []).push(error.message); });
  return { state, server };
}

for (const [width, height] of [[320, 568], [390, 844], [821, 800], [844, 390], [1024, 768], [1440, 900]]) {
  test(`${width}×${height}: persistent companion stays clear of chat, attachments and header controls`, async ({ page }) => {
    const { state, server } = await companionFixture(page);
    await page.setViewportSize({ width, height });
    await page.goto(path);
    await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 나만의 친구");
    await page.locator("#agent-chat-input").fill("작성하던 내용 그대로");
    await page.getByLabel("첨부파일 선택").setInputFiles({ name: "companion-fixture.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic unsent attachment") });
    await expect(page.locator(".chat-attachments")).toContainText("companion-fixture.txt");
    const bounds = await companion(page).boundingBox();
    const portrait = await page.locator(".workspace-companion-portrait").boundingBox();
    const artwork = await companion(page).locator("svg").first().boundingBox();
    expect(portrait.width).toBeGreaterThanOrEqual(36);
    expect(portrait.height).toBeGreaterThanOrEqual(40);
    expect(artwork.height).toBeGreaterThanOrEqual(40);
    const title = await page.locator(".workspace-page-label").boundingBox();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(title.x);
    const caption = page.locator(".workspace-companion-caption");
    if (await caption.isVisible()) {
      const box = await caption.boundingBox();
      expect(box.height).toBeGreaterThan(20);
      expect(box.x + box.width).toBeLessThanOrEqual(title.x);
    }
    for (const selector of [".workspace-account-actions", ".sidebar-toggle", ".agent-chat-composer", ".chat-attachments"]) {
      const target = await page.locator(selector).boundingBox();
      expect(target).not.toBeNull();
      const overlap = bounds.x < target.x + target.width && bounds.x + bounds.width > target.x && bounds.y < target.y + target.height && bounds.y + bounds.height > target.y;
      expect(overlap, selector).toBe(false);
    }
    const submit = await page.locator('.agent-chat-composer button[type="submit"]').boundingBox();
    expect(submit.y + submit.height).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(await companion(page).evaluate(node => node.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await page.screenshot({ path: `outputs/ui-ux/workspace-companion-${width}-${height}.png` });
    expect(server.mutations).toEqual([]); expect(state.starts).toEqual([]); expect(state.blocked).toEqual([]);
    expect(server.errors ?? []).toEqual([]);
  });
}

test("same companion node survives route navigation, sidebar collapse, Back and Forward", async ({ page }) => {
  const { state, server } = await companionFixture(page);
  await page.goto(path);
  await expect(companion(page)).toHaveAttribute("data-companion", "selected");
  await companion(page).evaluate(node => { node.dataset.persistenceMarker = "same-node"; });
  await page.getByRole("button", { name: "고객 관리", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/clients$/);
  await expect(companion(page)).toHaveAttribute("data-persistence-marker", "same-node");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/settings$/);
  await page.goBack(); await page.goBack(); await expect(page).toHaveURL(new RegExp(`${path}$`));
  await page.goForward(); await expect(page).toHaveURL(/\/workspace\/clients$/);
  await page.getByRole("button", { name: "메뉴 접기", exact: true }).click();
  await expect(companion(page)).toBeVisible();
  await expect(companion(page)).toHaveAttribute("data-persistence-marker", "same-node");
  expect(server.reads).toEqual(["local-space"]); expect(state.starts).toEqual([]);
});

test("empty or archived selection keeps the exact login friend without selecting a library pet", async ({ page }) => {
  const { state, server } = await companionFixture(page);
  server.libraries["local-space"] = collection([pet("archived", "보관된 친구", true), pet("unselected", "선택하지 않은 친구")], "archived");
  await page.goto(path);
  await expect(companion(page)).toHaveAttribute("data-companion", "login");
  await expect(companion(page).locator("image")).toHaveAttribute("href", "/login/pet-path-poster-v1.webp");
  expect(server.libraries["local-space"].selectedPetId).toBe("archived");
  expect(server.mutations).toEqual([]); expect(state.starts).toEqual([]);
  await page.screenshot({ path: "outputs/ui-ux/workspace-companion-login-friend.png" });
});

test("customizer changes update the companion and accepted archive clears it even if the reload fails", async ({ page }) => {
  const { state, server } = await companionFixture(page);
  server.libraries["local-space"].pets.push(pet("second", "두 번째 친구"));
  await page.goto(path);
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 나만의 친구");
  await page.getByRole("button", { name: "AI 설정 열기" }).click();
  const studio = page.locator(".pet-prompt-studio");
  const second = studio.locator(".pet-library article").filter({ hasText: "두 번째 친구" });
  await second.getByRole("button", { name: "이 펫 선택" }).click();
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 두 번째 친구");
  server.readFailures = 1;
  await second.getByRole("button", { name: "보관", exact: true }).click();
  await expect(studio.getByRole("status").last()).toContainText("입력은 유지");
  await expect(companion(page)).toHaveAttribute("data-companion", "login");
  await studio.getByRole("button", { name: "목록 다시 불러오기" }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(1);
  await expect(companion(page)).toHaveAttribute("data-companion", "login");
  expect(server.libraries["local-space"].selectedPetId).toBeNull(); expect(state.starts).toEqual([]);
});

test("delayed personal pet response cannot cross a workspace switch", async ({ page }) => {
  const { server } = await companionFixture(page);
  const barrier = requestBarrier(); server.nextRead = barrier;
  await page.goto(path); await barrier.entered;
  await page.locator(".workspace-switcher select").selectOption("other-space");
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 다른 공간 친구");
  const response = page.waitForResponse(value => value.url().endsWith("/local-space/agent-pets"));
  barrier.release(); await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 다른 공간 친구");
  expect(server.errors ?? []).toEqual([]);
});

test("logout removes the companion immediately and a late response cannot leak into another account", async ({ page }) => {
  const { server } = await companionFixture(page);
  const barrier = requestBarrier(); server.nextRead = barrier;
  await page.goto(path); await barrier.entered;
  await page.locator(".sidebar-foot button").click();
  await expect(companion(page)).toHaveCount(0);
  server.account = "other-user";
  server.libraries["local-space"] = collection([pet("other-account", "새 계정 친구")], "other-account");
  await page.locator('input[name="email"]').fill("other@example.invalid");
  await page.locator('input[name="password"]').fill("synthetic-password");
  await page.locator('button[type="submit"]').click();
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 새 계정 친구");
  const response = page.waitForResponse(value => value.url().endsWith("/local-space/agent-pets"));
  barrier.release(); await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 새 계정 친구");
  expect(server.errors ?? []).toEqual([]);
});

test("failed pet read leaves chat usable and online recovery restores the selected friend", async ({ page }) => {
  const { state, server } = await companionFixture(page); server.readFailures = 1;
  await page.goto(path);
  await expect.poll(() => server.reads.length).toBe(1);
  await expect(companion(page)).toHaveAttribute("data-companion", "login");
  await page.locator("#agent-chat-input").fill("원문 유지");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(companion(page)).toHaveAttribute("data-companion", "selected");
  await expect(page.locator("#agent-chat-input")).toHaveValue("원문 유지");
  expect(state.starts).toEqual([]); expect(server.mutations).toEqual([]);
});

test("read-only members keep the login friend without requesting agent-only data", async ({ page }) => {
  const { state, server } = await companionFixture(page);
  state.permissions = ["project.read"];
  await page.goto("/workspace/projects");
  await expect(companion(page)).toHaveAttribute("data-companion", "login");
  expect(server.reads).toEqual([]); expect(server.mutations).toEqual([]);
});

test("reduced motion and keyboard dialogs leave the still companion noninteractive and custom names untranslated", async ({ page }) => {
  const { state, server } = await companionFixture(page);
  server.libraries["local-space"].pets[0].profile.name = "차근";
  await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(path);
  await expect(companion(page)).toHaveAttribute("aria-label", "Your companion: 차근");
  expect(await companion(page).evaluate(node => [...node.querySelectorAll("*")].every(child => getComputedStyle(child).animationName === "none"))).toBe(true);
  expect(await companion(page).locator("button, a, [tabindex]").count()).toBe(0);
  const settings = page.getByRole("button", { name: "Open AI settings" });
  await settings.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "AI settings", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(settings).toBeFocused();
  await page.locator(".workspace-theme-toggle").click();
  await expect(companion(page)).toBeVisible();
  const caption = companion(page).locator("small");
  await expect(caption).toHaveText("Always by your side");
  expect(await caption.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: "outputs/ui-ux/workspace-companion-dark.png" });
  expect(state.starts).toEqual([]); expect(server.errors ?? []).toEqual([]);
});

test("an old closed customizer refresh cannot overwrite a newer selection", async ({ page }) => {
  const { server } = await companionFixture(page);
  server.libraries["local-space"].pets.push(pet("second", "두 번째 친구"));
  await page.goto(path);
  await expect(companion(page)).toHaveAttribute("data-companion", "selected");
  await page.getByRole("button", { name: "AI 설정 열기" }).click();
  let studio = page.locator(".pet-prompt-studio");
  await expect(studio.getByRole("button", { name: "선택됨", exact: true })).toBeEnabled();
  const barrier = requestBarrier(); server.nextRead = barrier;
  await studio.getByRole("button", { name: "선택됨", exact: true }).click();
  await barrier.entered;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "AI 설정 열기" }).click();
  studio = page.locator(".pet-prompt-studio");
  await studio.locator(".pet-library article").filter({ hasText: "두 번째 친구" }).getByRole("button", { name: "이 펫 선택" }).click();
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 두 번째 친구");
  const response = page.waitForResponse(value => value.url().endsWith("/agent-pets"));
  barrier.release(); await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 두 번째 친구");
});

test("a selection accepted after closing settings still refreshes the companion", async ({ page }) => {
  const { server } = await companionFixture(page);
  server.libraries["local-space"].pets.push(pet("second", "두 번째 친구"));
  await page.goto(path);
  await expect(companion(page)).toHaveAttribute("data-companion", "selected");
  await page.getByRole("button", { name: "AI 설정 열기" }).click();
  const barrier = requestBarrier(); server.nextMutation = barrier;
  await page.locator(".pet-library article").filter({ hasText: "두 번째 친구" }).getByRole("button", { name: "이 펫 선택" }).click();
  await barrier.entered;
  await page.keyboard.press("Escape");
  await expect(page.locator(".pet-prompt-studio")).toHaveCount(0);
  barrier.release();
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 두 번째 친구");
});

test("closing settings during an accepted selection's reload still updates the header", async ({ page }) => {
  const { server } = await companionFixture(page);
  server.libraries["local-space"].pets.push(pet("second", "두 번째 친구"));
  await page.goto(path);
  await expect(companion(page)).toHaveAttribute("data-companion", "selected");
  await page.getByRole("button", { name: "AI 설정 열기" }).click();
  await expect(page.locator(".pet-library article")).toHaveCount(2);
  const barrier = requestBarrier(); server.nextRead = barrier;
  await page.locator(".pet-library article").filter({ hasText: "두 번째 친구" }).getByRole("button", { name: "이 펫 선택" }).click();
  await barrier.entered;
  await page.keyboard.press("Escape");
  await expect(page.locator(".pet-prompt-studio")).toHaveCount(0);
  barrier.release();
  await expect(companion(page)).toHaveAttribute("aria-label", "함께하는 동료: 두 번째 친구");
});
