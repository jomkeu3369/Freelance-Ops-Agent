import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const boardPath = "/workspace/projects";
const card = page => page.locator('[data-project-id="project-one"]');
const column = (page, key) => page.locator(`.pipeline-column.stage-${key}`);

async function boardFixture(page, { writable = true, locale = "ko", status = "LEAD" } = {}) {
  const state = await fixture(page);
  if (writable) state.permissions.push("project.write");
  state.projects[0].status = status;
  Object.assign(state, { moves: [], reads: 0, failure: false, readFailure: false, lostResponse: false, barrier: null });
  await page.addInitScript(locale => localStorage.setItem("freelance-ops-ui-locale-v1", locale), locale);
  await page.route("**/api/v2/workspaces/local-space/projects/project-one{,/status}", async route => {
    const request = route.request();
    if (request.method() === "GET") {
      state.reads++;
      return route.fulfill({ status: state.readFailure ? 503 : 200, contentType: "application/json", body: JSON.stringify(state.readFailure ? {} : state.projects[0]) });
    }
    state.moves.push(request.postDataJSON());
    if (state.barrier) await state.barrier.wait();
    if (!state.failure || state.lostResponse) state.projects[0] = { ...state.projects[0], ...request.postDataJSON(), updatedAt: "2026-10-04T00:00:00Z" };
    if (state.lostResponse) return route.abort();
    return route.fulfill({ status: state.failure ? 503 : 200, contentType: "application/json", body: JSON.stringify(state.failure ? { message: "Fixture write failure" } : state.projects[0]) });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(boardPath);
  await expect(card(page)).toBeVisible();
  return state;
}

async function dragStart(page) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await card(page).dispatchEvent("dragstart", { dataTransfer });
  return dataTransfer;
}
async function drop(page, key, dataTransfer) {
  await column(page, key).dispatchEvent("dragover", { dataTransfer });
  await column(page, key).dispatchEvent("drop", { dataTransfer });
}

test("native mouse drag moves the card with one status-only write and no navigation", async ({ page }) => {
  const state = await boardFixture(page);
  await card(page).locator(".pipeline-card-open").dragTo(column(page, "qualifying").locator(".pipeline-cards"));
  await expect(column(page, "qualifying").locator('[data-project-id="project-one"]')).toBeVisible();
  await expect(card(page).locator("select")).toBeEnabled();
  expect(state.moves).toEqual([{ status: "QUALIFYING" }]);
  await expect(page).toHaveURL(/\/workspace\/projects$/);
  await expect(page.locator(".pipeline-drag-preview, .drop-target, .dragging")).toHaveCount(0);
  expect(state.blocked).toEqual([]);
});

test("drop indicator, optimistic position, duplicate drop lock and repeated successful moves", async ({ page }) => {
  const state = await boardFixture(page);
  state.barrier = requestBarrier();
  const drag = await dragStart(page);
  await column(page, "qualifying").dispatchEvent("dragover", { dataTransfer: drag });
  await expect(column(page, "qualifying")).toHaveClass(/drop-target/);
  await expect(page.locator(".pipeline-drop-indicator")).toContainText("정보 확인 중");
  await drop(page, "qualifying", drag);
  await state.barrier.entered;
  await expect(column(page, "qualifying").locator("article.saving")).toHaveCount(1);
  await expect(card(page).locator("select")).toBeDisabled();
  await expect(card(page)).toHaveAttribute("draggable", "false");
  await drop(page, "quoting", drag);
  expect(state.moves).toHaveLength(1);
  state.barrier.release();
  await expect(card(page).locator("select")).toBeEnabled();
  state.barrier = null;
  const next = await dragStart(page);
  await drop(page, "quoting", next);
  await expect(card(page).locator("select")).toHaveValue("QUOTING");
  await expect(card(page).locator("select")).toBeEnabled();
  expect(state.moves).toEqual([{ status: "QUALIFYING" }, { status: "QUOTING" }]);
  await expect(page).toHaveURL(/\/workspace\/projects$/);
});

test("same-column Accepted drop, Escape, outside drop and external drag never write", async ({ page }) => {
  const state = await boardFixture(page, { status: "ACCEPTED" });
  await drop(page, "negotiating", await dragStart(page));
  await expect(card(page).locator("select")).toHaveValue("ACCEPTED");
  const cancelled = await dragStart(page);
  await column(page, "quoting").dispatchEvent("dragover", { dataTransfer: cancelled });
  await page.keyboard.press("Escape");
  await drop(page, "quoting", cancelled);
  const outside = await dragStart(page);
  await page.locator("h1").dispatchEvent("drop", { dataTransfer: outside });
  const external = await page.evaluateHandle(() => { const value = new DataTransfer(); value.setData("text/plain", "project-one"); return value; });
  await drop(page, "quoting", external);
  await expect(page.locator(".pipeline-drag-preview, .drop-target, .dragging")).toHaveCount(0);
  expect(state.moves).toEqual([]);
  // Drag completion must not trigger the card's normal click navigation.
  await card(page).locator(".pipeline-card-open").dispatchEvent("click");
  await expect(page).toHaveURL(/\/workspace\/projects$/);
});

test("failed save rolls back from a fresh server read and a subsequent retry works", async ({ page }) => {
  const state = await boardFixture(page);
  state.failure = true;
  await drop(page, "qualifying", await dragStart(page));
  await expect(page.getByRole("alert")).toContainText("최신 상태를 불러왔습니다");
  await expect(column(page, "inquiry").locator('[data-project-id="project-one"]')).toBeVisible();
  await expect(card(page).locator("select")).toBeEnabled();
  expect(state.reads).toBe(1);
  state.failure = false;
  await drop(page, "qualifying", await dragStart(page));
  await expect(card(page).locator("select")).toHaveValue("QUALIFYING");
  await expect(card(page).locator("select")).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.moves).toHaveLength(2);
});

