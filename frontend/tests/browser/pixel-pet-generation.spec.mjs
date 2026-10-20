import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

// 외형은 실제 모델 검증 출력이며 계정·저장·응답은 합성 데이터다.
const penguin = JSON.parse(await readFile(new URL("../../../contracts/fixtures/pixel-pet-profile.json", import.meta.url), "utf8"));
const description = "꼼꼼하게 실현 가능성을 판단하는 펭귄";

async function pixelFixture(page, options = {}) {
  const state = await fixture(page);
  const library = { pets: [], selectedPetId: null, maxActivePets: 8, maxStoredPets: 24, maxPromptLength: 500,
    maxPreferenceRequests: 6, generationMode: "MODEL_PIXEL", aiGenerationAvailable: true, ...options };
  const server = { modelCalls: 0, calls: [], jobs: new Map(), nextGeneration: null, lostGenerationResponses: 0,
    lostSaveResponses: 0, failures: 0, unknownResult: false };
  const saves = new Map();
  await page.route("**/api/v2/workspaces/local-space/agent-pets**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? req.postDataJSON() : null;
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    server.calls.push({ method: req.method(), path, body });
    if (path.includes("/generations/") && req.method() === "GET") {
      const job = server.jobs.get(path.split("/").at(-1));
      return job ? json(job) : json({ code: "PET_GENERATION_NOT_FOUND" }, 404);
    }
    if (path.endsWith("/generations") && req.method() === "POST") {
      const input = body.input;
      if (server.jobs.has(input.mutationId)) return json(server.jobs.get(input.mutationId));
      server.modelCalls++;
      const job = { id: input.mutationId, status: "REQUESTED", profile: null, errorCode: null };
      server.jobs.set(job.id, job);
      const barrier = server.nextGeneration;
      server.nextGeneration = null;
      if (barrier) await barrier.wait();
      if (server.failures > 0) { server.failures--; job.status = "FAILED"; job.errorCode = "PET_GENERATION_FAILED"; return json(job); }
      job.status = "COMPLETED";
      job.profile = structuredClone(penguin);
      job.profile.petId = input.id;
      job.profile.preferences.requests = [input.description];
      if (server.unknownResult) job.status = "UNKNOWN";
      if (server.lostGenerationResponses > 0) { server.lostGenerationResponses--; return json({ message: "Synthetic lost response" }, 503); }
      return json(job);
    }
    if (req.method() === "GET") return json(library);
    if (req.method() === "POST" && path.endsWith("/agent-pets")) {
      const job = server.jobs.get(body.generationId);
      if (!job || job.status !== "COMPLETED") return json({ code: "PET_GENERATION_NOT_READY" }, 409);
      const prior = saves.get(body.mutationId);
      if (prior) {
        if (prior.input !== JSON.stringify(body)) return json({ code: "PET_REQUEST_REUSED" }, 409);
        return json(prior.pet);
      }
      const pet = { id: body.id, profile: structuredClone(job.profile), archived: false, revision: body.expectedRevision + 1 };
      library.pets.push(pet); library.selectedPetId = pet.id;
      saves.set(body.mutationId, { input: JSON.stringify(body), pet });
      if (server.lostSaveResponses > 0) { server.lostSaveResponses--; return json({ message: "Synthetic lost save response" }, 503); }
      return json(pet);
    }
    return json({}, 404);
  });
  return { state, library, server };
}

async function open(page) {
  await page.goto("/workspace/projects/project-one/agent");
  await page.getByRole("button", { name: "함께할 펫", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "함께할 펫", exact: true });
  await expect(panel.locator(".pet-library")).toHaveAttribute("aria-busy", "false");
  await panel.getByRole("button", { name: "펫 만들기", exact: true }).click();
  return panel;
}

test("an older backend keeps generation disabled until the pixel API is available", async ({ page }) => {
  const { server } = await pixelFixture(page, { generationMode: "RULE_BASED_PREVIEW", aiGenerationAvailable: true });
  const panel = await open(page);
  await panel.getByRole("textbox").fill(description);
  await expect(panel.getByRole("button", { name: "펫 생성하기", exact: true })).toBeDisabled();
  await expect(panel.getByText("지금은 기본 제공 AI를 사용할 수 없어요. 사용량과 연결 상태를 확인해 주세요.", { exact: true })).toBeVisible();
  expect(server.modelCalls).toBe(0);
});

