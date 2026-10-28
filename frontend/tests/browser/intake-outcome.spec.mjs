import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const draftKey = "freelance-ops-requirement-draft-v1:local-user:local-space:project-one";
const recordedOutcome = { id: "outcome-one", workspaceId: "local-space", projectId: "project-one", approvedQuotationId: null, totalRevenue: 3000000, actualCost: 1000000, actualHours: 80, profitAmount: 2000000, profitMargin: .6667, completedOn: "2026-10-20", changeReason: "Recorded change", workItems: [{ title: "Recorded work", actualHours: 80, actualCost: 1000000, notes: "Keep notes" }], version: 1 };

async function reviewFixture(page, { locale = "ko", theme = "dark", write = true, saved = false } = {}) {
  const state = await fixture(page);
  state.permissions.push("outcome.read", ...(write ? ["project.write", "outcome.write"] : []));
  Object.assign(state, { requirements: [], requirementWrites: [], failRequirements: false, nextRequirementSave: null, outcome: saved ? structuredClone(recordedOutcome) : null, outcomeWrites: [], failOutcome: false, nextOutcome: null, nextOutcomeSave: null, failOutcomeSave: false, pageErrors: [] });
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
    const pending = state.nextOutcomeSave; state.nextOutcomeSave = null;
    if (pending) await pending.wait();
    if (state.failOutcomeSave) return route.fulfill({ status: 503, json: { message: "Synthetic outcome save failure" } });
    state.outcome = { ...recordedOutcome, ...input, version: (state.outcome?.version ?? 0) + 1 };
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

test("outcome draft survives step navigation, reload and save failure before an explicit successful save", async ({ page }) => {
  const state = await reviewFixture(page);
  await page.goto("/workspace/projects/project-one/outcome");
  await page.locator(".outcome-editor > summary").click();
  await page.locator('input[name="totalRevenue"]').fill("3000000");
  await page.locator('input[name="actualCost"]').fill("400000");
  await page.locator('input[name="actualHours"]').fill("22.5");
  await page.locator('input[name="completedOn"]').fill("2026-10-28");
  await page.locator('textarea[name="changeReason"]').fill("Draft outcome reason");
  await page.getByRole("button", { name: "첫 항목 추가" }).click();
  await page.getByLabel("작업명", { exact: true }).fill("Draft task");
  await page.getByLabel("작업 메모", { exact: true }).fill("Draft task notes");
  await page.locator(".workbench-steps button").nth(2).click();
  await page.locator(".workbench-steps button").nth(3).click();
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Draft outcome reason");
  await page.reload();
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('input[name="actualHours"]')).toHaveValue("22.5");
  await expect(page.getByLabel("작업명", { exact: true })).toHaveValue("Draft task");
  await expect(page.getByRole("textbox", { name: "작업 메모" })).toHaveValue("Draft task notes");
  state.failOutcomeSave = true;
  await page.getByRole("button", { name: "사용자 확정 결과 저장" }).click();
  await expect(page.locator(".outcome-review").getByRole("alert")).toContainText("Synthetic outcome save failure");
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Draft outcome reason");
  state.failOutcomeSave = false;
  await page.getByRole("button", { name: "사용자 확정 결과 저장" }).click();
  await expect.poll(() => state.outcome?.changeReason).toBe("Draft outcome reason");
  await page.reload();
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Draft outcome reason");
  await expect(page.getByText("미저장 초안입니다.", { exact: false })).toHaveCount(0);
  expect(state.outcomeWrites).toHaveLength(2);
  expect(state.pageErrors).toEqual([]);
});

test("a newer saved outcome blocks a restored older draft until explicit review", async ({ page }) => {
  const state = await reviewFixture(page, { saved: true });
  await page.goto("/workspace/projects/project-one/outcome");
  await page.locator(".outcome-editor > summary").click();
  await page.locator('textarea[name="changeReason"]').fill("Keep my draft");
  state.outcome = { ...state.outcome, version: 2, actualHours: 99 };
  await page.reload();
  await expect(page.locator(".outcome-review").getByRole("alert")).toContainText("저장된 결과가 초안 작성 이후 변경됐습니다");
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Keep my draft");
  await expect(page.getByRole("button", { name: "사용자 확정 결과 저장" })).toBeDisabled();
  await page.getByRole("button", { name: "현재 초안으로 계속 편집" }).click();
  await expect(page.getByRole("button", { name: "사용자 확정 결과 저장" })).toBeEnabled();
  expect(state.outcomeWrites).toEqual([]);
});

