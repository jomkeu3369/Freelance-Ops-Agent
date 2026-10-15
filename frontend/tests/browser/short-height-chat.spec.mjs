import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";
const path = "/workspace/projects/project-one/agent";

for (const [width, height] of [[393, 252], [472, 303], [320, 180]]) {
  test(`${width}×${height}: model, settings and send controls remain reachable without document overflow`, async ({ page, context }) => {
    const state = await fixture(page);
    await page.setViewportSize({ width, height });
    await page.goto(path);
    await page.locator("#agent-chat-input").fill("A preserved draft\n".repeat(20));
    await context.setOffline(true);
    await expect(page.locator(".agent-chat-state")).toHaveText("오프라인");
    const main = page.locator(".workspace-main");
    expect(await main.evaluate(element => getComputedStyle(element).overflowY)).toBe("auto");
    for (const control of [page.locator(".chat-model-trigger"), page.getByRole("button", { name: "AI 설정 열기", exact: true }), page.locator('.agent-chat-composer button[type="submit"]')]) {
      // 페이지 스크롤이 아닌 비상 내부 스크롤 복구를 검증한다.
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    }
    const trigger = page.locator(".chat-model-trigger");
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "AI 모델 선택", exact: true });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    // 포인터로 열면 호출 버튼에 포커스를 유지하고 키보드로 열면 메뉴 안으로 옮긴다.
    // 동작을 바꾸지 않고 두 경로를 모두 확인한다.
    await expect(trigger).toBeFocused();
    await menu.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.press("ArrowDown");
    await expect(menu.getByLabel("AI 연결", { exact: true })).toBeFocused();
    await menu.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.locator(".chat-model-trigger")).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator("#agent-chat-input")).toHaveValue("A preserved draft\n".repeat(20));
    expect(state.starts).toEqual([]);
  });
}
