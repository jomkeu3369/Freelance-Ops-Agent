import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";

test("recent project navigation preserves a scoped composer draft and opens a real project route", async ({ page }) => {
  const state = await fixture(page);
  state.projects.push({ ...state.projects[0], id: "project-two", title: "Second project" });
  await page.goto(path);
  await page.locator("#agent-chat-input").fill("첫 프로젝트에만 남길 초안");
  const recent = page.getByRole("navigation", { name: "최근 프로젝트 대화" });
  await recent.getByRole("button", { name: /Second project/ }).click();
  await expect(page).toHaveURL(/\/project-two\/agent$/);
  await expect(page.locator("#agent-chat-input")).toHaveValue("");
  await recent.getByRole("button", { name: /Original project title/ }).click();
  await expect(page.locator("#agent-chat-input")).toHaveValue("첫 프로젝트에만 남길 초안");
  expect(state.starts).toHaveLength(0);
  expect(state.blocked).toEqual([]);
});

for (const width of [320, 390, 640, 1280]) {
  test(`professional workspace reflows at ${width}px with long content and keyboard focus`, async ({ page }) => {
    const state = await fixture(page);
    state.projects[0].title = "긴 프로젝트 제목 LongProjectWithoutBreaks".repeat(8);
    await page.setViewportSize({ width, height: 800 });
    await page.goto(path);
    await expect(page.locator(".agent-chat")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const log = page.getByRole("log");
    await log.focus();
    await expect(log).toBeFocused();
    await page.getByRole("button", { name: "AI 설정 열기" }).click();
    await expect(page.locator(".agent-chat-settings")).toHaveAttribute("open", "");
    await expect(page.locator(".agent-chat-settings > summary")).toBeFocused();
    expect(state.starts).toHaveLength(0);
    expect(state.blocked).toEqual([]);
  });
}

test("offline drafts survive and reconnect never submits automatically", async ({ page, context }) => {
  const state = await fixture(page);
  await page.goto(path);
  await page.locator("#agent-chat-input").fill("오프라인에서도 보관할 요청");
  await context.setOffline(true);
  await expect(page.locator(".agent-chat-state")).toHaveText("오프라인");
  await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeDisabled();
  await context.setOffline(false);
  await expect(page.locator("#agent-chat-input")).toHaveValue("오프라인에서도 보관할 요청");
  await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeEnabled();
  expect(state.starts).toHaveLength(0);
});

test("English starter only fills the composer; reduced motion disables arrival animation", async ({ page }) => {
  const state = await fixture(page);
  await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(path);
  await page.getByRole("button", { name: /Review this project's requirements/ }).click();
  await expect(page.locator("#agent-chat-input")).toHaveValue("Review this project's requirements and list any questions");
  await expect(page.locator("#agent-chat-input")).toBeFocused();
  expect(state.starts).toHaveLength(0);
  await page.locator('.agent-chat-composer button[type="submit"]').click();
  await expect(page.locator(".agent-chat-message.user")).toBeVisible();
  expect(await page.locator(".agent-chat-message.user").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
});
