import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const steps = ["intake", "agent", "quote", "outcome"];
const title = "Studio website · Synthetic project";
const clientLabel = "Example Studio · Synthetic Client";
const path = (project = "project-one", step = "agent") => `/workspace/projects/${project}/${step}`;
const nav = page => page.locator(".workbench-steps");
const heading = page => page.locator(".project-heading");
const input = page => page.locator("#agent-chat-input");
const labels = {
  ko: { steps: ["문의", "AI 분석", "견적", "결과"], status: "신규 문의", edit: "프로젝트 정보 수정", remove: "프로젝트 삭제" },
  en: { steps: ["Inquiry", "AI analysis", "Estimate", "Outcome"], status: "New inquiry", edit: "Edit project details", remove: "Delete project" },
};

async function shellFixture(page, { locale = "ko", theme = "light", actions = ["project.write", "project.delete"] } = {}) {
  const state = await fixture(page);
  state.permissions.push("client.read", "outcome.read", ...actions);
  Object.assign(state.projects[0], { title, clientId: "synthetic-client" });
  state.pageErrors = [];
  page.on("pageerror", error => state.pageErrors.push(error.message));
  await page.addInitScript(({ locale, theme }) => {
    localStorage.setItem("freelance-ops-ui-locale-v1", locale);
    localStorage.setItem("theme", theme);
  }, { locale, theme });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // 이 묶음의 추가 조회 경로는 로컬 모의 응답으로 처리한다.
  // 공통 응답은 배열이지만 성과가 없는 경우에는 명시적으로 null을 반환한다.
  await page.route("**/api/v2/workspaces/local-space/clients", route => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: [{ id: "synthetic-client", name: "Synthetic Client", companyName: "Example Studio", status: "ACTIVE" }] });
  });
  await page.route("**/api/v2/workspaces/local-space/projects/*/outcome", route => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  return state;
}

function expectNoChanges(state) {
  expect(state.starts).toEqual([]);
  expect(state.writes).toEqual([]);
  expect(state.cancels).toEqual([]);
  expect(state.blocked).toEqual([]);
  expect(state.pageErrors).toEqual([]);
}

async function changeStep(page, step, project = "project-one") {
  const index = steps.indexOf(step);
  await nav(page).locator("button").nth(index).click();
  await expect(page).toHaveURL(new RegExp(`${path(project, step)}$`));
  await expect(nav(page).locator('button[aria-current="step"]')).toHaveCount(1);
  await expect(nav(page).locator("button").nth(index)).toHaveAttribute("aria-current", "step");
}

async function expectInViewport(page, locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const size = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
}

async function sharedAppearance(page) {
  return page.evaluate(() => {
    const pick = (element, properties) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(properties.map(property => [property, style[property]]));
    };
    const shell = document.querySelector(".project-workbench");
    const nav = shell.querySelector(".workbench-steps");
    const tabProperties = ["fontSize", "fontWeight", "color", "backgroundColor", "borderRadius", "minHeight", "padding", "gap"];
    return {
      topbar: pick(document.querySelector(".workspace-topbar"), ["height", "backgroundColor", "borderBottomWidth", "padding", "gridTemplateColumns"]),
      main: pick(document.querySelector(".workspace-main"), ["maxWidth", "paddingTop", "paddingRight", "paddingLeft"]),
      heading: pick(shell.querySelector(".project-heading"), ["display", "position", "gap", "marginBottom", "paddingBottom", "borderBottomWidth"]),
      title: pick(shell.querySelector("h1"), ["fontSize", "fontWeight", "lineHeight", "margin", "color"]),
      steps: pick(nav, ["display", "flexWrap", "gap", "padding", "marginBottom", "borderWidth", "borderRadius", "backgroundColor"]),
      active: pick(nav.querySelector('[aria-current="step"]'), tabProperties),
      inactive: pick(nav.querySelector('button:not([aria-current="step"])'), tabProperties),
      numbers: [...nav.querySelectorAll("button > span")].map(span => pick(span, ["display", "fontSize"])),
    };
  });
}

