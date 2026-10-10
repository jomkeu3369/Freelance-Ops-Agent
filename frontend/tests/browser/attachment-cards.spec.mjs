import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

const route = "/workspace/projects/project-one/agent";
const file = (name, text = "Synthetic attachment contents") => ({
  name,
  mimeType: name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".csv") ? "text/csv" : "text/plain",
  buffer: Buffer.from(name.endsWith(".pdf") ? "%PDF-1.4\n% Synthetic fixture only; extraction is intercepted.\n%%EOF" : text),
});
const tiles = page => page.locator(".chat-attachment-tiles");
const trigger = (page, name) => tiles(page).getByRole("button", { name: `${name} 상세 보기`, exact: true });
const panel = page => page.getByRole("region", { name: "첨부파일 상세", exact: true });
const closeDetails = page => panel(page).getByRole("button", { name: "첨부파일 상세 닫기", exact: true });

// All uploads, extracted contents and AI requests stay inside the route fixture.
// The shared fixture rejects nonlocal network requests before navigation.
async function setup(page, configure = () => {}) {
  const state = await fixture(page);
  Object.assign(state, { uploads: [], completedUploads: [], removals: [], extractions: {}, failures: new Set(), uploadBarrier: null });
  state.projects[0].title = "Synthetic attachment review";
  configure(state);
  await page.route("**/projects/*/attachments**", async intercepted => {
    const request = intercepted.request();
    if (request.method() === "DELETE") {
      state.removals.push(request.url());
      return intercepted.fulfill({ status: 204 });
    }
    if (request.method() !== "POST") return intercepted.fulfill({ status: 405 });
    const fields = await new Response(request.postDataBuffer(), {
      headers: { "Content-Type": request.headers()["content-type"] },
    }).formData();
    const original = fields.get("file");
    const upload = {
      name: original.name, mimeType: original.type, bytes: Buffer.from(await original.arrayBuffer()),
      encoding: fields.get("encoding"), delimiter: fields.get("delimiter"),
      ocrLanguage: fields.get("ocrLanguage"), ocrLayout: fields.get("ocrLayout"),
    };
    const index = state.uploads.push(upload);
    const barrier = state.uploadBarrier;
    state.uploadBarrier = null;
    if (barrier) await barrier.wait();
    try {
      if (state.failures.has(original.name)) return await intercepted.fulfill({
        status: 422, contentType: "application/json", body: JSON.stringify({ detail: "Synthetic file reading failed" }),
      });
      return await intercepted.fulfill({
        status: 201, contentType: "application/json", body: JSON.stringify({
          id: `card-attachment-${index}`, expiresAt: "2099-01-01T00:00:00Z",
          extraction: {
            name: original.name, mediaType: original.type, size: original.size, sha256: "0".repeat(64),
            status: "COMPLETE", text: `Extracted synthetic contents: ${original.name}`, notice: "",
            encoding: fields.get("encoding"), delimiter: fields.get("delimiter"), units: 1,
            ...state.extractions[original.name],
          },
        }),
      });
    } finally { state.completedUploads.push(index); }
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(route);
  return state;
}

async function expectComposerInViewport(page) {
  const viewport = page.viewportSize();
  for (const locator of [page.locator("#agent-chat-input"), page.locator('.agent-chat-composer button[type="submit"]')]) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
}

for (const [width, height, screenshot] of [[320, 568, null], [390, 844, "mobile"], [1440, 900, "desktop"]]) {
  test(`${width}×${height}: six compact cards contain long filenames without exposing details or overflowing the composer`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const state = await setup(page);
    const names = ["brief.pdf", `${"Synthetic-long-filename-".repeat(7)}.pdf`, "notes.txt", "costs.csv", "review.pdf", "reference.txt"];
    await page.getByLabel("첨부파일 선택").setInputFiles(names.map(name => file(name)));
    await page.locator("#agent-chat-input").fill("첨부한 자료를 참고해 주세요.");
    await expect(tiles(page).locator("li")).toHaveCount(6);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator(".chat-attachments").getByRole("combobox")).toHaveCount(0);
    await expect(page.locator(".chat-attachments").getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByText(/파일 읽고 확인 시 원본을 서버로 보내 무료로 읽습니다/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "로컬 TXT 확인", exact: true })).toHaveCount(0);
    for (const name of names) {
      const card = trigger(page, name);
      await expect(card).toBeEnabled();
      await expect(card).toHaveAccessibleDescription(/아직 읽지 않음/);
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThanOrEqual(64);
      expect(box.width).toBeLessThanOrEqual(128);
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(2);
      await expect(tiles(page).getByRole("button", { name: `${name} 제거`, exact: true })).toBeEnabled();
      expect(await card.locator("button").count()).toBe(0);
    }
    const longName = trigger(page, names[1]).locator(".attachment-file-name");
    await expect(longName).toHaveText(names[1]);
    expect(await longName.evaluate(element => {
      const style = getComputedStyle(element);
      return style.textOverflow === "ellipsis" && style.overflow === "hidden" && element.scrollWidth > element.clientWidth;
    })).toBe(true);
    await expectComposerInViewport(page);
    // Any overflow must stay inside the attachment strip, including the final file.
    await trigger(page, names.at(-1)).scrollIntoViewIfNeeded();
    await expect(trigger(page, names.at(-1))).toBeInViewport();
    await expectComposerInViewport(page);
    await trigger(page, names[0]).scrollIntoViewIfNeeded();
    if (screenshot) await page.screenshot({ path: `outputs/ui-ux/attachment-cards-${screenshot}.png`, fullPage: false, animations: "disabled" });
    expect(state.uploads).toEqual([]);
    expect(state.starts).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.blocked).toEqual([]);
  });
}

