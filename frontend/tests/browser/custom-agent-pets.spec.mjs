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
  const library = { pets: [], selectedPetId: null, maxActivePets: 2, maxStoredPets: 3, maxPromptLength: 500, maxPreferenceRequests: 6, generationMode: "MODEL_PIXEL", aiGenerationAvailable: true, ...options };
  const calls = [];
  const server = { lostSaveResponses: 1, listFailures: 0, previewFailures: 0, nextList: null, nextPreview: null, nextSave: null, listReads: 0 };
  const mutations = new Map();
  const generations = new Map();
  function compose(body, prior) {
    const profile = structuredClone(prior?.profile ?? storedPet(body.id, "일정 친구").profile);
    profile.preferences.requests = [...(body.resetPreferences ? [] : prior?.profile.preferences.requests ?? []), body.description];
    return profile;
  }
  await page.route("**/api/v2/workspaces/local-space/agent-pets**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const payload = req.postData() ? req.postDataJSON() : null;
    const body = url.pathname.endsWith("/generations") ? payload.input : payload;
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (req.method() === "GET" && url.pathname.includes("/generations/")) {
      const job = generations.get(url.pathname.split("/").at(-1));
      return job ? json(job) : json({ code: "PET_GENERATION_NOT_FOUND" }, 404);
    }
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
    if (url.pathname.endsWith("/generations")) {
      if (generations.has(body.mutationId)) return json(generations.get(body.mutationId));
      const job = { id: body.mutationId, status: "REQUESTED", profile: null, errorCode: null };
      generations.set(job.id, job);
      const barrier = server.nextPreview;
      server.nextPreview = null;
      if (barrier) await barrier.wait();
      if (server.previewFailures > 0) { server.previewFailures--; job.status = "FAILED"; job.errorCode = "PET_GENERATION_FAILED"; return json(job); }
      if (body.expectedRevision > 0 && (!prior || prior.archived || prior.revision !== body.expectedRevision)) return json({ message: "PET_REVISION_CHANGED" }, 409);
      const profile = compose(body, prior);
      if (profile.preferences.requests.length > library.maxPreferenceRequests) return json({ message: "PET_PREFERENCES_FULL" }, 422);
      job.status = "COMPLETED";
      job.profile = profile;
      return json(job);
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
      return route.fulfill({ status: 200, body: "" });
    }
    if (req.method() === "DELETE") {
      if (!pet.archived || Number(url.searchParams.get("revision")) !== pet.revision) return json({ message: "PET_DELETE_CONFLICT" }, 409);
      library.pets = library.pets.filter(value => value.id !== pet.id);
      if (library.selectedPetId === pet.id) library.selectedPetId = null;
      return route.fulfill({ status: 200, body: "" });
    }
    return json({}, 404);
  });
  return { state, library, calls, server };
}

async function openStudio(page, { create = true } = {}) {
  await page.goto("/workspace/projects/project-one/agent");
  await page.getByRole("button", { name: "펫 만들기·관리", exact: true }).click();
  const studio = page.locator(".pet-prompt-studio");
  await expect(studio.locator(".pet-library")).toHaveAttribute("aria-busy", "false");
  const createButton = studio.getByRole("button", { name: "펫 만들기", exact: true });
  if (create && !await createButton.isDisabled()) await createButton.click();
  return studio;
}

async function openPetActions(scope) {
  const actions = scope.locator(".pet-library-actions").first();
  if (await actions.getAttribute("open") === null) await actions.locator("summary").click();
}

function expectNoAnalysis(state) {
  expect(state.starts).toHaveLength(0);
  expect(state.writes).toEqual([]);
  expect(state.blocked).toEqual([]);
}

test("빈 성공 응답을 받은 펫 선택은 오류 없이 갱신되고 다시 불러와도 유지된다", async ({ page }) => {
  const { state, library, calls } = await petsFixture(page, {
    pets: [storedPet("pet-one", "기존 동료"), storedPet("pet-two", "새 동료")],
    selectedPetId: "pet-one"
  });
  const studio = await openStudio(page, { create: false });
  await studio.getByRole("button", { name: "새 동료 · 이 펫 선택", exact: true }).click();
  const selected = studio.getByRole("button", { name: "새 동료 · 선택됨", exact: true });
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(studio.getByText("다음 실행에 사용할 펫을 선택했습니다.", { exact: true })).toBeVisible();
  await expect(studio.getByText(/완료하지 못했습니다/)).toHaveCount(0);
  await studio.getByRole("button", { name: "목록 다시 불러오기", exact: true }).click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(library.selectedPetId).toBe("pet-two");
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe("PATCH");
  expectNoAnalysis(state);
});

