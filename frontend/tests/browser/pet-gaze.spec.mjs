import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const portrait = page => page.locator(".workspace-companion .pet-art");
const eyes = page => portrait(page).locator(".pet-eyes");

async function gazeFixture(page, animal = "cat") {
  const state = await fixture(page);
  const profile = { petId: "gaze-pet", slot: "RECOMMENDED", name: "시선을 따라오는 친구", animal, color: "sky", accessory: "glasses", tone: "WARM", valuePriority: "BALANCED", deliveryPriority: "QUALITY", scopePriority: "BALANCED", duty: "GENERAL" };
  const mutations = [], errors = [];
  await page.route("**/api/v2/workspaces/local-space/agent-pets**", route => {
    if (route.request().method() !== "GET") mutations.push(route.request().method());
    return route.fulfill({ json: { pets: [{ id: "gaze-pet", profile, archived: false, revision: 1 }], selectedPetId: "gaze-pet", maxActivePets: 8, maxStoredPets: 24, maxPromptLength: 500, maxPreferenceRequests: 6 } });
  });
  page.on("pageerror", error => errors.push(error.message));
  return { state, mutations, errors };
}

async function eyeOffset(page) {
  return eyes(page).evaluate(node => {
    const [x, y] = node.getAttribute("transform").match(/-?\d+(?:\.\d+)?/g).map(Number);
    return { x, y };
  });
}

for (const animal of ["cat", "owl", "turtle"]) {
  test(`${animal}: mouse direction moves only the eyes and leaves agent state untouched`, async ({ page }) => {
    const { state, mutations, errors } = await gazeFixture(page, animal);
    await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(path);
    await expect(eyes(page)).toHaveAttribute("transform", "translate(0 0)");
    const before = await portrait(page).boundingBox();
    const eyeY = before.y + before.height * (53 / 128);
    await page.mouse.move(1400, eyeY); await expect.poll(async () => (await eyeOffset(page)).x).toBeGreaterThan(0);
    await page.mouse.move(0, eyeY); await expect.poll(async () => (await eyeOffset(page)).x).toBeLessThan(0);
    await page.mouse.move(before.x + before.width / 2, 880); await expect.poll(async () => (await eyeOffset(page)).y).toBeGreaterThan(0);
    const offset = await eyeOffset(page); expect(Math.abs(offset.x)).toBeLessThanOrEqual(4); expect(Math.abs(offset.y)).toBeLessThanOrEqual(2.5);
    expect(await portrait(page).boundingBox()).toEqual(before);
    await expect(portrait(page)).toHaveClass(new RegExp(`pet-${animal} pet-idle`));
    await page.screenshot({ path: `outputs/ui-ux/pet-gaze-${animal}.png` });
    await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await expect(eyes(page)).toHaveAttribute("transform", "translate(0 0)");
    expect(state.starts).toEqual([]); expect(mutations).toEqual([]); expect(state.blocked).toEqual([]); expect(errors).toEqual([]);
  });
}

test("reduced-motion changes reset a moving pet immediately and keep it still", async ({ page }) => {
  const { state, mutations } = await gazeFixture(page); await page.goto(path);
  await expect(eyes(page)).toHaveAttribute("transform", "translate(0 0)");
  await page.mouse.move(1200, 800); await expect.poll(async () => (await eyeOffset(page)).x).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" }); await expect(eyes(page)).toHaveAttribute("transform", "translate(0 0)");
  await page.mouse.move(0, 0); await expect(eyes(page)).toHaveAttribute("transform", "translate(0 0)");
  await page.emulateMedia({ reducedMotion: "no-preference" }); await page.mouse.move(1200, 800);
  await expect.poll(async () => (await eyeOffset(page)).x).toBeGreaterThan(0);
  expect(state.starts).toEqual([]); expect(mutations).toEqual([]);
});

test("touch devices keep a neutral portrait without changing pet selection or starting a run", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100" });
  try {
    const page = await context.newPage(), { state, mutations, errors } = await gazeFixture(page);
    await page.goto(path); await expect(eyes(page)).toHaveAttribute("transform", "translate(0 0)");
    await page.touchscreen.tap(100, 200); await page.mouse.move(380, 800);
    await expect(eyes(page)).toHaveAttribute("transform", "translate(0 0)");
    expect(state.starts).toEqual([]); expect(mutations).toEqual([]); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("navigation preserves the companion and logout removes tracking without late errors", async ({ page }) => {
  const { state, mutations, errors } = await gazeFixture(page);
  await page.route("**/api/v2/auth/logout", route => route.fulfill({ status: 204 }));
  await page.goto(path); await expect(eyes(page)).toHaveAttribute("transform", "translate(0 0)");
  await page.mouse.move(1200, 800); await expect.poll(async () => (await eyeOffset(page)).x).toBeGreaterThan(0);
  await page.getByRole("button", { name: "설정", exact: true }).click(); await expect(page).toHaveURL(/\/workspace\/settings$/);
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`${path}$`));
  await page.locator(".sidebar-foot button").click(); await expect(page.locator(".workspace-companion")).toHaveCount(0);
  await page.mouse.move(300, 300); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(state.starts).toEqual([]); expect(mutations).toEqual([]); expect(errors).toEqual([]);
});
