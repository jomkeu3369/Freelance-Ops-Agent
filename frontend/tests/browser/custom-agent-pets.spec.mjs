import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

function storedPet(id, name, { archived = false, revision = 1, requests = ["기존 선호"] } = {}) {
  return { id, archived, revision, profile: {
    slot: "RECOMMENDED", petId: id, name, animal: "cat", color: "sky", accessory: "scarf", tone: "WARM",
    valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED", duty: "SCHEDULE", skillMode: "AUTO",
    preferences: { personality: "", communication: "", focus: "", responsibility: "", requests }
  } };
}

async function petsFixture(page, options = {}) {
  const state = await fixture(page);
  const library = { pets: [], selectedPetId: null, maxActivePets: 2, maxStoredPets: 3, maxPromptLength: 500, maxPreferenceRequests: 6, generationMode: "RULE_BASED_PREVIEW", aiGenerationAvailable: false, ...options };
  const calls = [];
  const server = { lostSaveResponses: 1, listFailures: 0, previewFailures: 0, nextList: null, nextPreview: null, nextSave: null, listReads: 0 };
  const mutations = new Map();
  function compose(body, prior) {
    const profile = structuredClone(prior?.profile ?? storedPet(body.id, "일정 친구").profile);
    profile.preferences.requests = [...(body.resetPreferences ? [] : prior?.profile.preferences.requests ?? []), body.description];
    return profile;
  }
  await page.route("**/api/v2/workspaces/local-space/agent-pets**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? req.postDataJSON() : null;
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (req.method() === "GET") {
      server.listReads++;
      const snapshot = structuredClone(library);
      const fail = server.listFailures > 0;
      if (fail) server.listFailures--;
      const barrier = server.nextList;
      server.nextList = null;
      if (barrier) await barrier.wait();
      return fail ? json({ message: "List unavailable" }, 503) : json(snapshot);
    }
    calls.push({ method: req.method(), path: url.pathname, body });
    const prior = library.pets.find(pet => pet.id === body?.id);
    if (url.pathname.endsWith("/preview")) {
      const barrier = server.nextPreview;
      server.nextPreview = null;
      if (barrier) await barrier.wait();
      if (server.previewFailures > 0) { server.previewFailures--; return json({ message: "Preview unavailable" }, 503); }
      if (body.expectedRevision > 0 && (!prior || prior.archived || prior.revision !== body.expectedRevision)) return json({ message: "PET_REVISION_CHANGED" }, 409);
      const profile = compose(body, prior);
      if (profile.preferences.requests.length > library.maxPreferenceRequests) return json({ message: "PET_PREFERENCES_FULL" }, 422);
      return json(profile);
    }
    if (req.method() === "POST") {
      const key = `${body.id}:${body.mutationId}`;
      if (mutations.has(key)) {
        if (mutations.get(key) !== JSON.stringify(body) || !prior || prior.archived || prior.revision !== body.expectedRevision + 1) return json({ message: "PET_REQUEST_REUSED" }, 409);
        return json(prior);
      }
      if (body.expectedRevision === 0 && (prior || library.pets.length >= library.maxStoredPets || library.pets.filter(pet => !pet.archived).length >= library.maxActivePets)) return json({ message: "PET_CAPACITY_OR_ID_CONFLICT" }, 409);
      if (body.expectedRevision > 0 && (!prior || prior.archived || prior.revision !== body.expectedRevision)) return json({ message: "PET_REVISION_CHANGED" }, 409);
      const profile = compose(body, prior);
      if (profile.preferences.requests.length > library.maxPreferenceRequests) return json({ message: "PET_PREFERENCES_FULL" }, 422);
      const pet = { id: body.id, archived: false, revision: body.expectedRevision + 1, profile };
      library.pets = [...library.pets.filter(value => value.id !== body.id), pet];
      library.selectedPetId = pet.id;
      mutations.set(key, JSON.stringify(body));
      const barrier = server.nextSave;
      server.nextSave = null;
      if (barrier) await barrier.wait();
      if (server.lostSaveResponses > 0) { server.lostSaveResponses--; return json({ message: "Lost response after save" }, 503); }
      return json(pet);
    }
    const pet = library.pets.find(value => value.id === url.pathname.split("/").at(-1));
    if (!pet) return json({ message: "PET_NOT_FOUND" }, 404);
    if (req.method() === "PATCH") {
      if (body.expectedRevision !== pet.revision) return json({ message: "PET_REVISION_CHANGED" }, 409);
      if (body.action === "SELECT") {
        if (pet.archived) return json({ message: "PET_ARCHIVED" }, 409);
        library.selectedPetId = pet.id;
      } else if (body.action === "ARCHIVE" || body.action === "RESTORE") {
        const archive = body.action === "ARCHIVE";
        if (archive !== pet.archived) {
          if (!archive && library.pets.filter(value => !value.archived).length >= library.maxActivePets) return json({ message: "PET_ACTIVE_LIMIT" }, 409);
          pet.archived = archive; pet.revision++;
          if (archive && library.selectedPetId === pet.id) library.selectedPetId = null;
        }
      } else return json({}, 422);
      return json(null);
    }
    if (req.method() === "DELETE") {
      if (!pet.archived || Number(url.searchParams.get("revision")) !== pet.revision) return json({ message: "PET_DELETE_CONFLICT" }, 409);
      library.pets = library.pets.filter(value => value.id !== pet.id);
      if (library.selectedPetId === pet.id) library.selectedPetId = null;
      return json(null);
    }
    return json({}, 404);
  });
  return { state, library, calls, server };
}