test("lost write response reconciles a saved change without repeating the write", async ({ page }) => {
  const state = await boardFixture(page);
  state.lostResponse = true;
  await drop(page, "qualifying", await dragStart(page));
  await expect(card(page).locator("select")).toBeEnabled();
  await expect(card(page).locator("select")).toHaveValue("QUALIFYING");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.reads).toBe(1);
  expect(state.moves).toHaveLength(1);
});

test("failed reconciliation shows honest English recovery guidance and restores the card", async ({ page }) => {
  const state = await boardFixture(page, { locale: "en" });
  state.failure = state.readFailure = true;
  await drop(page, "qualifying", await dragStart(page));
  await expect(page.getByRole("alert")).toContainText("Refresh before trying again");
  await expect(card(page).locator("select")).toHaveValue("LEAD");
  await expect(card(page).locator("select")).toBeEnabled();
  expect(state.moves).toHaveLength(1);
});

test("keyboard stage control, English feedback and reduced motion remain accessible", async ({ page }) => {
  const state = await boardFixture(page, { locale: "en" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const drag = await dragStart(page);
  await column(page, "qualifying").dispatchEvent("dragover", { dataTransfer: drag });
  await expect(page.locator(".pipeline-drop-indicator")).toHaveText("Drop here to move to Qualifying");
  await expect(page.locator(".pipeline-drop-indicator")).toHaveCSS("animation-name", "none");
  await expect(card(page)).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("Escape");
  await card(page).locator("select").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(card(page).locator("select")).toHaveValue("QUALIFYING");
  await expect(card(page).locator("select")).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Changed Original project title" })).toContainText("Qualifying");
  expect(state.moves).toHaveLength(1);
});

test("read-only users cannot drag or change stage", async ({ page }) => {
  const state = await boardFixture(page, { writable: false });
  await expect(card(page)).toHaveAttribute("draggable", "false");
  await expect(card(page).locator("select")).toHaveCount(0);
  await drop(page, "qualifying", await dragStart(page));
  expect(state.moves).toEqual([]);
});

test("mobile list keeps its stage menu and board drag cleanup survives view changes", async ({ page }) => {
  const state = await boardFixture(page);
  const drag = await dragStart(page);
  await column(page, "qualifying").dispatchEvent("dragover", { dataTransfer: drag });
  await page.getByRole("button", { name: "목록 보기", exact: true }).click();
  await expect(page.locator(".pipeline-drag-preview, .drop-target, .dragging")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await card(page).locator("select").selectOption("QUOTING");
  await expect(card(page).locator("select")).toBeEnabled();
  await expect(card(page).locator("select")).toHaveValue("QUOTING");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(state.moves).toEqual([{ status: "QUOTING" }]);
});


test("navigation away and back retains a pending save lock through reconciliation", async ({ page }) => {
  const state = await boardFixture(page);
  state.barrier = requestBarrier();
  state.failure = true;
  await drop(page, "qualifying", await dragStart(page));
  await state.barrier.entered;
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.locator(".pipeline-board")).toHaveCount(0);
  await page.goBack();
  await expect(card(page).locator("select")).toBeDisabled();
  await drop(page, "quoting", await dragStart(page));
  expect(state.moves).toHaveLength(1);
  state.barrier.release();
  await expect(page.getByRole("alert")).toContainText("최신 상태를 불러왔습니다");
  await expect(card(page).locator("select")).toBeEnabled();
  await expect(card(page).locator("select")).toHaveValue("LEAD");
  state.barrier = null;
  state.failure = false;
  await drop(page, "quoting", await dragStart(page));
  await expect(card(page).locator("select")).toBeEnabled();
  await expect(card(page).locator("select")).toHaveValue("QUOTING");
  expect(state.moves).toHaveLength(2);
});
