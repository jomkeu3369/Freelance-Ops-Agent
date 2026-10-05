import { test, expect } from "@playwright/test";
import { fixture } from "./helpers/chat-fixture.mjs";

const path = "/workspace/projects/project-one/agent";
const markdown = [
  "## 프로젝트 요약 · Project summary", "", "**검토 완료** and *ready to review*. Keep `source_text` readable.", "",
  "- 첫 번째 범위", "- Second scope", "", "1. Plan", "2. Build", "", "> 확인 후 진행 · Review before proceeding", "",
  "| 항목 | 상태 | 담당 | 기준 | 메모 | 일정 | 확인 |", "| --- | --- | --- | --- | --- | --- | --- |", "| Website | 준비됨 | Design | WCAG | Review | October | 승인 대기 |", "",
  "```ts", "const greeting = '안녕하세요';", `const longLine = '${"word".repeat(80)}';`, "```", "",
  "[Documentation](https://example.com/docs)", "", "LongWord".repeat(55)
].join("\n");
function seed(state, summary = markdown) {
  state.run = { runId: "run-one", status: "COMPLETED", activeDepartment: null, interruption: null, result: { projectSummary: summary, openQuestions: [], departmentResults: [], quotationDraft: null, quotationDrafts: [] }, errorCode: null, metadata: null, usage: null, updatedAt: "2026-10-01T00:01:00Z" };
  state.history = [{ runId: "run-one", requirementText: "**Please review** · 검토해 주세요\n\n- Website\n- 모바일", status: "COMPLETED", createdAt: state.run.updatedAt }];
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  for (const element of await page.locator(".agent-chat-message, .chat-markdown").all()) {
    expect(await element.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
}

for (const width of [320, 390, 1440]) for (const [locale, theme] of [["ko", "light"], ["en", "dark"]]) {
  test(`${width}px ${locale}/${theme}: Markdown is readable, contained and keyboard scrollable`, async ({ page }) => {
    const state = await fixture(page);
    seed(state);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ locale, theme }) => { localStorage.setItem("freelance-ops-ui-locale-v1", locale); localStorage.setItem("theme", theme); }, { locale, theme });
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.goto(path);
    const body = page.locator(".agent-chat-result > .chat-markdown");
    await expect(body.locator("h2")).toHaveText("프로젝트 요약 · Project summary");
    await expect(page.locator(".agent-chat-message.user strong")).toHaveText("Please review");
    await expect(body.locator("table")).toBeVisible();
    await expect(body.locator("pre code")).toContainText("안녕하세요");
    await expect(body.getByRole("button", { name: locale === "ko" ? "코드 복사" : "Copy code" })).toBeVisible();
    await expect(body.locator("a")).toHaveAttribute("rel", "noopener noreferrer");
    await expect(body.locator("a")).toHaveAttribute("target", "_blank");
    await noOverflow(page);
    const pre = body.locator("pre");
    await pre.focus();
    await expect(pre).toBeFocused();
    await pre.press("ArrowRight");
    await expect.poll(() => pre.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    const table = body.locator(".chat-markdown-table");
    if (width < 500) {
      await table.focus();
      await table.press("ArrowRight");
      await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
    // Capture real application rendering, with the message top visible.
    await page.getByRole("log").evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `outputs/ui-ux/chat-markdown-${width}-${locale}-${theme}.png` });
    expect(errors).toEqual([]);
    expect(state.starts).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.blocked).toEqual([]);
  });
}

test("malicious content is inert, remote images are not fetched, and code copies exactly", async ({ page }) => {
  const state = await fixture(page);
  const code = "<img src=x onerror=alert(1)>\n  const safe = true;\n";
  seed(state, '<script>window.markdownPwned = true</script>\n\n<img src="https://evil.invalid/a" onerror="window.markdownPwned=true">\n\n[bad](javascript:alert%281%29) [data](data:text/html;base64,PHNjcmlwdD4=)\n\n![preview](https://evil.invalid/tracker)\n\n```html\n' + code + '```');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async text => { window.copiedMarkdown = text; } }, configurable: true });
  });
  await page.goto(path);
  const body = page.locator(".agent-chat-result > .chat-markdown");
  await expect(body.locator("pre")).toBeVisible();
  await expect(body.locator("script, img, iframe, svg, a")).toHaveCount(0);
  await expect(body).toContainText("preview");
  await body.getByRole("button", { name: "코드 복사" }).click();
  expect(await page.evaluate(() => window.copiedMarkdown)).toBe(code);
  await expect(body.getByRole("button", { name: "복사됨" })).toBeVisible();
  expect(await page.evaluate(() => window.markdownPwned)).toBeUndefined();
  expect(state.blocked).toEqual([]);
  expect(state.writes).toEqual([]);
});

test("denied clipboard access gives a localized manual-copy fallback", async ({ page }) => {
  const state = await fixture(page);
  seed(state, "```\nselect this code\n```");
  await page.addInitScript(() => {
    localStorage.setItem("freelance-ops-ui-locale-v1", "en");
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } }, configurable: true });
  });
  await page.goto(path);
  const body = page.locator(".agent-chat-result > .chat-markdown");
  await body.getByRole("button", { name: "Copy code" }).click();
  await expect(body.getByRole("status")).toHaveText("Could not copy. Select the code and copy it manually.");
  await expect(body.locator("pre code")).toHaveText("select this code\n");
});

test("partial result updates keep an unfinished code fence escaped and preserve the draft", async ({ page }) => {
  const state = await fixture(page);
  seed(state, "## 진행 중\n\n```html\n<img");
  state.run.status = "RUNNING";
  state.history[0].status = "RUNNING";
  await page.goto(path);
  const body = page.locator(".agent-chat-result > .chat-markdown");
  await expect(body.locator("pre code")).toContainText("<img");
  await page.locator("#agent-chat-input").fill("Keep my next draft · 한글");
  state.run.result.projectSummary = "## 진행 중\n\n```html\n<img src=x onerror=alert(1)>";
  await expect(body.locator("pre code")).toContainText("onerror=alert(1)");
  await expect(body.locator("img")).toHaveCount(0);
  state.run.result.projectSummary += "\n```\n\n**완료**";
  state.run.status = "COMPLETED";
  await expect(body.locator("strong")).toHaveText("완료");
  await expect(page.locator("#agent-chat-input")).toHaveValue("Keep my next draft · 한글");
  await noOverflow(page);
  expect(state.starts).toEqual([]);
  expect(state.writes).toEqual([]);
});