for (const width of [390, 1440]) {
  test(`${width}px: generation and edit return keyboard focus to the next step`, async ({ page }) => {
    const { state, calls } = await petsFixture(page);
    await page.setViewportSize({ width, height: 844 });
    const studio = await openStudio(page);
    const prompt = studio.getByRole("textbox");
    await expect(prompt).toBeFocused();
    const description = "말투: 차분하게; 중점: 견적에서 빠뜨린 일 찾기";
    await prompt.fill(description);
    await studio.getByRole("button", { name: "펫 생성하기", exact: true }).click();
    const result = studio.getByRole("region", { name: "생성된 펫 확인", exact: true });
    await expect(result).toBeFocused();
    await expect(result).toBeInViewport();
    await studio.getByRole("button", { name: "설명 수정", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(prompt).toBeFocused();
    await expect(prompt).toHaveValue(description);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toMatch(/\/generations$/);
    expectNoAnalysis(state);
  });
}

test("editing an existing pet focuses its description without starting a model", async ({ page }) => {
  const { state, calls } = await petsFixture(page, { pets: [storedPet("pet-one", "견적 친구")] });
  const studio = await openStudio(page, { create: false });
  await openPetActions(studio);
  await studio.getByRole("button", { name: "대화로 수정", exact: true }).click();
  await expect(studio.getByRole("textbox", { name: "바꾸고 싶은 점", exact: true })).toBeFocused();
  expect(calls).toHaveLength(0);
  expectNoAnalysis(state);
});

test("lost save preserves the result at capacity, then retry archives and restores one pet", async ({ page }) => {
  const { state, library, calls } = await petsFixture(page, { maxActivePets: 1 });
  const studio = await openStudio(page);
  const description = "친근하게 일정 관리. 말투는 우주선 선장처럼, 고객에게 먼저 묻기";
  await studio.getByRole("textbox").fill(description);
  await studio.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  expect(library.pets).toHaveLength(0);
  const save = studio.getByRole("button", { name: "이 펫과 함께하기", exact: true });
  await save.click();
  await expect(studio.getByRole("alert")).toContainText("입력은 유지");
  await studio.getByRole("button", { name: "내 펫", exact: true }).click();
  await studio.getByRole("button", { name: "목록 다시 불러오기" }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(1);
  await studio.getByRole("button", { name: "이어서 만들기", exact: true }).click();
  await expect(studio.locator(".pet-creation-result")).toBeVisible();
  await expect(save).toBeEnabled();
  await save.evaluate(button => { button.click(); button.click(); });
  await expect(studio.locator(".pet-creation-result")).toHaveCount(0);
  const writes = calls.filter(call => call.method === "POST" && !call.path.endsWith("/generations"));
  expect(writes).toHaveLength(2);
  expect(writes[0].body).toEqual(writes[1].body);
  expect(writes[0].body.generationId).toBeTruthy();
  expect(library.pets).toHaveLength(1);
  await expect(studio.getByRole("button", { name: /선택됨$/, exact: true })).toBeFocused();
  await openPetActions(studio);
  await studio.getByRole("button", { name: "보관", exact: true }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(0);
  expect(library.selectedPetId).toBeNull();
  await studio.locator(".pet-archive summary").click();
  await studio.getByRole("button", { name: "복원", exact: true }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(1);
  expect(library.selectedPetId).toBeNull();
  await studio.getByRole("button", { name: /이 펫 선택$/, exact: true }).click();
  await expect(studio.getByRole("button", { name: /선택됨$/, exact: true })).toHaveAttribute("aria-pressed", "true");
  expectNoAnalysis(state);
});

test("unsaved result can be edited and continued without saving or overlapping the gallery", async ({ page }) => {
  const { library, calls } = await petsFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const studio = await openStudio(page);
  const description = "말투: 느긋하고 다정하게; 중점: 번역의 뉘앙스";
  await studio.getByRole("textbox").fill(description);
  await studio.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await studio.getByRole("button", { name: "설명 수정", exact: true }).click();
  await expect(studio.getByRole("textbox")).toHaveValue(description);
  await expect(studio.locator(".pet-library")).toHaveCount(0);
  await studio.getByRole("button", { name: "내 펫", exact: true }).click();
  await expect(studio.getByRole("button", { name: "이어서 만들기", exact: true })).toBeEnabled();
  await studio.getByRole("button", { name: "이어서 만들기", exact: true }).click();
  await expect(studio.getByRole("textbox")).toHaveValue(description);
  expect(calls).toHaveLength(1);
  expect(library.pets).toHaveLength(0);
  await page.screenshot({ path: "outputs/ui-ux/custom-pets-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("failed generation preserves the edit, double clicks start one attempt, cancellation leaves the saved pet", async ({ page }) => {
  const { state, library, calls, server } = await petsFixture(page, { pets: [storedPet("pet-one", "기존 친구")] });
  server.previewFailures = 1;
  const studio = await openStudio(page, { create: false });
  await openPetActions(studio);
  await studio.getByRole("button", { name: "대화로 수정" }).click();
  const description = "중점: 일정 변경을 알려줘";
  await studio.getByRole("textbox").fill(description);
  await studio.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await expect(studio.getByRole("alert")).toContainText("설명은 그대로");
  await expect(studio.getByRole("textbox")).toHaveValue(description);
  const barrier = requestBarrier();
  server.nextPreview = barrier;
  await studio.getByRole("button", { name: "펫 생성하기", exact: true }).evaluate(button => { button.click(); button.click(); });
  await barrier.entered;
  try {
    await expect(studio.locator(".pet-creation-loading")).toBeVisible();
    await expect(studio.getByRole("button", { name: "생성 중…", exact: true })).toBeDisabled();
    expect(calls).toHaveLength(2);
  } finally { barrier.release(); }
  await expect(studio.locator(".pet-creation-result")).toBeVisible();
  await studio.getByRole("button", { name: "설명 수정", exact: true }).click();
  await studio.getByRole("textbox").fill("수정한 선호");
  await studio.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await expect(studio.locator(".pet-creation-result")).toBeVisible();
  expect(calls).toHaveLength(3);
  expect(calls.every(call => call.path.endsWith("/generations"))).toBe(true);
  expect(calls.every(call => call.body.id === "pet-one" && call.body.expectedRevision === 1)).toBe(true);
  expect(new Set(calls.map(call => call.body.mutationId)).size).toBe(3);
  await studio.getByRole("button", { name: "내 펫", exact: true }).click();
  await studio.getByRole("button", { name: "입력 취소", exact: true }).click();
  await expect(studio.getByRole("button", { name: "펫 만들기", exact: true })).toBeEnabled();
  expect(library.pets[0].revision).toBe(1);
  expectNoAnalysis(state);
});

test("active and stored capacity stay separate and deleting requires confirmation", async ({ page }) => {
  const pets = [storedPet("pet-one", "선택한 친구"), storedPet("pet-two", "다른 친구"), storedPet("pet-three", "보관 친구", { archived: true })];
  const { state, library, calls } = await petsFixture(page, { pets, selectedPetId: "pet-one" });
  const studio = await openStudio(page, { create: false });
  const active = studio.locator(".pet-library article");
  await expect(active).toHaveCount(2);
  await expect(studio.getByRole("button", { name: "펫 만들기" })).toBeDisabled();
  await studio.locator(".pet-archive summary").click();
  await expect(studio.getByRole("button", { name: "복원", exact: true })).toBeDisabled();
  await openPetActions(active.filter({ hasText: "다른 친구" }));
  await active.filter({ hasText: "다른 친구" }).getByRole("button", { name: "보관", exact: true }).click();
  await expect(active).toHaveCount(1);
  expect(library.selectedPetId).toBe("pet-one");
  await expect(studio.getByRole("button", { name: "펫 만들기" })).toBeDisabled();
  const archived = studio.locator(".pet-archive > div").filter({ hasText: "보관 친구" });
  await expect(archived.getByRole("button", { name: "복원", exact: true })).toBeEnabled();
  await archived.getByRole("button", { name: "삭제", exact: true }).click();
  await archived.getByRole("button", { name: "취소", exact: true }).click();
  expect(calls.filter(call => call.method === "DELETE")).toHaveLength(0);
  await expect(archived.getByRole("button", { name: "영구 삭제", exact: true })).toHaveCount(0);
  await archived.getByRole("button", { name: "삭제", exact: true }).click();
  await archived.getByRole("button", { name: "영구 삭제", exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(archived).toHaveCount(0);
  await expect(studio.getByRole("button", { name: "펫 만들기" })).toBeEnabled();
  expect(calls.filter(call => call.method === "DELETE")).toHaveLength(1);
  expect(library.pets).toHaveLength(2);
  expectNoAnalysis(state);
});

test("restoring and deleting archived pets preserve another pet's unsaved description", async ({ page }) => {
  const pets = [storedPet("pet-one", "수정할 친구"), storedPet("pet-two", "복원할 친구", { archived: true }), storedPet("pet-three", "삭제할 친구", { archived: true })];
  const { state, library, calls, server } = await petsFixture(page, { pets });
  server.lostSaveResponses = 0;
  const studio = await openStudio(page, { create: false });
  await openPetActions(studio);
  await studio.getByRole("button", { name: "대화로 수정" }).click();
  const description = "말투: 선호를 그대로 보존해 줘";
  await studio.getByRole("textbox").fill(description);
  await studio.getByRole("button", { name: "내 펫", exact: true }).click();
  await openPetActions(studio);
  await expect(studio.getByRole("button", { name: "보관", exact: true })).toBeDisabled();
  await studio.locator(".pet-archive summary").click();
  const deleted = studio.locator(".pet-archive > div").filter({ hasText: "삭제할 친구" });
  await deleted.getByRole("button", { name: "삭제", exact: true }).click();
  await deleted.getByRole("button", { name: "영구 삭제", exact: true }).click();
  await expect(deleted).toHaveCount(0);
  await studio.getByRole("button", { name: "복원", exact: true }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(2);
  await studio.getByRole("button", { name: "이어서 만들기", exact: true }).click();
  await expect(studio.getByRole("textbox")).toHaveValue(description);
  await expect(studio.getByRole("textbox")).toHaveAccessibleName("바꾸고 싶은 점");
  await studio.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await studio.getByRole("button", { name: "이 펫과 함께하기", exact: true }).click();
  await expect(studio.locator(".pet-creation-result")).toHaveCount(0);
  expect(calls.at(-1).body).toMatchObject({ id: "pet-one", expectedRevision: 1, description, resetPreferences: false });
  expect(library.pets.find(pet => pet.id === "pet-one").profile.preferences.requests).toEqual(["기존 선호", description]);
  expectNoAnalysis(state);
});

test("full history requires explicit reset and editing the result preserves that choice", async ({ page }) => {
  const requests = Array.from({ length: 6 }, (_, index) => `선호 ${index + 1}`);
  const { state, library, calls, server } = await petsFixture(page, { pets: [storedPet("pet-one", "기록 친구", { requests })] });
  server.lostSaveResponses = 0;
  const studio = await openStudio(page, { create: false });
  await openPetActions(studio);
  await studio.getByRole("button", { name: "대화로 수정" }).click();
  await studio.getByRole("textbox").fill("기존 선호를 다시 정리한 설명");
  const generate = studio.getByRole("button", { name: "펫 생성하기", exact: true });
  await expect(generate).toBeDisabled();
  expect(calls).toHaveLength(0);
  await studio.getByRole("checkbox").check();
  await generate.click();
  await expect(studio.locator(".pet-creation-result")).toBeVisible();
  await studio.getByRole("button", { name: "설명 수정" }).click();
  await expect(studio.getByRole("checkbox")).toBeChecked();
  await expect(studio.getByRole("textbox")).toHaveValue("기존 선호를 다시 정리한 설명");
  await studio.getByRole("textbox").fill("최종 선호");
  await generate.click();
  await studio.getByRole("button", { name: "이 펫과 함께하기", exact: true }).click();
  await expect(studio.locator(".pet-creation-result")).toHaveCount(0);
  expect(library.pets[0].revision).toBe(2);
  expect(library.pets[0].profile.preferences.requests).toEqual(["최종 선호"]);
  expect(calls.filter(call => !call.path.endsWith("/generations"))).toHaveLength(1);
  expectNoAnalysis(state);
});

test("saved result followed by failed list refresh retries the same mutation without duplication", async ({ page }) => {
  const { state, library, calls, server } = await petsFixture(page);
  server.lostSaveResponses = 0;
  const studio = await openStudio(page);
  await studio.getByRole("textbox").fill("목록 요청 실패에도 유지할 선호");
  await studio.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  server.listFailures = 1;
  await studio.getByRole("button", { name: "이 펫과 함께하기", exact: true }).click();
  await expect(studio.getByRole("alert")).toContainText("입력은 유지");
  await expect(studio.locator(".pet-creation-result")).toBeVisible();
  expect(library.pets).toHaveLength(1);
  await studio.getByRole("button", { name: "이 펫과 함께하기", exact: true }).click();
  await expect(studio.locator(".pet-library article")).toHaveCount(1);
  const writes = calls.filter(call => !call.path.endsWith("/generations"));
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(library.pets).toHaveLength(1);
  expect(library.pets[0].revision).toBe(1);
  expectNoAnalysis(state);
});

for (const staleFailure of [false, true]) {
  test(`older reload ${staleFailure ? "failure" : "snapshot"} cannot overwrite a completed save`, async ({ page }) => {
    const { state, library, server } = await petsFixture(page);
    server.lostSaveResponses = 0;
    const studio = await openStudio(page);
    await studio.getByRole("textbox").fill("최신 저장을 유지해 줘");
    await studio.getByRole("button", { name: "펫 생성하기", exact: true }).click();
    await expect(studio.locator(".pet-creation-result")).toBeVisible();
    await studio.getByRole("button", { name: "내 펫", exact: true }).click();
    const barrier = requestBarrier();
    server.nextList = barrier;
    server.listFailures = staleFailure ? 1 : 0;
    await studio.getByRole("button", { name: "목록 다시 불러오기" }).click();
    await barrier.entered;
    try {
      await studio.getByRole("button", { name: "이어서 만들기", exact: true }).click();
      await studio.getByRole("button", { name: "이 펫과 함께하기", exact: true }).click();
      await expect(studio.locator(".pet-library article")).toHaveCount(1);
      await expect(studio.getByRole("status").last()).toContainText("저장하고 선택했습니다");
    } finally {
      const response = page.waitForResponse(value => value.request().method() === "GET" && value.url().endsWith("/agent-pets"));
      barrier.release();
      await (await response).finished();
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(studio.locator(".pet-library article")).toHaveCount(1);
    await expect(studio.getByRole("button", { name: /선택됨$/, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(studio.getByRole("status").last()).toContainText("저장하고 선택했습니다");
    expect(library.pets).toHaveLength(1);
    expectNoAnalysis(state);
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

test("successful reload removes the read error and retains the unsaved description", async ({ page }) => {
  const { state, server } = await petsFixture(page);
  const studio = await openStudio(page, { create: false });
  server.listFailures = 1;
  await studio.getByRole("button", { name: "목록 다시 불러오기" }).click();
  await expect(studio.getByRole("alert")).toContainText("펫을 불러오지 못했습니다");
  await studio.getByRole("button", { name: "목록 다시 불러오기" }).click();
  await expect(studio.getByRole("alert")).toHaveCount(0);
  await studio.getByRole("button", { name: "펫 만들기", exact: true }).click();
  await studio.getByRole("textbox").fill("목록 복구 후에도 유지할 선호");
  await studio.getByRole("button", { name: "내 펫", exact: true }).click();
  const refreshed = page.waitForResponse(response => response.request().method() === "GET" && response.url().endsWith("/agent-pets"));
  await studio.getByRole("button", { name: "목록 다시 불러오기" }).click();
  await (await refreshed).finished();
  await studio.getByRole("button", { name: "이어서 만들기", exact: true }).click();
  await expect(studio.getByRole("textbox")).toHaveValue("목록 복구 후에도 유지할 선호");
  expectNoAnalysis(state);
});

for (const [width, theme] of [[1440, "dark"], [768, "light"], [390, "dark"], [320, "light"]]) {
  test(`${width}px ${theme}: pet gallery selects the whole card and separates editing`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    const names = ["차근", "달빛", "보리", "모모", "또렷", "구름"];
    const pets = names.map((name, index) => {
      const pet = storedPet(`pet-${index}`, name);
      pet.profile.animal = ["turtle", "owl", "cat"][index % 3];
      pet.profile.color = ["sage", "lavender", "peach", "sky", "rose", "ink"][index];
      pet.profile.preferences.focus = ["일정을 차근차근 챙기는 작은 동료", "놓친 근거를 함께 찾아보는 친구", "따뜻한 말투로 복잡한 일을 정리해요"][index % 3];
      return pet;
    });
    const { state, calls, library } = await petsFixture(page, { pets, selectedPetId: "pet-0", maxActivePets: 8, maxStoredPets: 24 });
    const studio = await openStudio(page, { create: false });
    const panel = page.getByRole("dialog", { name: "함께할 펫", exact: true });
    await expect(studio.getByRole("textbox")).toHaveCount(0);
    await expect(studio.locator(".pet-library article")).toHaveCount(6);
    await expect(studio.getByRole("button", { name: "펫 만들기", exact: true })).toBeVisible();
    const cards = studio.locator(".pet-library article");
    await expect(cards.first().getByRole("button", { name: "차근 · 선택됨", exact: true })).toBeVisible();
    await expect(cards.nth(1).getByRole("button", { name: "달빛 · 이 펫 선택", exact: true })).toBeVisible();
    if (width === 1440) {
      const columns = await studio.locator(".pet-library").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(3);
    }
    await cards.nth(1).getByText("달빛", { exact: true }).click();
    await expect(cards.nth(1).getByRole("button", { name: /선택됨$/, exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(library.selectedPetId).toBe("pet-1");
    expect(calls).toHaveLength(1);
    await cards.nth(1).getByRole("button", { name: /선택됨$/, exact: true }).click();
    await expect.poll(() => calls.length).toBe(2);
    const summary = cards.nth(1).locator(".pet-library-actions > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(cards.nth(1).getByRole("button", { name: "대화로 수정", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(cards.nth(1).locator(".pet-library-actions")).not.toHaveAttribute("open");
    await page.screenshot({ path: `outputs/ui-ux/pet-gallery-${width}-${theme}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const dialogBounds = await panel.boundingBox();
    expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(width);
    await summary.click();
    await cards.nth(1).getByRole("button", { name: "대화로 수정", exact: true }).click();
    await expect(studio.getByRole("textbox")).toBeFocused();
    await studio.getByRole("textbox").fill("말투: 차분하게");
    await expect(studio.locator(".pet-library")).toHaveCount(0);
    await studio.getByRole("button", { name: "내 펫", exact: true }).click();
    await expect(cards.first().getByRole("button", { name: /이 펫 선택$/, exact: true })).toBeDisabled();
    await studio.getByRole("button", { name: "입력 취소", exact: true }).click();
    await expect(studio.getByRole("textbox")).toHaveCount(0);
    await expect(studio.getByRole("button", { name: "펫 만들기", exact: true })).toBeFocused();
    await summary.focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "펫 만들기·관리", exact: true })).toBeFocused();
    expectNoAnalysis(state);
  });
}

for (const capacity of ["active", "stored"]) {
  test(`${capacity} capacity: leaving an empty editor returns focus to an enabled library control`, async ({ page }) => {
    const pets = [storedPet("pet-one", "견적 친구")];
    if (capacity === "stored") pets.push(storedPet("pet-archived", "보관 친구", { archived: true }));
    const { state, calls } = await petsFixture(page, {
      pets,
      maxActivePets: capacity === "active" ? 1 : 2,
      maxStoredPets: capacity === "active" ? 3 : 2
    });
    const studio = await openStudio(page, { create: false });
    await expect(studio.getByRole("button", { name: "펫 만들기", exact: true })).toBeDisabled();
    await openPetActions(studio);
    await studio.getByRole("button", { name: "대화로 수정", exact: true }).click();
    await expect(studio.getByRole("textbox")).toBeFocused();
    await studio.getByRole("button", { name: "내 펫", exact: true }).click();
    const refresh = studio.getByRole("button", { name: "목록 다시 불러오기", exact: true });
    await expect(refresh).toBeEnabled();
    await expect(refresh).toBeFocused();
    await expect(studio.getByRole("textbox")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(studio.getByRole("button", { name: "견적 친구 · 이 펫 선택", exact: true })).toBeFocused();
    expect(calls).toEqual([]);
    expectNoAnalysis(state);
  });
}
