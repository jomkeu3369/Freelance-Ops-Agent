import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";
const path = "/workspace/projects/project-one/agent";

for (const width of [320, 390, 1440]) test(`${width}px model choice is local, keeps the draft and is used only on explicit send`, async ({ page }) => {
  const state = await fixture(page);
  state.connections = [{ id: "personal-example", provider: "OPENAI", model: "gpt-6-luna", maskedKey: "synthetic-...mask", updatedAt: "2026-10-01T00:00:00Z" }];
  await page.setViewportSize({ width, height: 844 });
  await page.goto(path);
  await page.locator("#agent-chat-input").fill("Keep my exact draft\nStill unsent");
  const trigger = page.locator(".chat-model-trigger");
  await trigger.focus();
  await trigger.press("ArrowDown");
  const popover = page.getByRole("dialog", { name: "AI 모델 선택", exact: true });
  await expect(popover.getByLabel("AI 연결", { exact: true })).toBeFocused();
  await popover.getByLabel("AI 연결", { exact: true }).selectOption("personal-example");
  await expect(popover).toContainText("제공사 계정에 청구");
  await expect(trigger).toContainText("gpt-6-luna");
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator("#agent-chat-input")).toHaveValue("Keep my exact draft\nStill unsent");
  expect(state.starts).toEqual([]);
  expect(state.writes).toEqual([]);
  await page.getByRole("button", { name: "AI 설정 열기", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "AI 설정", exact: true });
  await expect(settings.getByLabel("AI 연결", { exact: true })).toHaveValue("personal-example");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "AI 설정 열기", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].requirementText).toBe("Keep my exact draft\nStill unsent");
  expect(state.starts[0].modelSelection.credentialId).toBe("personal-example");
  await expect(trigger).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("pending sends lock tools and completion never changes or automatically sends the next draft", async ({ page }) => {
  const state = await fixture(page);
  const barrier = requestBarrier(); state.nextStart = barrier;
  try {
    await page.goto(path);
    await page.locator("#agent-chat-input").fill("One explicit request");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await barrier.entered;
    await expect(page.locator(".chat-model-trigger")).toBeDisabled();
    await expect(page.getByRole("button", { name: "AI 설정 열기", exact: true })).toBeDisabled();
    barrier.release();
    await expect(page.locator("#agent-chat-input")).toBeEditable();
    await page.locator("#agent-chat-input").fill("Next unsent draft");
    expect(state.starts).toHaveLength(1);
    await expect(page.locator(".chat-model-trigger")).toBeDisabled();
  } finally { barrier.release(); }
});

function seedRecordedRun(state, status) {
  state.run = { runId: "run-one", status, activeDepartment: null, interruption: status === "WAITING_FOR_USER" ? { interruptionId: "question-one", kind: "CLARIFICATION", questions: ["Please clarify the scope"] } : null, result: null, errorCode: null, metadata: { provider: "OPENAI", model: "historical-model", credentialId: "historical-key", promptVersion: "test", toolSchemaVersion: "test", traceId: "synthetic" }, usage: null, updatedAt: "2026-10-01T00:01:00Z" };
  state.history = [{ runId: "run-one", requirementText: "Historical sample", status, createdAt: "2026-10-01T00:01:00Z" }];
}

test("a reopened completed run labels the next selected model rather than its historical BYOK model", async ({ page }) => {
  const state = await fixture(page); seedRecordedRun(state, "COMPLETED");
  await page.goto(path);
  const trigger = page.locator(".chat-model-trigger");
  await expect(trigger).not.toContainText("historical-model");
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "AI 모델 선택", exact: true });
  await expect(menu.getByLabel("AI 연결", { exact: true })).toHaveValue("");
  const nextModel = await menu.getByLabel("AI 모델", { exact: true }).inputValue();
  await expect(trigger).toContainText(nextModel);
  await page.keyboard.press("Escape");
  await page.locator("#agent-chat-input").fill("New explicitly sent request");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].modelSelection.model).toBe(nextModel);
  expect(state.starts[0].modelSelection.credentialId).toBeUndefined();
});

test("unanswered clarification keeps model/reset controls locked", async ({ page }) => {
  const state = await fixture(page); seedRecordedRun(state, "WAITING_FOR_USER");
  await page.goto(path);
  await expect(page.locator(".chat-model-trigger")).toBeDisabled();
  await page.getByRole("button", { name: "AI 설정 열기", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "AI 설정", exact: true });
  await expect(settings).toContainText("작업 중에는 AI 설정을 바꿀 수 없습니다");
  await expect(settings.getByRole("button", { name: "새 분석 준비" })).toHaveCount(0);
  await expect(settings.locator("select")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".interruption-form")).toBeVisible();
  expect(state.starts).toEqual([]);
});
