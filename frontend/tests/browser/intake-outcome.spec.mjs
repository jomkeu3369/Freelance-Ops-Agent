import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const draftKey = "freelance-ops-requirement-draft-v1:local-user:local-space:project-one";
const recordedOutcome = { id: "outcome-one", workspaceId: "local-space", projectId: "project-one", approvedQuotationId: null, totalRevenue: 3000000, actualCost: 1000000, actualHours: 80, profitAmount: 2000000, profitMargin: .6667, completedOn: "2026-10-20", changeReason: "Recorded change", workItems: [{ title: "Recorded work", actualHours: 80, actualCost: 1000000, notes: "Keep notes" }] };

async function reviewFixture(page, { locale = "ko", theme = "dark", write = true, saved = false } = {}) {
  const state = await fixture(page);
  state.permissions.push("outcome.read", ...(write ? ["project.write", "outcome.write"] : []));
  Object.assign(state, { requirements: [], requirementWrites: [], failRequirements: false, nextRequirementSave: null, outcome: saved ? structuredClone(recordedOutcome) : null, outcomeWrites: [], failOutcome: false, nextOutcome: null, pageErrors: [] });
  page.on("pageerror", error => state.pageErrors.push(error.message));
  await page.addInitScript(({ locale, theme }) => {
    localStorage.setItem("freelance-ops-ui-locale-v1", locale);
    localStorage.setItem("theme", theme);
  }, { locale, theme });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v2/workspaces/local-space/projects/*/requirements", async route => {
    if (route.request().method() === "GET") return state.failRequirements ? route.fulfill({ status: 503, json: { message: "Synthetic requirements read failure" } }) : route.fulfill({ json: state.requirements });
    const input = route.request().postDataJSON();
    state.requirementWrites.push(input);
    const pending = state.nextRequirementSave; state.nextRequirementSave = null;
    if (pending) await pending.wait();
    const version = { ...input, id: "requirement-one", versionNumber: 1, createdAt: "2026-10-27T00:00:00Z", questions: input.questions.map(content => ({ content, status: "OPEN" })) };
    state.requirements = [version];
    return route.fulfill({ json: version });
  });
  await page.route("**/api/v2/workspaces/local-space/projects/*/outcome", async route => {
    if (route.request().method() === "GET") {
      const pending = state.nextOutcome; state.nextOutcome = null;
      if (pending) await pending.wait();
      return state.failOutcome ? route.fulfill({ status: 503, json: { message: "Synthetic outcome read failure" } }) : route.fulfill({ json: state.outcome });
    }
    const input = route.request().postDataJSON();
    state.outcomeWrites.push(input);
    state.outcome = { ...recordedOutcome, ...input };
    return route.fulfill({ json: state.outcome });
  });
  return state;
}

async function noOverflow(page, selector) {
  const overflow = await page.locator(selector).evaluateAll(elements => elements.flatMap(element => [...element.querySelectorAll("input, select, textarea, button, summary")]).filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
  }).map(element => element.outerHTML));
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [320, 375, 390, 768, 1024, 1280, 1440, 1920]) {
  for (const { locale, theme } of [{ locale: "ko", theme: "dark" }, { locale: "en", theme: "light" }]) {
    test(`${width}px ${locale} ${theme}: inquiry action and outcome fields remain readable and inside the viewport`, async ({ page }) => {
      const state = await reviewFixture(page, { locale, theme });
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto("/workspace/projects/project-one/intake");
      const next = page.locator(".intake-next button");
      await expect(next).toBeVisible();
      const box = await next.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
      await noOverflow(page, ".intake-review");
      if (width === 390 || width === 1440) await page.screenshot({ path: `outputs/ui-ux/intake-outcome/intake-${width}-${locale}.png` });
      await page.locator(".workbench-steps button").nth(3).click();
      await expect(page).toHaveURL(/\/outcome$/);
      await page.locator(".outcome-editor > summary").click();
      await expect(page.locator('input[name="totalRevenue"]')).toBeVisible();
      await noOverflow(page, ".outcome-review");
      const fonts = await page.locator(".outcome-control > label, .outcome-control > span, .outcome-input-shell > small").evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
      expect(fonts.length).toBeGreaterThan(0);
      expect(Math.min(...fonts)).toBeGreaterThanOrEqual(14);
      if (width === 390 || width === 1440) await page.screenshot({ path: `outputs/ui-ux/intake-outcome/outcome-${width}-${locale}.png` });
      expect(state.outcomeWrites).toEqual([]);
      expect(state.starts).toEqual([]);
      expect(state.pageErrors).toEqual([]);
      expect(state.blocked).toEqual([]);
    });
  }
}

test("manual requirement inputs survive close, step navigation and reload, then save exactly once", async ({ page }) => {
  const state = await reviewFixture(page);
  await page.goto("/workspace/projects/project-one/intake");
  await page.getByRole("button", { name: "직접 정리하기", exact: true }).click();
  await page.getByLabel("기능 이름", { exact: true }).fill("Draft feature");
  await page.getByLabel("설명", { exact: true }).fill("Keep description");
  await page.getByLabel("완료 기준", { exact: true }).fill("Keep acceptance");
  await page.getByRole("combobox", { name: /우선순위/ }).selectOption("SHOULD");
  await page.locator('textarea[name="assumptions"]').fill("Keep assumption\nSecond assumption");
  await page.locator('textarea[name="questions"]').fill("Keep question");
  await page.getByRole("button", { name: "편집 닫기", exact: true }).click();
  await page.getByRole("button", { name: "이어서 정리하기", exact: true }).click();
  await expect(page.getByLabel("기능 이름", { exact: true })).toHaveValue("Draft feature");
  await page.locator(".workbench-steps button").nth(3).click();
  await expect(page).toHaveURL(/\/outcome$/);
  await page.locator(".workbench-steps button").nth(0).click();
  await expect(page).toHaveURL(/\/intake$/);
  await page.getByRole("button", { name: "이어서 정리하기", exact: true }).click();
  await expect(page.locator('textarea[name="questions"]')).toHaveValue("Keep question");
  await page.reload();
  await page.getByRole("button", { name: "이어서 정리하기", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "완료 기준", exact: true })).toHaveValue("Keep acceptance");
  await expect(page.locator('textarea[name="assumptions"]')).toHaveValue("Keep assumption\nSecond assumption");
  await page.getByRole("button", { name: "사용자 확정 revision 저장", exact: true }).click();
  await expect(page.locator(".requirement-draft-note")).toHaveCount(0);
  expect(state.requirementWrites).toEqual([{ sourceText: state.projects[0].requirementText, features: [{ title: "Draft feature", description: "Keep description", priority: "SHOULD", acceptanceCriteria: "Keep acceptance" }], assumptions: ["Keep assumption", "Second assumption"], questions: ["Keep question"] }]);
  expect(await page.evaluate(key => sessionStorage.getItem(key), draftKey)).toBeNull();
  await page.getByRole("button", { name: "새 버전 만들기", exact: true }).click();
  await expect(page.getByLabel("기능 이름", { exact: true })).toHaveValue("Draft feature");
  await page.getByLabel("기능 이름", { exact: true }).fill("Discard this change");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "초안 버리기", exact: true }).click();
  await expect(page.getByLabel("기능 이름", { exact: true })).toHaveValue("Discard this change");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "초안 버리기", exact: true }).click();
  await expect(page.locator(".requirement-draft-note")).toHaveCount(0);
  expect(await page.evaluate(key => sessionStorage.getItem(key), draftKey)).toBeNull();
  await page.getByRole("button", { name: "새 버전 만들기", exact: true }).click();
  await expect(page.getByLabel("기능 이름", { exact: true })).toHaveValue("Draft feature");
  expect(state.pageErrors).toEqual([]);
});

test("requirement drafts are isolated per project and malformed stored inputs do not crash the editor", async ({ page }) => {
  const state = await reviewFixture(page);
  state.projects.push({ ...state.projects[0], id: "project-two", title: "Second project" });
  await page.addInitScript(key => sessionStorage.setItem(key, '{"version":1,"features":[null]}'), draftKey);
  await page.goto("/workspace/projects/project-one/intake");
  await page.getByRole("button", { name: "직접 정리하기", exact: true }).click();
  await page.getByLabel("기능 이름", { exact: true }).fill("Only project one");
  await page.goto("/workspace/projects/project-two/intake");
  await page.getByRole("button", { name: "직접 정리하기", exact: true }).click();
  await expect(page.getByLabel("기능 이름", { exact: true })).toHaveValue("");
  expect(state.pageErrors).toEqual([]);
});

test("a requirement read failure cannot replace a restored draft with blank inputs", async ({ page }) => {
  const state = await reviewFixture(page);
  await page.goto("/workspace/projects/project-one/intake");
  await page.getByRole("button", { name: "직접 정리하기", exact: true }).click();
  await page.getByLabel("기능 이름", { exact: true }).fill("Keep draft while offline");
  await page.locator('textarea[name="assumptions"]').fill("Keep offline assumption");
  state.failRequirements = true;
  await page.reload();
  await expect(page.locator(".intake-review").getByRole("alert")).toContainText("Synthetic requirements read failure");
  await page.getByRole("button", { name: "이어서 정리하기", exact: true }).click();
  await expect(page.getByLabel("기능 이름", { exact: true })).toHaveValue("Keep draft while offline");
  await expect(page.locator('textarea[name="assumptions"]')).toHaveValue("Keep offline assumption");
  expect(state.requirementWrites).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});

test("a delayed requirement save cannot delete a newer draft after leaving and reopening the editor", async ({ page }) => {
  const state = await reviewFixture(page);
  await page.goto("/workspace/projects/project-one/intake");
  await page.getByRole("button", { name: "직접 정리하기", exact: true }).click();
  await page.getByLabel("기능 이름", { exact: true }).fill("Submitted draft");
  await page.getByRole("textbox", { name: "설명", exact: true }).fill("Submitted description");
  const pending = requestBarrier(); state.nextRequirementSave = pending;
  await page.getByRole("button", { name: "사용자 확정 revision 저장", exact: true }).click();
  await pending.entered;
  await page.locator(".workbench-steps button").nth(3).click();
  await expect(page).toHaveURL(/\/outcome$/);
  await page.locator(".workbench-steps button").nth(0).click();
  await expect(page).toHaveURL(/\/intake$/);
  await page.getByRole("button", { name: "이어서 정리하기", exact: true }).click();
  await page.getByLabel("기능 이름", { exact: true }).fill("Newer unsaved draft");
  await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key))?.features[0]?.title, draftKey)).toBe("Newer unsaved draft");
  const response = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/requirements"));
  pending.release();
  await (await response).finished();
  await page.locator(".workbench-steps button").nth(3).click();
  await expect(page).toHaveURL(/\/outcome$/);
  await page.locator(".workbench-steps button").nth(0).click();
  await expect(page).toHaveURL(/\/intake$/);
  await page.getByRole("button", { name: "이어서 정리하기", exact: true }).click();
  await expect(page.getByLabel("기능 이름", { exact: true })).toHaveValue("Newer unsaved draft");
  await page.reload();
  await page.getByRole("button", { name: "이어서 정리하기", exact: true }).click();
  await expect(page.getByLabel("기능 이름", { exact: true })).toHaveValue("Newer unsaved draft");
  expect(state.requirementWrites).toHaveLength(1);
  expect(state.requirementWrites[0].features[0].title).toBe("Submitted draft");
  expect(state.pageErrors).toEqual([]);
});

test("failed outcome reads expose retry without a writable blank form; retry restores saved values", async ({ page }) => {
  const state = await reviewFixture(page, { saved: true });
  state.failOutcome = true;
  await page.goto("/workspace/projects/project-one/outcome");
  await expect(page.locator(".outcome-load-error")).toContainText("Synthetic outcome read failure");
  await expect(page.locator(".outcome-editor")).toHaveCount(0);
  expect(state.outcomeWrites).toEqual([]);
  state.failOutcome = false; const pending = requestBarrier(); state.nextOutcome = pending;
  await page.locator(".outcome-load-error button").click();
  await pending.entered;
  await expect(page.locator(".section-loading")).toBeVisible();
  await expect(page.locator(".outcome-editor")).toHaveCount(0);
  pending.release();
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('input[name="totalRevenue"]')).toHaveValue("3000000");
  await expect(page.locator('input[name="actualCost"]')).toHaveValue("1000000");
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Recorded change");
  expect(state.outcomeWrites).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});

test("existing outcome values survive collapsing and saving while read-only users cannot edit", async ({ page }) => {
  const state = await reviewFixture(page, { saved: true });
  await page.goto("/workspace/projects/project-one/outcome");
  await page.locator(".outcome-editor > summary").click();
  await page.locator('input[name="actualHours"]').fill("90");
  await page.locator(".outcome-editor > summary").click();
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('input[name="actualHours"]')).toHaveValue("90");
  await page.getByRole("button", { name: "사용자 확정 결과 저장", exact: true }).click();
  await expect.poll(() => state.outcomeWrites.length).toBe(1);
  expect(state.outcomeWrites[0]).toEqual({ approvedQuotationId: null, totalRevenue: 3000000, actualCost: 1000000, actualHours: 90, completedOn: "2026-10-20", changeReason: "Recorded change", workItems: [{ quotationItemId: null, ...recordedOutcome.workItems[0] }] });
  state.permissions = state.permissions.filter(permission => !["project.write", "outcome.write"].includes(permission));
  await page.reload();
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('input[name="totalRevenue"]')).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "사용자 확정 결과 저장", exact: true })).toHaveCount(0);
  await page.locator(".workbench-steps button").nth(0).click();
  await expect(page.getByRole("button", { name: "직접 정리하기", exact: true })).toHaveCount(0);
  expect(state.pageErrors).toEqual([]);
});