test("Enter and Space open nonmodal file details; Escape and Close restore the exact trigger", async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles(file("keyboard.pdf"));
  const card = trigger(page, "keyboard.pdf");
  for (const key of ["Enter", "Space"]) {
    await card.focus();
    await card.press(key);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText("파일 읽고 확인 시 원본을 서버로 보내 무료로 읽습니다.");
    await expect(panel(page)).toContainText("확인 후 보내기를 눌러야 AI가 실행됩니다.");
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page)).not.toHaveAttribute("aria-modal", "true");
    await expect(panel(page).getByLabel("문자 인식 언어")).toHaveValue("mixed");
    await expect(panel(page).getByLabel("문서 형태")).toHaveValue("general");
    await page.locator("#agent-chat-input").focus();
    await expect(page.locator("#agent-chat-input")).toBeFocused();
    await closeDetails(page).focus();
    if (key === "Enter") await page.keyboard.press("Escape");
    else await closeDetails(page).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(card).toBeFocused();
    await expect(card).toHaveAttribute("aria-expanded", "false");
  }
  expect(state.uploads).toEqual([]);
  expect(state.starts).toEqual([]);
  expect(state.blocked).toEqual([]);
});

test("reading opens review details automatically and still requires explicit confirmation and Send", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles(file("review.pdf"));
  await page.screenshot({ path: "outputs/ui-ux/attachment-card-single-mobile.png", fullPage: false, animations: "disabled" });
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  const confirmation = panel(page).getByRole("checkbox");
  await expect(confirmation).not.toBeChecked();
  const send = page.getByRole("button", { name: "보내기", exact: true });
  await expect(send).toBeDisabled();
  await panel(page).getByText("읽기 결과 확인", { exact: true }).click();
  await expect(panel(page).locator("pre")).toHaveText("Extracted synthetic contents: review.pdf");
  await expectComposerInViewport(page);
  const extras = page.locator(".agent-chat-extras");
  await expect(panel(page)).toHaveCSS("overflow-y", "visible");
  const expectCloseInReviewViewport = async () => {
    const viewport = await extras.boundingBox();
    const close = await closeDetails(page).boundingBox();
    expect(close.y).toBeGreaterThanOrEqual(viewport.y - 1);
    expect(close.y + close.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
  };
  await expectCloseInReviewViewport();
  await page.screenshot({ path: "outputs/ui-ux/attachment-cards-detail.png", fullPage: false, animations: "disabled" });
  await extras.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(panel(page).getByRole("checkbox")).toBeInViewport();
  await expectCloseInReviewViewport();
  await page.screenshot({ path: "outputs/ui-ux/attachment-cards-detail-scrolled.png", fullPage: false, animations: "disabled" });
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0].mimeType).toBe("application/pdf");
  expect(state.starts).toEqual([]);
  await closeDetails(page).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(trigger(page, "review.pdf")).toBeFocused();
  await expect(send).toBeDisabled();
  await page.locator("#agent-chat-input").press("Control+Enter");
  expect(state.starts).toEqual([]);
  await trigger(page, "review.pdf").click();
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  await expect(send).toBeEnabled();
  expect(state.starts).toEqual([]);
  await send.click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].attachmentIds).toEqual(["card-attachment-1"]);
  expect(state.uploads).toHaveLength(1);
  await expect(tiles(page)).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  expect(state.blocked).toEqual([]);
});

