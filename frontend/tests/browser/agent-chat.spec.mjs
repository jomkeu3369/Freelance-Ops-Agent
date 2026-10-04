import { test, expect } from "@playwright/test";

import { fixture } from "./helpers/chat-fixture.mjs";

test("chat sends the exact user text, displays real task events, cancels, and preserves draft and language", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/projects/project-one/agent");
  const input = page.locator("#agent-chat-input");
  await expect(input).toBeVisible();
  await input.fill("  Review the exact customer wording  ");
  await page.locator(".agent-chat-composer button[type=submit]").click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].requirementText).toBe("  Review the exact customer wording  ");
  await expect(page.locator(".agent-chat-message.user")).toContainText("Review the exact customer wording");
  await expect(page.locator(".agent-chat-activity")).toContainText("요구사항 정리");
  await page.locator(".agent-chat-actions .danger").click();
  await expect(page.locator(".agent-chat-message.assistant")).toContainText("사용자 중단");
  await input.fill("Unsent draft stays mine");
  await page.locator(".ui-language-selector select").selectOption("en");
  await page.reload();
  await expect(page.locator(".ui-language-selector select")).toHaveValue("en");
  await expect(page.getByRole("region", { name: "Agent conversation" })).toBeVisible();
  await expect(input).toHaveValue("Unsent draft stays mine");
  await expect(page.locator(".agent-chat-message.user")).toContainText("Review the exact customer wording");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "outputs/ui-ux/chat-390-en.png", fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "outputs/ui-ux/chat-1440-en.png", fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.blocked).toEqual([]);
});

test("chat settings proposal needs explicit confirmation and survives refresh", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/workspace/projects/project-one/agent");
  await page.locator("#agent-chat-input").fill("기본 세율 12%, 위험 버퍼 15%, 최대 할인 20%로 변경");
  await page.locator(".agent-chat-composer button[type=submit]").click();
  await expect(page.locator(".agent-chat-policy")).toContainText("10% → 12%");
  await page.screenshot({ path: "outputs/ui-ux/chat-320-ko-proposal.png", fullPage: false });
  expect(state.proposal.sourceMessage).toBe("기본 세율 12%, 위험 버퍼 15%, 최대 할인 20%로 변경");
  expect(state.policy.defaultTaxRate).toBe(.1);
  expect(state.starts).toHaveLength(0);
  await page.reload();
  await expect(page.locator(".agent-chat-policy")).toContainText("10% → 12%");
  await page.locator(".agent-chat-policy button").click();
  await expect(page.locator(".agent-chat-policy")).toContainText("견적 기본 설정이 변경되었습니다.");
  expect(state.policy.defaultTaxRate).toBe(.12);
  expect(state.confirms).toBe(1);
  await page.reload();
  await expect(page.locator(".agent-chat-message.assistant")).toContainText("적용됨");
  expect(state.confirms).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.blocked).toEqual([]);
});
