import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const path = "/workspace/settings";
const key = "synthetic-key-never-real-123456";
const saved = { id: "saved-openai", provider: "OPENAI", model: "gpt-6-luna", maskedKey: "••••1234", updatedAt: "2026-10-20T15:00:00Z" };

async function openConnections(page, options = {}) {
  const { width = 1440, theme = "light", locale = "ko" } = options;
  await page.setViewportSize({ width, height: 1000 });
  const state = await fixture(page);
  state.connections = structuredClone(options.connections ?? []);
  const server = { readStatus: 200, saveStatus: 200, deleteStatus: 204, available: true, puts: [], deletes: [], ...options };
  await page.addInitScript(({ theme, locale }) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("freelance-ops-ui-locale-v1", locale);
  }, { theme, locale });
  await page.route("**/api/v2/workspaces/*/ai-connections**", async route => {
    const request = route.request();
    const method = request.method();
    if (method === "GET") {
      if (server.readBarrier) await server.readBarrier.wait();
      return route.fulfill({ status: server.readStatus, json: server.readStatus === 200 ? { available: server.available, models: { OPENAI: ["gpt-6-luna", "gpt-6-sol"] }, connections: state.connections } : { message: "Synthetic read failure" } });
    }
    if (method === "PUT") {
      const body = request.postDataJSON();
      server.puts.push(body);
      if (server.saveBarrier) await server.saveBarrier.wait();
      if (server.saveStatus !== 200) return route.fulfill({ status: server.saveStatus, json: { message: "Synthetic save failure" } });
      const connection = { ...saved, model: body.model, maskedKey: "••••6789" };
      state.connections = [...state.connections.filter(item => item.provider !== "OPENAI"), connection];
      return route.fulfill({ json: connection });
    }
    if (method === "DELETE") {
      const id = new URL(request.url()).pathname.split("/").at(-1);
      server.deletes.push(id);
      if (server.deleteStatus !== 204) return route.fulfill({ status: server.deleteStatus, json: { message: "Synthetic delete failure" } });
      state.connections = state.connections.filter(item => item.id !== id);
      return route.fulfill({ status: 204 });
    }
    return route.abort();
  });
  await page.goto(path);
  const section = page.locator("#ai-connections");
  await expect(section).toBeVisible();
  return { section, state, server };
}

for (const [width, theme, locale] of [
  [1440, "light", "ko"], [1024, "light", "ko"], [821, "light", "ko"],
  [760, "light", "en"], [390, "light", "ko"], [320, "dark", "ko"], [1440, "dark", "en"]
]) {
  test(`${width}px ${theme} ${locale}: form and guidance follow the approved layout without overflow`, async ({ page }) => {
    const { section, state } = await openConnections(page, { width, theme, locale });
    await expect(section.locator(".ai-connection-status")).toHaveAttribute("data-state", "empty");
    await expect(section.locator('input[type="password"]')).toHaveValue("");
    await expect(section.locator('button[type="submit"]')).toBeDisabled();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await section.evaluate(element => {
      const editor = element.querySelector(".ai-connection-editor").getBoundingClientRect();
      const guide = element.querySelector(".ai-connection-guide").getBoundingClientRect();
      return { editor: { x: editor.x, bottom: editor.bottom }, guide: { x: guide.x, y: guide.y } };
    });
    if (width === 1440) expect(geometry.guide.x).toBeGreaterThan(geometry.editor.x + 100);
    else expect(geometry.guide.y).toBeGreaterThanOrEqual(geometry.editor.bottom);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await section.locator("h2, h3, label, .ai-connection-status, .ai-connection-guide, .ai-connection-billing").evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
    expect(overflow).toEqual([]);
    if (locale === "en") expect(await section.innerText()).not.toMatch(/[가-힣]/);
    expect(state.starts).toEqual([]);
    expect(state.writes).toEqual([]);
    if (width === 1440) await section.screenshot({ path: `outputs/ui-ux/ai-connection-${theme}.png` });
    if (width === 390) {
      await page.setViewportSize({ width, height: 1800 });
      await section.screenshot({ path: "outputs/ui-ux/ai-connection-mobile.png" });
    }
  });
}

test("registration clears the submitted key during verification and never starts analysis", async ({ page }) => {
  const { section, state, server } = await openConnections(page);
  const input = section.getByLabel("API 키", { exact: true });
  await input.fill(key);
  await section.getByRole("combobox", { name: "모델", exact: true }).selectOption("gpt-6-sol");
  server.saveBarrier = requestBarrier();
  await section.getByRole("button", { name: "확인 후 연결", exact: true }).click();
  await server.saveBarrier.entered;
  await expect(input).toHaveValue("");
  await expect(input).toBeDisabled();
  await expect(section.locator('button[type="submit"]')).toBeDisabled();
  expect(server.puts).toEqual([{ model: "gpt-6-sol", apiKey: key }]);
  server.saveBarrier.release();
  await expect(section.locator(".ai-connection-status")).toHaveText("등록된 연결 1개");
  await expect(section.locator("article")).toContainText("OPENAI · gpt-6-sol");
  await expect(section.locator("article")).toContainText("••••6789");
  await expect(section.getByRole("status")).toContainText("연결을 선택");
  expect(await section.innerText()).not.toContain(key);
  expect(state.starts).toEqual([]);
});