test("an outcome changed after the editor opened is checked before saving", async ({ page }) => {
  const state = await reviewFixture(page, { saved: true });
  await page.goto("/workspace/projects/project-one/outcome");
  await page.locator(".outcome-editor > summary").click();
  await page.locator('textarea[name="changeReason"]').fill("My pending change");
  state.outcome = { ...state.outcome, version: 2, changeReason: "Another edit" };
  await page.getByRole("button", { name: "사용자 확정 결과 저장" }).click();
  await expect(page.locator(".outcome-review").getByRole("alert")).toContainText("Another edit");
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("My pending change");
  await expect(page.getByRole("button", { name: "사용자 확정 결과 저장" })).toBeDisabled();
  expect(state.outcomeWrites).toEqual([]);
});

test("a delayed outcome save cannot erase an edited draft after navigation", async ({ page }) => {
  const state = await reviewFixture(page, { saved: true });
  await page.goto("/workspace/projects/project-one/outcome");
  await page.locator(".outcome-editor > summary").click();
  await page.locator('textarea[name="changeReason"]').fill("Submitted outcome");
  const pending = requestBarrier(); state.nextOutcomeSave = pending;
  await page.getByRole("button", { name: "사용자 확정 결과 저장" }).click();
  await pending.entered;
  await page.locator(".workbench-steps button").nth(2).click();
  await page.locator(".workbench-steps button").nth(3).click();
  await page.locator(".outcome-editor > summary").click();
  await page.locator('textarea[name="changeReason"]').fill("Newer outcome draft");
  pending.release();
  await expect(page.locator(".outcome-review").getByRole("alert")).toContainText("저장된 결과가 초안 작성 이후 변경됐습니다");
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Newer outcome draft");
  await page.reload();
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Newer outcome draft");
  expect(state.outcomeWrites).toHaveLength(1);
});

test("outcome drafts are isolated by project and survive storage failure during step navigation", async ({ page }) => {
  const state = await reviewFixture(page);
  state.projects.push({ ...state.projects[0], id: "project-two", title: "Second project" });
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("freelance-ops-outcome-draft-v1:")) throw new Error("storage unavailable");
      return original.call(this, key, value);
    };
  });
  await page.goto("/workspace/projects/project-one/outcome");
  await page.locator(".outcome-editor > summary").click();
  await page.locator('textarea[name="changeReason"]').fill("Only project one");
  await expect(page.getByRole("status").filter({ hasText: "새로고침하면 사라질 수 있습니다" })).toBeVisible();
  await page.locator(".workbench-steps button").nth(2).click();
  await page.locator(".workbench-steps button").nth(3).click();
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Only project one");
  await expect(page.getByRole("status").filter({ hasText: "새로고침하면 사라질 수 있습니다" })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.goto("/workspace/projects/project-two/outcome");
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("");
  expect(state.pageErrors).toEqual([]);
});

test("memory-only outcome drafts can be saved or discarded when storage access is blocked", async ({ page }) => {
  const state = await reviewFixture(page, { saved: true });
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function(key, ...rest) {
        if (key.startsWith("freelance-ops-outcome-draft-v1:")) throw new Error("storage blocked");
        return original.call(this, key, ...rest);
      };
    }
  });
  await page.goto("/workspace/projects/project-one/outcome");
  await page.locator(".outcome-editor > summary").click();
  await page.locator('textarea[name="changeReason"]').fill("Discard this test draft");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "초안 버리기" }).click();
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Recorded change");
  await expect(page.locator(".outcome-review").getByRole("alert")).toContainText("이전 초안을 정리하지 못했습니다");
  await page.locator(".workbench-steps button").nth(2).click();
  await page.locator(".workbench-steps button").nth(3).click();
  await expect(page.locator(".outcome-review").getByRole("alert")).toContainText("이전 초안을 정리하지 못했습니다");
  await page.locator(".outcome-editor > summary").click();
  await expect(page.locator('textarea[name="changeReason"]')).toHaveValue("Recorded change");
  await page.locator('textarea[name="changeReason"]').fill("Save this test draft");
  await page.getByRole("button", { name: "사용자 확정 결과 저장" }).click();
  await expect.poll(() => state.outcome?.changeReason).toBe("Save this test draft");
  await expect(page.locator(".outcome-review").getByRole("alert")).toContainText("이전 초안을 정리하지 못했습니다");
  await expect(page.getByText("저장된 결과가 초안 작성 이후 변경됐습니다", { exact: false })).toHaveCount(0);
  expect(state.outcomeWrites).toHaveLength(1);
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