for (const screen of [
  { width: 1440, height: 1000, theme: "dark" },
  { width: 1024, height: 768, theme: "light" },
  { width: 390, height: 844, theme: "light" },
  { width: 320, height: 568, theme: "dark" }
]) {
  test(`${screen.width}px ${screen.theme}: input, actual pending state and generated penguin keep the primary button in place`, async ({ page }) => {
    const { state, server } = await pixelFixture(page);
    await page.setViewportSize(screen);
    await page.addInitScript((theme) => localStorage.setItem("theme", theme), screen.theme);
    const panel = await open(page);
    const prompt = panel.getByRole("textbox");
    await expect(prompt).toBeFocused();
    await expect(panel.locator(".pet-library")).toHaveCount(0);
    await prompt.fill(description);
    const primary = panel.locator(".pet-creation-primary");
    const inputPosition = await primary.boundingBox();
    await mkdir("outputs/ui-ux/pixel-pets", { recursive: true });
    const capture = async (step) => page.screenshot({ path: `outputs/ui-ux/pixel-pets/${screen.width}-${screen.theme}-${step}.png` });
    await capture("input");
    await panel.locator(".pet-creation-stage").evaluate(element => { element.scrollTop = element.scrollHeight; });
    const barrier = requestBarrier();
    server.nextGeneration = barrier;
    await primary.evaluate((button) => { button.click(); button.click(); });
    await barrier.entered;
    try {
      await expect(panel.getByRole("region", { name: "펫 생성 중", exact: true })).toBeFocused();
      expect(await panel.locator(".pet-creation-stage").evaluate(element => element.scrollTop)).toBe(0);
      await expect(primary).toBeDisabled();
      await expect(primary).toHaveText("생성 중…");
      await expect(panel.getByRole("textbox")).toHaveCount(0);
      expect(server.modelCalls).toBe(1);
      const loadingPosition = await primary.boundingBox();
      expect(Math.abs(loadingPosition.y - inputPosition.y)).toBeLessThan(2);
      await capture("loading");
    } finally { barrier.release(); }
    await expect(panel.getByRole("region", { name: "생성된 펫 확인", exact: true })).toBeFocused();
    expect(await panel.locator(".pet-creation-stage").evaluate(element => element.scrollTop)).toBe(0);
    await expect(panel.locator(".pet-creation-result")).toContainText("펭귄");
    await expect(panel.locator(".pet-creation-result")).toContainText("꼼꼼이");
    await expect(panel.locator(".pet-pixel")).toBeVisible();
    await expect(panel.locator(".pet-creation-result h4")).toBeInViewport({ ratio: 1 });
    await expect(primary).toHaveText("이 펫과 함께하기");
    const resultPosition = await primary.boundingBox();
    expect(Math.abs(resultPosition.y - inputPosition.y)).toBeLessThan(2);
    expect(resultPosition.y + resultPosition.height).toBeLessThan(screen.height);
    expect(resultPosition.height).toBeGreaterThanOrEqual(44);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await capture("result");
    expect(server.modelCalls).toBe(1);
    expect(state.starts).toHaveLength(0);
    expect(state.blocked).toEqual([]);
  });
}