for (const { width, locale, theme } of [
  { width: 390, locale: "ko", theme: "light" },
  { width: 390, locale: "en", theme: "dark" },
  { width: 1440, locale: "ko", theme: "dark" },
  { width: 1440, locale: "en", theme: "light" },
]) {
  test(`${width}px ${locale}/${theme}: all four project steps retain the same visible shell`, async ({ page }) => {
    const state = await shellFixture(page, { locale, theme });
    await page.setViewportSize({ width, height: width < 820 ? 844 : 900 });
    await page.goto(path("project-one", "intake"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(heading(page).locator("h1")).toHaveText(title);
    let reference;
    for (const [index, step] of steps.entries()) {
      if (index) await changeStep(page, step);
      await expect(heading(page).locator("h1")).toBeInViewport();
      await expect(heading(page).locator(".project-status")).toHaveText(labels[locale].status);
      await expect(heading(page).locator(".project-client")).toHaveText(clientLabel);
      await expect(heading(page).getByRole("button", { name: labels[locale].edit, exact: true })).toBeVisible();
      await expect(heading(page).getByRole("button", { name: labels[locale].remove, exact: true })).toBeVisible();
      await expect(nav(page).locator("button > span")).toHaveText(["01", "02", "03", "04"]);
      for (const [number, label] of labels[locale].steps.entries()) {
        const button = nav(page).locator("button").nth(number);
        await expect(button).toHaveAccessibleName(new RegExp(`^0${number + 1}\\s*${label}$`));
        await expect(button.locator("span")).toBeVisible();
      }
      if (step === "agent") {
        await expect(page.locator(".agent-chat-empty strong")).toBeInViewport();
        await expect.poll(() => page.getByRole("log").evaluate(node => node.scrollTop)).toBe(0);
      }
      const appearance = await sharedAppearance(page);
      if (reference) expect(appearance).toEqual(reference);
      else reference = appearance;
      const boxes = await nav(page).locator("button").evaluateAll(buttons => buttons.map(button => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { x, y, width, height };
      }));
      expect(boxes[1].y).toBeCloseTo(boxes[0].y, 1);
      if (width < 480) {
        expect(boxes[2].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height);
        expect(boxes[3].y).toBeCloseTo(boxes[2].y, 1);
        expect(boxes[2].x).toBeCloseTo(boxes[0].x, 1);
      } else {
        expect(boxes[2].y).toBeCloseTo(boxes[0].y, 1);
        expect(boxes[3].y).toBeCloseTo(boxes[0].y, 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `outputs/ui-ux/project-shell-${width}-${locale}-${theme}-${step}.png`, fullPage: false, animations: "disabled" });
    }
    expectNoChanges(state);
  });
}

for (const actions of [[], ["project.write"], ["project.delete"]]) {
  test(`project heading respects ${actions.join("/") || "read-only"} permissions on every step`, async ({ page }) => {
    const state = await shellFixture(page, { actions });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path("project-one", "intake"));
    for (const [index, step] of steps.entries()) {
      if (index) await changeStep(page, step);
      await expect(heading(page).locator("h1")).toHaveText(title);
      await expect(heading(page).locator(".project-client")).toHaveText(clientLabel);
      await expect(heading(page).getByRole("button", { name: labels.ko.edit, exact: true })).toHaveCount(actions.includes("project.write") ? 1 : 0);
      await expect(heading(page).getByRole("button", { name: labels.ko.remove, exact: true })).toHaveCount(actions.includes("project.delete") ? 1 : 0);
    }
    expectNoChanges(state);
  });
}