test("partial read remains visibly marked on a collapsed card and coverage stays available in details", async ({ page }) => {
  const state = await setup(page, state => {
    state.extractions["partial.pdf"] = {
      status: "PARTIAL", units: 2,
      coverage: [
        { index: 1, kind: "PAGE", nativeStatus: "TEXT", rasterStatus: "NONE", ocrAttempted: false, ocrCompleted: false, ocrStatus: "SKIPPED", reason: "TEXT_ONLY" },
        { index: 2, kind: "PAGE", nativeStatus: "EMPTY", rasterStatus: "LARGE", ocrAttempted: true, ocrCompleted: false, ocrStatus: "FAILED", reason: "BUDGET_EXHAUSTED" },
      ],
    };
  });
  await page.getByLabel("첨부파일 선택").setInputFiles(file("partial.pdf"));
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(panel(page).getByRole("checkbox")).not.toBeChecked();
  await panel(page).getByText("읽기 결과 확인", { exact: true }).click();
  const secondPage = panel(page).getByRole("row").filter({ hasText: "페이지 2" });
  await expect(secondPage).toContainText("시도함");
  await expect(secondPage).toContainText("미완료");
  await expect(secondPage).toContainText("OCR 시간 한도");
  await closeDetails(page).click();
  await expect(tiles(page).getByText("일부 읽음", { exact: true })).toBeVisible();
  await expect(trigger(page, "partial.pdf")).toHaveAccessibleDescription(/일부 읽음/);
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  expect(state.starts).toEqual([]);
  expect(state.blocked).toEqual([]);
});

test("failed reading stays visibly marked and retry never starts an AI request", async ({ page }) => {
  const state = await setup(page, state => state.failures.add("failed.pdf"));
  await page.getByLabel("첨부파일 선택").setInputFiles(file("failed.pdf"));
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic file reading failed" })).toBeVisible();
  await expect(panel(page)).toBeVisible();
  await closeDetails(page).click();
  await expect(tiles(page).getByText("읽기 실패", { exact: true })).toBeVisible();
  await expect(trigger(page, "failed.pdf")).toHaveAccessibleDescription(/읽기 실패/);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  state.failures.clear();
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(panel(page).getByRole("checkbox")).not.toBeChecked();
  await expect(tiles(page).getByText("읽기 실패", { exact: true })).toHaveCount(0);
  expect(state.uploads).toHaveLength(2);
  expect(state.starts).toEqual([]);
  expect(state.blocked).toEqual([]);
});

test("removing one of several local cards and reselecting the same file is local and preserves the draft", async ({ page }) => {
  const state = await setup(page);
  const selected = [file("first.pdf"), file("repeat.txt", "Synthetic repeat contents"), file("last.csv", "name,amount\nSample,1")];
  await page.locator("#agent-chat-input").fill("Keep this unsent draft exactly");
  await page.getByLabel("첨부파일 선택").setInputFiles(selected);
  await trigger(page, "repeat.txt").click();
  await panel(page).locator("article").filter({ has: page.getByText("repeat.txt", { exact: true }) })
    .getByRole("button", { name: "로컬 TXT 확인", exact: true }).click();
  await expect(panel(page).locator("pre")).toHaveText("Synthetic repeat contents");
  await tiles(page).getByRole("button", { name: "repeat.txt 제거", exact: true }).click();
  await expect(trigger(page, "repeat.txt")).toHaveCount(0);
  await expect(page.locator(".chat-attachments pre")).toHaveCount(0);
  await expect(tiles(page).locator("li")).toHaveCount(2);
  await page.getByLabel("첨부파일 선택").setInputFiles(selected[1]);
  await expect(trigger(page, "repeat.txt")).toHaveCount(1);
  await expect(tiles(page).locator("li")).toHaveCount(3);
  await expect(page.locator(".chat-attachments pre")).toHaveCount(0);
  await expect(page.locator("#agent-chat-input")).toHaveValue("Keep this unsent draft exactly");
  expect(state.uploads).toEqual([]);
  expect(state.removals).toEqual([]);
  expect(state.starts).toEqual([]);
  expect(state.blocked).toEqual([]);
});