test("lost generation and save responses recover the same model result and save ID", async ({ page }) => {
  const { server, library, state } = await pixelFixture(page);
  server.lostGenerationResponses = 1;
  server.lostSaveResponses = 1;
  const panel = await open(page);
  await panel.getByRole("textbox").fill(description);
  await panel.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await expect(panel.locator(".pet-creation-result")).toBeVisible();
  await panel.getByRole("button", { name: "이 펫과 함께하기", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.locator(".pet-pixel")).toBeVisible();
  await panel.getByRole("button", { name: "이 펫과 함께하기", exact: true }).click();
  await expect(panel.locator(".pet-library-card.is-selected")).toHaveCount(1);
  const saves = server.calls.filter((call) => call.method === "POST" && call.path.endsWith("/agent-pets"));
  expect(saves).toHaveLength(2);
  expect(saves[0].body).toEqual(saves[1].body);
  expect(saves[0].body.generationId).toBeTruthy();
  expect(server.modelCalls).toBe(1);
  expect(library.pets).toHaveLength(1);
  expect(state.starts).toHaveLength(0);
});

test("an uncertain result is read again without a second model request", async ({ page }) => {
  const { server } = await pixelFixture(page);
  server.unknownResult = true;
  const panel = await open(page);
  await panel.getByRole("textbox").fill(description);
  await panel.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("같은 요청을 다시 확인", { timeout: 30_000 });
  await expect(panel.getByRole("textbox")).toHaveValue(description);
  expect(server.modelCalls).toBe(1);
  server.jobs.values().next().value.status = "COMPLETED";
  await panel.getByRole("button", { name: "생성 결과 확인", exact: true }).click();
  await expect(panel.locator(".pet-creation-result")).toBeVisible();
  expect(server.modelCalls).toBe(1);
  expect(server.calls.filter(call => call.method === "POST" && call.path.endsWith("/generations"))).toHaveLength(1);
});

test("English mobile controls fit and reduced motion keeps a static loading indicator", async ({ page }) => {
  const { server } = await pixelFixture(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "en"));
  await page.goto("/workspace/projects/project-one/agent");
  await page.getByRole("button", { name: "Your pet", exact: true }).click();
  const panel = page.locator(".pet-library-panel");
  await panel.getByRole("button", { name: "Create a pet", exact: true }).click();
  await panel.locator(".pet-creation-examples button").first().click();
  await expect(panel.getByRole("textbox")).not.toHaveValue(/[가-힣]/);
  const barrier = requestBarrier();
  server.nextGeneration = barrier;
  await panel.locator(".pet-creation-primary").click();
  await barrier.entered;
  try {
    expect(await panel.locator(".pet-creation-pixels i").first().evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  } finally { barrier.release(); }
  await expect(panel.locator(".pet-creation-result")).toBeVisible();
  const primary = await panel.locator(".pet-creation-primary").boundingBox();
  const secondary = await panel.locator(".pet-creation-secondary").boundingBox();
  expect(secondary.x + secondary.width).toBeLessThanOrEqual(primary.x);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("closing during generation and reopening recovers by GET without starting another model", async ({ page }) => {
  const { server } = await pixelFixture(page);
  let panel = await open(page);
  await panel.getByRole("textbox").fill(description);
  const barrier = requestBarrier();
  server.nextGeneration = barrier;
  await panel.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await barrier.entered;
  try {
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "함께할 펫", exact: true }).click();
    panel = page.getByRole("dialog", { name: "함께할 펫", exact: true });
    await expect(panel.locator(".pet-creation-loading")).toBeVisible();
  } finally { barrier.release(); }
  await expect(panel.locator(".pet-creation-result")).toBeVisible();
  expect(server.modelCalls).toBe(1);
  expect(server.calls.filter((call) => call.method === "POST" && call.path.endsWith("/generations"))).toHaveLength(1);
});

test("page reload recovers a completed result without paying for another generation", async ({ page }) => {
  const { server } = await pixelFixture(page);
  let panel = await open(page);
  await panel.getByRole("textbox").fill(description);
  await panel.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await expect(panel.locator(".pet-creation-result")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "함께할 펫", exact: true }).click();
  panel = page.getByRole("dialog", { name: "함께할 펫", exact: true });
  await expect(panel.locator(".pet-creation-result")).toBeVisible();
  expect(server.modelCalls).toBe(1);
});

test("failed generation keeps the description and waits for an explicit new attempt", async ({ page }) => {
  const { server } = await pixelFixture(page);
  server.failures = 1;
  const panel = await open(page);
  await panel.getByRole("textbox").fill(description);
  await panel.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("만들지 못했어요");
  await expect(panel.getByRole("textbox")).toHaveValue(description);
  expect(server.modelCalls).toBe(1);
  await panel.getByRole("button", { name: "펫 생성하기", exact: true }).click();
  await expect(panel.locator(".pet-creation-result")).toBeVisible();
  expect(server.modelCalls).toBe(2);
});