test("replacing a saved provider keeps one connection and uses the selected model", async ({ page }) => {
  const { section, state, server } = await openConnections(page, { connections: [saved] });
  await section.getByRole("combobox", { name: "모델", exact: true }).selectOption("gpt-6-sol");
  await section.getByLabel("API 키", { exact: true }).fill(key);
  await section.getByRole("button", { name: "확인 후 연결 교체", exact: true }).click();
  await expect(section.locator("article")).toHaveCount(1);
  await expect(section.locator("article")).toContainText("gpt-6-sol");
  await expect(section.locator(".ai-connection-status")).toHaveText("등록된 연결 1개");
  expect(server.puts).toHaveLength(1);
  expect(state.starts).toEqual([]);
});

test("failed registration preserves the existing connection and requires re-entering the key", async ({ page }) => {
  const { section, server } = await openConnections(page, { connections: [saved], saveStatus: 403 });
  await section.getByLabel("API 키", { exact: true }).fill(key);
  await section.getByRole("button", { name: "확인 후 연결 교체", exact: true }).click();
  await expect(section.getByRole("alert")).toContainText("연결하지 못했습니다");
  await expect(section.getByLabel("API 키", { exact: true })).toHaveValue("");
  await expect(section.locator("article")).toContainText("••••1234");
  await expect(section.locator('button[type="submit"]')).toBeDisabled();
  expect(server.puts).toHaveLength(1);
});

test("deletion requires confirmation, supports cancel and keeps a failed deletion retryable", async ({ page }) => {
  const { section, server } = await openConnections(page, { connections: [saved] });
  await section.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(section.locator(".ai-connection-delete-confirm")).toContainText("진행 중인 호출은 취소되지 않습니다");
  expect(server.deletes).toEqual([]);
  await section.getByRole("button", { name: "취소", exact: true }).click();
  await expect(section.locator(".ai-connection-delete-confirm")).toHaveCount(0);
  await section.getByRole("button", { name: "삭제", exact: true }).click();
  server.deleteStatus = 503;
  await section.getByRole("button", { name: "연결 삭제", exact: true }).click();
  await expect(section.getByRole("alert")).toContainText("삭제하지 못했습니다");
  await expect(section.locator("article")).toHaveCount(1);
  server.deleteStatus = 204;
  await section.getByRole("button", { name: "연결 삭제", exact: true }).click();
  await expect(section.locator("article")).toHaveCount(0);
  await expect(section.locator(".ai-connection-status")).toHaveAttribute("data-state", "empty");
  expect(server.deletes).toEqual([saved.id, saved.id]);
});

test("loading and failed reads never claim that there are no saved keys", async ({ page }) => {
  const readBarrier = requestBarrier();
  const { section } = await openConnections(page, { readBarrier, readStatus: 503 });
  await readBarrier.entered;
  await expect(section.locator(".ai-connection-status")).toHaveAttribute("data-state", "loading");
  await expect(section.getByText("아직 연결된 키가 없습니다", { exact: true })).toHaveCount(0);
  readBarrier.release();
  await expect(section.getByRole("alert")).toContainText("불러오지 못했습니다");
  await expect(section.locator(".ai-connection-status")).toHaveAttribute("data-state", "error");
  await expect(section.locator("form")).toHaveCount(0);
});

test("unavailable registration has an explicit status and retains billing and scope information", async ({ page }) => {
  const { section } = await openConnections(page, { available: false });
  await expect(section.locator(".ai-connection-status")).toHaveAttribute("data-state", "unavailable");
  await expect(section.locator("form")).toHaveCount(0);
  await expect(section.getByRole("status")).toContainText("다른 AI로 자동 전환하지 않습니다");
  await expect(section.locator(".ai-connection-billing")).toContainText("제공사 계정에 청구");
  await expect(section.locator(".ai-connection-billing")).toContainText("별도 AI 생성은 지원하지 않습니다");
});

test("retired and long saved connections remain readable on mobile and are never offered as providers", async ({ page }) => {
  const retired = { ...saved, id: "retired", provider: "GEMINI", model: "retired-model" };
  const long = { ...saved, model: "supported-model-with-a-long-saved-identifier-".repeat(3) };
  const { section, server } = await openConnections(page, { width: 320, locale: "en", theme: "dark", connections: [retired, long] });
  await expect(section.locator("article")).toHaveCount(2);
  await expect(section.getByRole("combobox", { name: "Provider", exact: true }).locator("option")).toHaveText(["OpenAI"]);
  await expect(section.locator(".ai-connection-retired")).toContainText("no longer supported");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await section.innerText()).not.toMatch(/[가-힣]/);
  await section.locator("article").first().getByRole("button", { name: "Delete", exact: true }).click();
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(server.deletes).toEqual([]);
});