test("closing details during reading leaves Cancel accessible and a cancelled late response cannot reopen review", async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles(file("cancel.pdf"));
  await trigger(page, "cancel.pdf").click();
  const barrier = state.uploadBarrier = requestBarrier();
  try {
    await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
    await barrier.entered;
    await expect(panel(page).getByLabel("문자 인식 언어")).toBeDisabled();
    await expect(panel(page).getByLabel("문서 형태")).toBeDisabled();
    await closeDetails(page).click();
    await expect(panel(page)).toHaveCount(0);
    const cancel = page.getByRole("button", { name: "파일 읽기 취소", exact: true });
    await expect(cancel).toBeVisible();
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(page.getByRole("alert").filter({ hasText: "파일 읽기를 취소" })).toBeVisible();
    barrier.release();
    await expect.poll(() => state.completedUploads.length).toBe(1);
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(trigger(page, "cancel.pdf")).toBeEnabled();
    await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
    await expect(panel(page).getByRole("checkbox")).not.toBeChecked();
    expect(state.uploads).toHaveLength(2);
    expect(state.starts).toEqual([]);
    expect(state.blocked).toEqual([]);
  } finally { barrier.release(); }
});

test("closing and reopening details cannot restore a stale local text preview", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const original = File.prototype.text;
    window.cardPreviewReads = [];
    File.prototype.text = function () {
      if (this.name !== "delayed.txt") return original.call(this);
      return new Promise(resolve => window.cardPreviewReads.push(resolve));
    };
  });
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles(file("delayed.txt"));
  await trigger(page, "delayed.txt").click();
  await panel(page).getByRole("button", { name: "로컬 TXT 확인", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.cardPreviewReads.length)).toBe(1);
  await closeDetails(page).click();
  await expect(panel(page)).toHaveCount(0);
  await trigger(page, "delayed.txt").click();
  await expect(panel(page).locator("pre")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "로컬 TXT 확인", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.cardPreviewReads.length)).toBe(2);
  await page.evaluate(() => window.cardPreviewReads[1]("Newest synthetic preview"));
  await expect(panel(page).locator("pre")).toHaveText("Newest synthetic preview");
  await closeDetails(page).click();
  await page.evaluate(async () => {
    window.cardPreviewReads[0]("Stale private draft must stay dismissed");
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByText("Stale private draft must stay dismissed", { exact: true })).toHaveCount(0);
  await expect(trigger(page, "delayed.txt")).toBeFocused();
  expect(errors).toEqual([]);
  expect(state.uploads).toEqual([]);
  expect(state.starts).toEqual([]);
  expect(state.blocked).toEqual([]);
});


test("keyboard removal focuses an adjacent card and returns to the composer after the last file", async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles([file("first.pdf"), file("second.pdf"), file("last.pdf")]);
  await trigger(page, "second.pdf").click();
  const remove = name => tiles(page).getByRole("button", { name: `${name} 제거`, exact: true });
  await remove("second.pdf").focus();
  await remove("second.pdf").press("Enter");
  await expect(trigger(page, "last.pdf")).toBeFocused();
  await remove("last.pdf").focus();
  await remove("last.pdf").press("Space");
  await expect(trigger(page, "first.pdf")).toBeFocused();
  await remove("first.pdf").focus();
  await remove("first.pdf").press("Enter");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator("#agent-chat-input")).toBeFocused();
  expect(state.uploads).toEqual([]);
  expect(state.starts).toEqual([]);
  expect(state.blocked).toEqual([]);
});
