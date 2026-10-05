import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

async function petsFixture(page) {
  const state = await fixture(page);
  const library = { pets: [], selectedPetId: null, maxActivePets: 2, maxStoredPets: 3, maxPromptLength: 500, maxPreferenceRequests: 6, generationMode: "RULE_BASED_PREVIEW", aiGenerationAvailable: false };
  const calls = [];
  let lostResponse = false;
  await page.route("**/api/v2/workspaces/local-space/agent-pets**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? req.postDataJSON() : null;
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (req.method() === "GET") return json(library);
    calls.push({ method: req.method(), path: url.pathname, body });
    const prior = library.pets.find(pet => pet.id === body?.id);
    if (url.pathname.endsWith("/preview")) return json({
      slot: "RECOMMENDED", name: "일정 친구", animal: "cat", color: "sky", accessory: "scarf", tone: "WARM",
      valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED", duty: "SCHEDULE", petId: body.id, skillMode: "AUTO",
      preferences: { personality: "", communication: "", focus: "", responsibility: "", requests: [...(prior?.profile.preferences.requests ?? []), body.description] }
    });
    if (req.method() === "POST") {
      let pet = prior;
      if (!pet) {
        const preview = calls.filter(call => call.path.endsWith("/preview")).at(-1).body;
        pet = { id: body.id, archived: false, revision: 1, profile: { slot: "RECOMMENDED", petId: body.id, name: "일정 친구", animal: "cat", color: "sky", accessory: "scarf", tone: "WARM", valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED", duty: "SCHEDULE", skillMode: "AUTO", preferences: { personality: "", communication: "", focus: "", responsibility: "", requests: [preview.description] } } };
        library.pets.push(pet); library.selectedPetId = pet.id;
      }
      if (!lostResponse) { lostResponse = true; return json({ message: "Lost response after save" }, 503); }
      return json(pet);
    }
    const pet = library.pets.find(value => value.id === url.pathname.split("/").at(-1));
    if (req.method() === "PATCH") {
      if (body.action === "SELECT") library.selectedPetId = pet.id;
      else { pet.archived = body.action === "ARCHIVE"; pet.revision++; if (pet.archived) library.selectedPetId = null; }
      return json(null);
    }
    if (req.method() === "DELETE") { library.pets = library.pets.filter(value => value.id !== pet.id); return json(null); }
    return json({}, 404);
  });
  return { state, library, calls };
}

test("one prompt previews, preserves unknown wording, retries one save, archives and restores", async ({ page }) => {
  const { state, library, calls } = await petsFixture(page);
  await page.goto("/workspace/projects/project-one/agent");
  await page.getByRole("button", { name: "AI 설정 열기" }).click();
  const studio = page.locator(".pet-prompt-studio");
  const prompt = "친근하게 일정 관리. 말투는 우주선 선장처럼, 고객에게 먼저 묻기";
  await studio.getByRole("textbox").fill(prompt);
  await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
  await expect(studio.locator(".pet-composed-preview")).toContainText(prompt);
  await expect(studio.locator(".pet-composed-preview")).toContainText("모두 이해해 분류했다는 뜻은 아닙니다");
  expect(library.pets).toHaveLength(0);
  const save = studio.getByRole("button", { name: "저장하고 선택", exact: true });
  await save.click();
  await expect(studio.getByRole("status").last()).toContainText("입력은 유지");
  await save.evaluate(button => { button.click(); button.click(); });
  await expect(studio.locator(".pet-library article")).toHaveCount(1);
  const writes = calls.filter(call => call.method === "POST" && !call.path.endsWith("preview"));
  expect(writes).toHaveLength(2);
  expect(writes[0].body).toEqual(writes[1].body);
  expect(library.pets).toHaveLength(1);
  expect(state.starts).toHaveLength(0);
  await studio.getByRole("button", { name: "보관", exact: true }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(0);
  expect(library.selectedPetId).toBeNull();
  await studio.locator(".pet-archive summary").click();
  await studio.getByRole("button", { name: "복원", exact: true }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(1);
  expect(library.selectedPetId).toBeNull();
  await studio.getByRole("button", { name: "이 펫 선택", exact: true }).click();
  await expect(studio.getByRole("button", { name: "선택됨", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(state.starts).toHaveLength(0);
  expect(state.blocked).toEqual([]);
});

test("cancelled preview never saves, draft is protected and mobile fits", async ({ page }) => {
  const { library, calls } = await petsFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/projects/project-one/agent");
  await page.getByRole("button", { name: "AI 설정 열기" }).click();
  const studio = page.locator(".pet-prompt-studio");
  await studio.getByRole("textbox").fill("말투: 느긋하고 다정하게; 중점: 번역의 뉘앙스");
  await expect(studio.getByRole("button", { name: "새 펫 추가" })).toBeDisabled();
  await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
  await studio.getByRole("button", { name: "입력으로 돌아가기" }).click();
  await expect(studio.getByRole("textbox")).toHaveValue("말투: 느긋하고 다정하게; 중점: 번역의 뉘앙스");
  expect(calls).toHaveLength(1);
  expect(library.pets).toHaveLength(0);
  await page.screenshot({ path: "outputs/ui-ux/custom-pets-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("login uses the cinematic shell without the removed demo note or generated-media requests", async ({ page }) => {
  const unexpected = [];
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
    unexpected.push(url.pathname); return route.abort();
  });
  await page.goto("/workspace");
  await expect(page.locator(".auth-cinematic")).toBeVisible();
  await expect(page.locator(".pet-login-demo")).toHaveCount(0);
  await expect(page.getByText("예시 미리보기입니다. 로그인 후 나만의 펫을 추가하고 대화로 수정할 수 있어요.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "absent");
  await expect(page.locator(".auth-backdrop video")).toBeHidden();
    await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
  expect(unexpected).toEqual([]);
});