async function openStudio(page) {
  await page.goto("/workspace/projects/project-one/agent");
  await page.getByRole("button", { name: "AI 설정 열기" }).click();
  const studio = page.locator(".pet-prompt-studio");
  await expect(studio.getByRole("textbox")).toBeEnabled();
  return studio;
}

function expectNoGeneration(state) {
  expect(state.starts).toHaveLength(0);
  expect(state.writes).toEqual([]);
  expect(state.blocked).toEqual([]);
}

test("lost save refresh keeps its mutation at capacity, then retries once, archives and restores", async ({ page }) => {
  const { state, library, calls } = await petsFixture(page, { maxActivePets: 1 });
  const studio = await openStudio(page);
  const prompt = "친근하게 일정 관리. 말투는 우주선 선장처럼, 고객에게 먼저 묻기";
  await studio.getByRole("textbox").fill(prompt);
  await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
  await expect(studio.locator(".pet-composed-preview")).toContainText(prompt);
  await expect(studio.locator(".pet-composed-preview")).toContainText("모두 이해해 분류했다는 뜻은 아닙니다");
  expect(library.pets).toHaveLength(0);
  const save = studio.getByRole("button", { name: "저장하고 선택", exact: true });
  await save.click();
  await expect(studio.getByRole("status").last()).toContainText("입력은 유지");
  await studio.getByRole("button", { name: "목록 다시 불러오기" }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(1);
  await expect(studio.getByRole("textbox")).toHaveValue(prompt);
  await expect(studio.locator(".pet-composed-preview")).toContainText(prompt);
  await expect(studio.getByRole("button", { name: "새 펫 추가" })).toBeDisabled();
  await expect(save).toBeEnabled();
  await save.evaluate(button => { button.click(); button.click(); });
  await expect(studio.locator(".pet-composed-preview")).toHaveCount(0);
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
  expectNoGeneration(state);
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

test("failed preview and repeated clicks preserve an edit until explicit cancel", async ({ page }) => {
  const { state, library, calls, server } = await petsFixture(page, { pets: [storedPet("pet-one", "기존 친구")] });
  server.previewFailures = 1;
  const studio = await openStudio(page);
  await studio.getByRole("button", { name: "대화로 수정" }).click();
  const prompt = "중점: 일정 변경을 알려줘";
  await studio.getByRole("textbox").fill(prompt);
  await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
  await expect(studio.getByRole("status").last()).toContainText("입력은 유지");
  await expect(studio.getByRole("textbox")).toHaveValue(prompt);
  const barrier = requestBarrier();
  server.nextPreview = barrier;
  await studio.getByRole("button", { name: "펫 미리보기", exact: true }).evaluate(button => { button.click(); button.click(); });
  await barrier.entered;
  try {
    await expect(studio.getByRole("textbox")).toBeDisabled();
    await expect(studio.getByRole("button", { name: "입력 취소", exact: true })).toBeDisabled();
    await expect(studio.getByRole("button", { name: "목록 다시 불러오기" })).toBeDisabled();
    expect(calls).toHaveLength(2);
  } finally { barrier.release(); }
  await expect(studio.getByRole("list", { name: "보존된 선호 요청" })).toContainText("기존 선호");
  await expect(studio.locator(".pet-composed-preview")).toContainText(prompt);
  await studio.getByRole("button", { name: "입력으로 돌아가기" }).click();
  await expect(studio.getByRole("textbox")).toHaveValue(prompt);
  await studio.getByRole("textbox").fill("수정한 선호");
  await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
  await expect(studio.locator(".pet-composed-preview")).toContainText("수정한 선호");
  expect(calls).toHaveLength(3);
  expect(calls.every(call => call.path.endsWith("/preview"))).toBe(true);
  expect(calls.every(call => call.body.id === "pet-one" && call.body.expectedRevision === 1)).toBe(true);
  expect(new Set(calls.map(call => call.body.mutationId)).size).toBe(3);
  await studio.getByRole("button", { name: "입력으로 돌아가기" }).click();
  await studio.getByRole("button", { name: "입력 취소", exact: true }).click();
  await expect(studio.getByRole("textbox")).toHaveValue("");
  await expect(studio.getByRole("button", { name: "새 펫 추가" })).toBeEnabled();
  expect(library.pets[0].revision).toBe(1);
  expectNoGeneration(state);
});

test("closing an in-flight preview does not resurrect it when settings reopen", async ({ page }) => {
  const { state, library, calls, server } = await petsFixture(page);
  const studio = await openStudio(page);
  await studio.getByRole("textbox").fill("닫기 전에 작성한 선호");
  const barrier = requestBarrier();
  server.nextPreview = barrier;
  await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
  await barrier.entered;
  try {
    await page.getByRole("dialog", { name: "AI 설정", exact: true }).getByRole("button", { name: "닫기", exact: true }).click();
    await expect(studio).toHaveCount(0);
    await expect(page.getByRole("button", { name: "AI 설정 열기" })).toBeFocused();
    await page.getByRole("button", { name: "AI 설정 열기" }).click();
    await expect(studio.getByRole("textbox")).toBeEnabled();
  } finally {
    const latePreview = page.waitForResponse(response => response.url().endsWith("/agent-pets/preview"));
    barrier.release();
    await (await latePreview).finished();
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(studio.getByRole("textbox")).toHaveValue("");
  await expect(studio.locator(".pet-composed-preview")).toHaveCount(0);
  expect(calls).toHaveLength(1);
  expect(library.pets).toHaveLength(0);
  expectNoGeneration(state);
});

test("active and stored capacity stay separate and deleting requires confirmation", async ({ page }) => {
  const pets = [storedPet("pet-one", "선택한 친구"), storedPet("pet-two", "다른 친구"), storedPet("pet-three", "보관 친구", { archived: true })];
  const { state, library, calls } = await petsFixture(page, { pets, selectedPetId: "pet-one" });
  const studio = await openStudio(page);
  const active = studio.locator(".pet-library article");
  await expect(active).toHaveCount(2);
  await expect(studio.getByRole("button", { name: "새 펫 추가" })).toBeDisabled();
  await studio.locator(".pet-archive summary").click();
  await expect(studio.getByRole("button", { name: "복원", exact: true })).toBeDisabled();
  await active.filter({ hasText: "다른 친구" }).getByRole("button", { name: "보관", exact: true }).click();
  await expect(active).toHaveCount(1);
  expect(library.selectedPetId).toBe("pet-one");
  await expect(studio.getByRole("button", { name: "새 펫 추가" })).toBeDisabled();
  const archived = studio.locator(".pet-archive > div").filter({ hasText: "보관 친구" });
  await expect(archived.getByRole("button", { name: "복원", exact: true })).toBeEnabled();
  await archived.getByRole("button", { name: "삭제", exact: true }).click();
  await archived.getByRole("button", { name: "취소", exact: true }).click();
  expect(calls.filter(call => call.method === "DELETE")).toHaveLength(0);
  await expect(archived.getByRole("button", { name: "영구 삭제", exact: true })).toHaveCount(0);
  await archived.getByRole("button", { name: "삭제", exact: true }).click();
  await archived.getByRole("button", { name: "영구 삭제", exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(archived).toHaveCount(0);
  await expect(studio.getByRole("button", { name: "새 펫 추가" })).toBeEnabled();
  expect(calls.filter(call => call.method === "DELETE")).toHaveLength(1);
  expect(library.pets).toHaveLength(2);
  expectNoGeneration(state);
});

test("restoring and deleting archived pets preserve a different pet's unsaved edit", async ({ page }) => {
  const pets = [storedPet("pet-one", "수정할 친구"), storedPet("pet-two", "복원할 친구", { archived: true }), storedPet("pet-three", "삭제할 친구", { archived: true })];
  const { state, calls, server } = await petsFixture(page, { pets });
  server.lostSaveResponses = 0;
  const studio = await openStudio(page);
  await studio.getByRole("button", { name: "대화로 수정" }).click();
  const prompt = "말투: 선호를 그대로 보존해 줘";
  await studio.getByRole("textbox").fill(prompt);
  await expect(studio.getByRole("button", { name: "보관", exact: true })).toBeDisabled();
  await studio.locator(".pet-archive summary").click();
  const deleted = studio.locator(".pet-archive > div").filter({ hasText: "삭제할 친구" });
  await deleted.getByRole("button", { name: "삭제", exact: true }).click();
  await deleted.getByRole("button", { name: "영구 삭제", exact: true }).click();
  await expect(deleted).toHaveCount(0);
  await expect(studio.getByRole("textbox")).toHaveValue(prompt);
  await studio.getByRole("button", { name: "복원", exact: true }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(2);
  await expect(studio.getByRole("textbox")).toHaveValue(prompt);
  await expect(studio.getByRole("textbox")).toHaveAccessibleName("수정할 친구 · 어떻게 바꿀까요?");
  await expect(studio.getByRole("button", { name: "펫 미리보기", exact: true })).toBeEnabled();
  await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
  await expect(studio.getByRole("list", { name: "보존된 선호 요청" }).getByRole("listitem")).toHaveText(["기존 선호", prompt]);
  await studio.getByRole("button", { name: "저장하고 선택", exact: true }).click();
  await expect(studio.locator(".pet-composed-preview")).toHaveCount(0);
  expect(calls.at(-1).body).toMatchObject({ id: "pet-one", expectedRevision: 1, description: prompt, resetPreferences: false });
  expectNoGeneration(state);
});

test("full preference history requires explicit reset and preview back preserves that choice", async ({ page }) => {
  const requests = Array.from({ length: 6 }, (_, index) => `선호 ${index + 1}`);
  const { state, library, calls, server } = await petsFixture(page, { pets: [storedPet("pet-one", "기록 친구", { requests })] });
  server.lostSaveResponses = 0;
  const studio = await openStudio(page);
  await studio.getByRole("button", { name: "대화로 수정" }).click();
  await studio.getByRole("textbox").fill("기존 선호를 다시 정리한 설명");
  const preview = studio.getByRole("button", { name: "펫 미리보기", exact: true });
  await expect(preview).toBeDisabled();
  expect(calls).toHaveLength(0);
  await studio.getByRole("checkbox").check();
  await preview.click();
  await expect(studio.getByRole("list", { name: "보존된 선호 요청" }).getByRole("listitem")).toHaveText(["기존 선호를 다시 정리한 설명"]);
  await studio.getByRole("button", { name: "입력으로 돌아가기" }).click();
  await expect(studio.getByRole("checkbox")).toBeChecked();
  await expect(studio.getByRole("textbox")).toHaveValue("기존 선호를 다시 정리한 설명");
  await studio.getByRole("button", { name: "입력 취소", exact: true }).click();
  await expect(studio.getByRole("checkbox")).not.toBeChecked();
  await expect(studio.getByRole("textbox")).toHaveValue("");
  await studio.getByRole("textbox").fill("최종 선호");
  await studio.getByRole("checkbox").check();
  await preview.click();
  await studio.getByRole("button", { name: "저장하고 선택", exact: true }).click();
  await expect(studio.locator(".pet-composed-preview")).toHaveCount(0);
  expect(library.pets[0].revision).toBe(2);
  expect(library.pets[0].profile.preferences.requests).toEqual(["최종 선호"]);
  expect(calls.filter(call => !call.path.endsWith("/preview"))).toHaveLength(1);
  expectNoGeneration(state);
});

test("save success followed by failed list refresh retries the same mutation without duplication", async ({ page }) => {
  const { state, library, calls, server } = await petsFixture(page);
  server.lostSaveResponses = 0;
  const studio = await openStudio(page);
  await studio.getByRole("textbox").fill("목록 요청 실패에도 유지할 선호");
  await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
  server.listFailures = 1;
  await studio.getByRole("button", { name: "저장하고 선택", exact: true }).click();
  await expect(studio.getByRole("status").last()).toContainText("입력은 유지");
  await expect(studio.locator(".pet-composed-preview")).toBeVisible();
  expect(library.pets).toHaveLength(1);
  await studio.getByRole("button", { name: "저장하고 선택", exact: true }).click();
  await expect(studio.locator(".pet-composed-preview")).toHaveCount(0);
  await expect(studio.locator(".pet-library article")).toHaveCount(1);
  const writes = calls.filter(call => !call.path.endsWith("/preview"));
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(library.pets).toHaveLength(1);
  expect(library.pets[0].revision).toBe(1);
  expectNoGeneration(state);
});

for (const staleFailure of [false, true]) {
  test(`older manual reload ${staleFailure ? "failure" : "snapshot"} cannot overwrite a completed save`, async ({ page }) => {
    const { state, library, server } = await petsFixture(page);
    server.lostSaveResponses = 0;
    const studio = await openStudio(page);
    await studio.getByRole("textbox").fill("최신 저장을 유지해 줘");
    await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
    await expect(studio.locator(".pet-composed-preview")).toBeVisible();
    const barrier = requestBarrier();
    server.nextList = barrier;
    server.listFailures = staleFailure ? 1 : 0;
    await studio.getByRole("button", { name: "목록 다시 불러오기" }).click();
    await barrier.entered;
    try {
      await studio.getByRole("button", { name: "저장하고 선택", exact: true }).click();
      await expect(studio.locator(".pet-composed-preview")).toHaveCount(0);
      await expect(studio.locator(".pet-library article")).toHaveCount(1);
      await expect(studio.getByRole("status").last()).toContainText("저장하고 선택했습니다");
    } finally {
      const staleResponse = page.waitForResponse(response => response.request().method() === "GET" && response.url().endsWith("/agent-pets"));
      barrier.release();
      await (await staleResponse).finished();
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(studio.locator(".pet-library article")).toHaveCount(1);
    await expect(studio.getByRole("button", { name: "선택됨", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(studio.getByRole("status").last()).toContainText("저장하고 선택했습니다");
    expect(library.pets).toHaveLength(1);
    expectNoGeneration(state);
  });
}

test("login honors reduced motion without the removed demo note or generation requests", async ({ page }) => {
  const unexpected = [];
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
    unexpected.push(url.pathname); return route.abort();
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workspace");
  await expect(page.locator(".auth-cinematic")).toBeVisible();
  await expect(page.locator(".pet-login-demo")).toHaveCount(0);
  await expect(page.getByText("예시 미리보기입니다. 로그인 후 나만의 펫을 추가하고 대화로 수정할 수 있어요.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "disabled");
  await expect(page.locator(".auth-backdrop video")).toBeHidden();
  await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
  expect(unexpected).toEqual([]);
});