test("short screens and long titles keep the full heading and compact composer reachable", async ({ page, context }) => {
  const state = await shellFixture(page);
  state.projects[0].title = "LongUnbrokenProjectName".repeat(12);
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto(path());
  await expect(heading(page).locator("h1")).toHaveText(state.projects[0].title);
  const draft = "Preserved English 원문\n".repeat(15);
  await input(page).fill(draft);
  await context.setOffline(true);
  await expect(page.locator(".agent-chat-state")).toHaveText("오프라인");
  const main = page.locator(".workspace-main");
  for (const size of [{ width: 390, height: 420 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    expect(await main.evaluate(node => getComputedStyle(node).overflowY)).toBe("auto");
    const controls = [input(page), page.locator(".chat-attachment-trigger"), page.getByRole("button", { name: "AI 설정 열기", exact: true }), page.locator(".chat-model-trigger"), page.locator('.agent-chat-composer button[type="submit"]')];
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      await expectInViewport(page, control);
    }
    expect(await main.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeDisabled();
    await expect(input(page)).toHaveValue(draft);
    await main.evaluate(node => node.scrollTo({ top: 0, behavior: "instant" }));
    await expect(heading(page).locator(".project-status")).toBeInViewport();
    const text = await heading(page).locator("h1").evaluate(node => ({
      height: node.clientHeight, scrollHeight: node.scrollHeight,
      clipped: getComputedStyle(node).clipPath,
    }));
    expect(text.height).toBeGreaterThan(1);
    expect(text.scrollHeight).toBeLessThanOrEqual(text.height + 1);
    expect(text.clipped).toBe("none");
    await nav(page).scrollIntoViewIfNeeded();
    await expectInViewport(page, nav(page));
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await context.setOffline(false);
  expectNoChanges(state);
});

test("step navigation and project Back/Forward reset the shell without losing scoped drafts", async ({ page }) => {
  const state = await shellFixture(page);
  state.projects.push({ ...state.projects[0], id: "project-two", title: "Second synthetic project" });
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto(path());
  await input(page).fill("Project one · exact unsent draft\n원문");
  const main = page.locator(".workspace-main");
  const scrollToComposer = async () => {
    await page.locator('.agent-chat-composer button[type="submit"]').scrollIntoViewIfNeeded();
    expect(await main.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  };
  const expectShellAtTop = async expectedTitle => {
    await expect(heading(page).locator("h1")).toHaveText(expectedTitle);
    await expect.poll(() => main.evaluate(node => node.scrollTop)).toBeLessThanOrEqual(1);
    await expect(heading(page).locator(".project-status")).toBeInViewport();
  };
  await scrollToComposer();
  await changeStep(page, "intake");
  await changeStep(page, "agent");
  await expectShellAtTop(title);
  await expect(input(page)).toHaveValue("Project one · exact unsent draft\n원문");
  await scrollToComposer();
  await page.getByRole("button", { name: "메뉴 펼치기", exact: true }).click();
  await page.getByRole("dialog", { name: "작업 공간 탐색", exact: true }).getByTitle("Second synthetic project", { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${path("project-two")}$`));
  await expectShellAtTop("Second synthetic project");
  await expect(input(page)).toHaveValue("");
  await input(page).fill("Project two stays separate");
  await scrollToComposer();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${path()}$`));
  await expectShellAtTop(title);
  await expect(input(page)).toHaveValue("Project one · exact unsent draft\n원문");
  await scrollToComposer();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${path("project-two")}$`));
  await expectShellAtTop("Second synthetic project");
  await expect(input(page)).toHaveValue("Project two stays separate");
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${path("project-one", "intake")}$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`${path()}$`));
  await expectShellAtTop(title);
  await expect(input(page)).toHaveValue("Project one · exact unsent draft\n원문");
  expectNoChanges(state);
});

test("AI-step project edit/delete dismissal preserves data and the minimal composer", async ({ page }) => {
  const state = await shellFixture(page);
  const original = structuredClone(state.projects[0]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path());
  await input(page).fill("Keep the original chat draft");
  const edit = heading(page).getByRole("button", { name: labels.ko.edit, exact: true });
  for (const close of ["닫기", "취소"]) {
    await edit.click();
    const dialog = page.locator(".project-edit-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "프로젝트 이름", exact: true }).fill("Discard this synthetic edit");
    await dialog.getByRole("button", { name: close, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(edit).toBeFocused();
    await expect(heading(page).locator("h1")).toHaveText(title);
  }
  const remove = heading(page).getByRole("button", { name: labels.ko.remove, exact: true });
  for (const close of ["삭제 창 닫기", "취소"]) {
    await remove.click();
    const dialog = page.getByRole("alertdialog", { name: "정말 삭제하시겠어요?", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "영구 삭제", exact: true })).toBeDisabled();
    await dialog.getByPlaceholder("프로젝트명 입력", { exact: true }).fill(title);
    await expect(dialog.getByRole("button", { name: "영구 삭제", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: close, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(remove).toBeFocused();
  }
  const composer = page.locator(".agent-chat-composer");
  await composer.scrollIntoViewIfNeeded();
  await expect(composer.locator(".skill-selector")).toHaveCount(0);
  const clip = composer.getByRole("button", { name: "파일 첨부", exact: true });
  const gear = composer.getByRole("button", { name: "AI 설정 열기", exact: true });
  const model = composer.locator(".chat-model-trigger");
  await expect(clip).toHaveText("");
  await expect(gear).toHaveText("");
  expect((await composer.boundingBox()).height).toBeLessThan(150);
  for (const control of [clip, gear, model, composer.locator('button[type="submit"]')]) await expectInViewport(page, control);
  await model.press("ArrowDown");
  const menu = page.getByRole("dialog", { name: "AI 모델 선택", exact: true });
  await expect(menu.getByLabel("AI 연결", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(model).toBeFocused();
  await gear.click();
  const settings = page.getByRole("dialog", { name: "AI 설정", exact: true });
  await expect(settings.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(gear).toBeFocused();
  await expect(input(page)).toHaveValue("Keep the original chat draft");
  expect(state.projects[0]).toEqual(original);
  expectNoChanges(state);
});
