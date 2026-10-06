import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const settings = page => page.getByRole("dialog", { name: "AI 설정", exact: true });
async function inViewport(page, locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
}
function completed(state) {
  state.run = { runId: "completed-layout", status: "COMPLETED", activeDepartment: null, interruption: null, result: { projectSummary: "가상의 고객 문의를 검토했습니다. 범위와 일정은 결과에서 확인하세요.", openQuestions: [], departmentResults: [], quotationDraft: null, quotationDrafts: [] }, errorCode: null, metadata: null, updatedAt: "2026-10-06T00:00:00Z" };
  state.history = [{ runId: state.run.runId, requirementText: "고객 문의를 정리하고 다음 작업을 알려 주세요.", status: "COMPLETED", createdAt: state.run.updatedAt }];
}
for (const theme of ["light", "dark"]) for (const [width, height] of [[320, 568], [390, 844], [1440, 900]]) {
  test(`${theme} ${width}px compact composer and full-width settings are bounded and keyboard accessible`, async ({ page }) => {
    const state = await fixture(page); completed(state);
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    await page.setViewportSize({ width, height }); await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const composer = page.locator(".agent-chat-composer");
    const clip = page.getByRole("button", { name: "파일 첨부", exact: true });
    const gear = page.getByRole("button", { name: "AI 설정 열기", exact: true });
    const model = page.locator(".chat-model-trigger");
    await expect(composer.locator(".skill-selector")).toHaveCount(0);
    await expect(composer).not.toContainText("TXT·CSV·PDF");
    await expect(clip).toHaveText("");
    for (const control of [clip, gear, model, composer.locator('button[type="submit"]')]) await inViewport(page, control);
    const [clipBox, gearBox, modelBox] = await Promise.all([clip.boundingBox(), gear.boundingBox(), model.boundingBox()]);
    expect(clipBox.width).toBeGreaterThanOrEqual(44); expect(clipBox.height).toBeGreaterThanOrEqual(44);
    expect(clipBox.x + clipBox.width).toBeLessThanOrEqual(gearBox.x + 1);
    expect(gearBox.x + gearBox.width).toBeLessThanOrEqual(modelBox.x + 1);
    expect(Math.abs(clipBox.y - modelBox.y)).toBeLessThanOrEqual(3);
    expect((await composer.boundingBox()).height).toBeLessThan(150);
    await page.screenshot({ path: `outputs/ui-ux/composer-design-${theme}-${width}.png`, animations: "disabled" });
    await clip.focus(); await clip.press("Tab"); await expect(gear).toBeFocused();
    await gear.press("Enter"); await expect(settings(page).getByRole("button", { name: "닫기", exact: true })).toBeFocused();
    await inViewport(page, settings(page));
    const fields = settings(page).locator(".run-controls");
    const fieldBox = await fields.boundingBox(); const dialogBox = await settings(page).boundingBox();
    expect(fieldBox.width).toBeGreaterThan(dialogBox.width * .75);
    if (width < 820) expect(await fields.locator("select").first().evaluate(element => getComputedStyle(element).fontSize)).toBe("16px");
    await expect(settings(page)).toContainText("예상 실제 비용이 아닙니다");
    await expect(settings(page)).toContainText("접근 권한은 아직 확인되지");
    await expect(settings(page)).toContainText("낮음 · 보통 · 높음");
    await expect(settings(page)).not.toContainText("LOW, MEDIUM");
    await settings(page).screenshot({ path: `outputs/ui-ux/settings-design-${theme}-${width}.png`, animations: "disabled" });
    await page.keyboard.press("Escape"); await expect(gear).toBeFocused();
    await model.press("ArrowDown"); const menu = page.getByRole("dialog", { name: "AI 모델 선택", exact: true });
    await inViewport(page, menu);
    await page.keyboard.press("Escape"); await expect(model).toBeFocused();
    await page.getByRole("button", { name: "작업 자세히 보기", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "작업 자세히 보기", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(state.starts).toEqual([]); expect(state.writes).toEqual([]); expect(state.blocked).toEqual([]);
  });
}

test("gear controls preserve current-draft Auto matching, manual choices, search, exclusions and project isolation", async ({ page }) => {
  const state = await fixture(page);
  state.projects.push({ ...state.projects[0], id: "project-two", title: "Second project" });
  await page.goto(path); await page.locator("#agent-chat-input").fill("Prepare a proposal");
  const gear = page.getByRole("button", { name: "AI 설정 열기", exact: true });
  await gear.click(); const skills = settings(page).locator(".skill-selector");
  await expect(skills.locator(".skill-active")).toContainText("제안서");
  await skills.locator("summary").click();
  await skills.getByLabel("스킬 검색").fill("proposal");
  await expect(skills.locator(".skill-results button")).toHaveCount(1);
  await skills.locator(".skill-results button").click();
  await page.keyboard.press("Escape"); await gear.click();
  await expect(skills.locator("summary")).toContainText("직접 선택 (1)");
  await page.keyboard.press("Escape"); await page.reload(); await gear.click();
  await expect(skills.locator("summary")).toContainText("직접 선택 (1)");
  await page.keyboard.press("Escape");
  await page.goto("/workspace/projects/project-two/agent"); await gear.click();
  await expect(settings(page).locator(".skill-selector summary")).toContainText("자동");
  await expect(settings(page).locator(".skill-active button")).toHaveCount(0);
  expect(state.starts).toEqual([]); expect(state.writes).toEqual([]);
});

test("paused or unknown model states stay honest and long names cannot overflow narrow settings", async ({ page }) => {
  const state = await fixture(page); completed(state);
  state.aiUsage.spendingEnabled = false;
  state.aiUsage.models = state.aiUsage.models.map(model => ({ ...model, available: false, unavailableReason: "SPENDING_DISABLED" }));
  state.connections = [{ id: "long-key", provider: "OPENAI", model: "very-long-synthetic-model-name-".repeat(10), maskedKey: "synthetic-...mask", updatedAt: "2026-10-01T00:00:00Z" }];
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto(path);
  await page.locator("#agent-chat-input").fill("Do not send");
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "AI 설정 열기", exact: true }).click();
  await expect(settings(page)).toContainText("기본 제공 AI 실행이 현재 중지");
  await expect(settings(page)).not.toContainText("SPENDING_DISABLED");
  await settings(page).getByLabel("AI 연결", { exact: true }).selectOption("long-key");
  await expect(settings(page)).toContainText("비용 기준을 확인하지 못했습니다");
  await inViewport(page, settings(page));
  expect(await settings(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.locator(".chat-model-trigger").click();
  await inViewport(page, page.getByRole("dialog", { name: "AI 모델 선택", exact: true }));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  expect(state.starts).toEqual([]); expect(state.writes).toEqual([]);
});

test("paperclip invokes the real chooser, rejects unsupported files and stays locked during an explicit pending send", async ({ page }) => {
  const state = await fixture(page); const barrier = requestBarrier();
  await page.goto(path);
  const clip = page.getByRole("button", { name: "파일 첨부", exact: true });
  const chooser = page.waitForEvent("filechooser"); await clip.click();
  await (await chooser).setFiles({ name: "unsupported.exe", mimeType: "application/octet-stream", buffer: Buffer.from("Synthetic only") });
  await expect(page.locator(".chat-attachments [role=alert]")).toBeVisible();
  await expect(page.locator(".chat-attachments li")).toHaveCount(0);
  await page.locator("#agent-chat-input").fill("Explicit synthetic request"); state.nextStart = barrier;
  try {
    await page.getByRole("button", { name: "보내기", exact: true }).click(); await barrier.entered;
    await expect(clip).toBeDisabled();
    await expect(page.getByRole("button", { name: "AI 설정 열기", exact: true })).toBeDisabled();
  } finally { barrier.release(); }
  await expect.poll(() => state.starts.length).toBe(1);
});
