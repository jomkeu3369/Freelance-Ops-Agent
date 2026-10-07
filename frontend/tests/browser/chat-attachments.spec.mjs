import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

test("OCR options invalidate reviewed extraction and coverage separates attempt from completion", async ({ page }) => {
  const state = await setup(page, state => {
    state.coverage = [
      {index: 1, kind: "PAGE", nativeStatus: "TEXT", rasterStatus: "LARGE", ocrAttempted: true, ocrCompleted: true, ocrStatus: "READ", reason: "TEXT_FOUND"},
      {index: 2, kind: "PAGE", nativeStatus: "EMPTY", rasterStatus: "NONE", ocrAttempted: true, ocrCompleted: false, ocrStatus: "FAILED", reason: "BUDGET_EXHAUSTED"},
      {index: 3, kind: "PAGE", nativeStatus: "EMPTY", rasterStatus: "NONE", ocrAttempted: false, ocrCompleted: false, ocrStatus: "SKIPPED", reason: "SAMPLED_OUT"},
    ];
  });
  await page.getByLabel("첨부파일 선택").setInputFiles(file("scan.pdf", "synthetic scan", "application/pdf"));
  const scan = row(page, "scan.pdf");
  await expect(scan.getByLabel("문자 인식 언어")).toHaveValue("mixed");
  await expect(scan.getByLabel("문서 형태")).toHaveValue("general");
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeVisible();
  expect(state.ocrOptions).toEqual([{language: "mixed", layout: "general"}]);
  await scan.getByText("읽기 결과 확인", {exact: true}).click();
  const coverage = scan.getByRole("table");
  await expect(coverage).toContainText("페이지 1");
  await expect(coverage.getByRole("row").filter({hasText: "페이지 2"})).toContainText("시도함");
  await expect(coverage.getByRole("row").filter({hasText: "페이지 2"})).toContainText("미완료");
  await expect(coverage.getByRole("row").filter({hasText: "페이지 3"})).toContainText("시도 안 함");
  await page.getByRole("checkbox").check();
  await scan.getByLabel("문자 인식 언어").selectOption("ko");
  await scan.getByLabel("문서 형태").selectOption("singleblock");
  await expect(scan).toContainText("아직 읽지 않음");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect.poll(() => state.removals.length).toBe(1);
  expect(state.starts).toHaveLength(0);
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect(state.ocrOptions[1]).toEqual({language: "ko", layout: "singleblock"});
  expect(state.starts).toHaveLength(0);
  await page.screenshot({path: "outputs/ui-ux/ocr-coverage-preview.png", fullPage: true});
});

test("OCR selection stays disabled during reading and cancellation cannot restore its late preview", async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles(file("image.png", "synthetic image", "image/png"));
  const image = row(page, "image.png");
  await image.getByLabel("문자 인식 언어").selectOption("en");
  const barrier = state.uploadBarrier = requestBarrier();
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await barrier.entered;
  await expect(image.getByLabel("문자 인식 언어")).toBeDisabled();
  await expect(image.getByLabel("문서 형태")).toBeDisabled();
  await page.getByRole("button", {name: "파일 읽기 취소"}).click();
  await expect(page.getByRole("alert").filter({hasText: "취소"})).toBeVisible();
  barrier.release();
  await image.getByLabel("문자 인식 언어").selectOption("ko");
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect(state.ocrOptions).toEqual([{language: "en", layout: "general"}, {language: "ko", layout: "general"}]);
  expect(state.starts).toHaveLength(0);
});

async function setup(page, configure = () => {}) {
  const state = await fixture(page);
  state.uploads = []; state.uploadFields = []; state.ocrOptions = []; state.removals = []; state.attachmentFailure = false;
  configure(state);
  await page.route("**/projects/*/attachments**", async route => {
    if (route.request().method() === "DELETE") { state.removals.push(route.request().url()); return route.fulfill({status: 204}); }
    const body = route.request().postDataBuffer();
    const index = state.uploads.push(body);
    const fields = await new Response(body, { headers: { "Content-Type": route.request().headers()["content-type"] } }).formData();
    const file = fields.get("file");
    state.uploadFields.push({ name: file.name, encoding: fields.get("encoding"), delimiter: fields.get("delimiter"), bytes: Buffer.from(await file.arrayBuffer()) });
    state.ocrOptions.push({language: fields.get("ocrLanguage"), layout: fields.get("ocrLayout")});
    const barrier = state.uploadBarrier;
    state.uploadBarrier = null;
    if (barrier) await barrier.wait();
    if (state.attachmentFailure) return route.fulfill({status: 422, contentType: "application/json", body: JSON.stringify({detail: "Invalid attachment"})});
    return route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({id: index === 1 ? "attachment-one" : `attachment-${index}`, expiresAt: "2099-01-01T00:00:00Z", extraction: {name: file.name, mediaType: file.type, size: file.size, sha256: "0".repeat(64), status: state.coverage ? "PARTIAL" : "COMPLETE", text: state.extractionText ?? "Extracted synthetic contents", notice: "", encoding: fields.get("encoding"), delimiter: fields.get("delimiter"), units: state.coverage?.length ?? 1, ...(state.coverage ? {coverage: state.coverage} : {})}})});
  });
  await page.goto("/workspace/projects/project-one/agent");
  return state;
}
async function paste(page, text, composing = false) {
  return page.locator("#agent-chat-input").evaluate((field, {text, composing}) => {
    if (composing) field.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    const data = new DataTransfer(); data.setData("text/plain", text);
    const event = new ClipboardEvent("paste", {bubbles: true, cancelable: true, clipboardData: data});
    field.dispatchEvent(event);
    if (composing) field.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
    // Synthetic paste does not insert native text. Assert interception separately
    // rather than treating an unchanged textarea as evidence of native pasting.
    return event.defaultPrevented;
  }, {text, composing});
}
test("large paste is local, lossless and reviewed before sending; ambiguous retry retains attachment IDs", async ({page}) => {
  const state = await setup(page);
  const text = "  고객\r\n😀" + "x".repeat(9000) + " \n";
  await page.locator("#agent-chat-input").fill("Summarize these notes");
  await paste(page, text);
  await expect(page.getByText("pasted-text.txt", {exact: true})).toBeVisible();
  await expect(page.locator("#agent-chat-input")).toHaveValue("Summarize these notes");
  expect(state.uploads).toHaveLength(0);
  await page.getByRole("button", {name: "로컬 TXT 확인"}).click();
  await expect(page.locator(".chat-attachments pre")).toHaveText(text);
  await page.getByRole("button", {name: "파일 읽고 확인", exact: true}).click();
  await expect(page.getByRole("checkbox")).toBeVisible();
  expect(state.starts).toHaveLength(0);
  expect(state.uploads[0].includes(Buffer.from(text))).toBe(true);
  await page.getByRole("checkbox").check();
  state.startFailures = 1;
  await page.getByRole("button", {name: "보내기", exact: true}).click();
  await expect(page.getByRole("alert").filter({hasText: "입력은 보존"})).toBeVisible();
  await expect(page.getByText("pasted-text.txt", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "보내기", exact: true}).click();
  await expect.poll(() => state.starts.length).toBe(2);
  expect(state.starts[0].attachmentIds).toEqual(["attachment-one"]);
  expect(state.starts[1]).toEqual(state.starts[0]);
  expect(state.uploads).toHaveLength(1);
});
test("IME paste does not intercept; removing local attachment never uploads", async ({page}) => {
  const state = await setup(page);
  expect(await paste(page, "x".repeat(9000), true)).toBe(false);
  await expect(page.getByText("pasted-text.txt", {exact: true})).toHaveCount(0);
  await paste(page, "x".repeat(9000));
  await page.getByRole("button", {name: "pasted-text.txt 제거"}).click();
  expect(state.uploads).toHaveLength(0);
  expect(state.removals).toHaveLength(0);
});
test("read failure and cancellation preserve files without starting AI", async ({page}) => {
  const state = await setup(page);
  await paste(page, "x".repeat(9000));
  state.attachmentFailure = true;
  await page.getByRole("button", {name: "파일 읽고 확인", exact: true}).click();
  await expect(page.getByRole("alert").filter({hasText: "Invalid attachment"})).toBeVisible();
  await expect(page.getByText("pasted-text.txt", {exact: true})).toBeVisible();
  state.attachmentFailure = false;
  const barrier = state.uploadBarrier = requestBarrier();
  await page.getByRole("button", {name: "파일 읽고 확인", exact: true}).click();
  await barrier.entered;
  await page.locator("#agent-chat-input").press("Control+Enter");
  expect(state.uploads).toHaveLength(2);
  await page.getByRole("button", {name: "파일 읽기 취소"}).click();
  await expect(page.getByRole("alert").filter({hasText: "취소"})).toBeVisible();
  barrier.release();
  await page.getByRole("button", {name: "파일 읽고 확인", exact: true}).click();
  await expect(page.getByRole("checkbox")).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByRole("button", {name: "보내기", exact: true})).toBeDisabled();
  expect(state.uploads).toHaveLength(3);
  expect(state.uploadFields.every(upload => upload.bytes.equals(Buffer.from("x".repeat(9000))))).toBe(true);
  expect(state.starts).toHaveLength(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", {name: "보내기", exact: true}).click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].attachmentIds).toEqual(["attachment-3"]);
  expect(state.uploads).toHaveLength(3);
});
test("oversize file rejected locally", async ({page}, testInfo) => {
  const state = await setup(page);
  // Use the native picker path; transferring a 2MiB buffer through CDP can
  // consume the test timeout on a constrained CPU before the application runs.
  const path = testInfo.outputPath("big.txt");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.alloc(2097153, "a"));
  await page.getByLabel("첨부파일 선택").setInputFiles(path);
  await expect(page.getByRole("alert").filter({hasText: "2 MiB"})).toBeVisible();
  expect(state.uploads).toHaveLength(0);
});


const file = (name, text) => ({ name, mimeType: name.endsWith(".csv") ? "text/csv" : "text/plain", buffer: Buffer.from(text) });
const row = (page, name) => page.locator(".chat-attachments li").filter({ has: page.getByText(name, { exact: true }) });

test("TXT/CSV selection remains local; changing options invalidates only that reviewed extraction", async ({ page }) => {
  const state = await setup(page);
  const txt = "  Original TXT\r\n😀  ";
  const csv = "name;amount\r\n고객;12\r\n";
  await page.getByLabel("첨부파일 선택").setInputFiles([file("notes.txt", txt), file("costs.csv", csv)]);
  await expect(page.locator(".chat-attachments li")).toHaveCount(2);
  expect(state.uploads).toHaveLength(0);
  const notes = row(page, "notes.txt");
  const costs = row(page, "costs.csv");
  await notes.getByLabel("인코딩").selectOption("utf-16");
  await costs.getByLabel("인코딩").selectOption("cp949");
  await costs.getByLabel("구분자").selectOption(";");
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeVisible();
  expect(state.uploadFields).toEqual([
    { name: "notes.txt", encoding: "utf-16", delimiter: "auto", bytes: Buffer.from(txt) },
    { name: "costs.csv", encoding: "cp949", delimiter: ";", bytes: Buffer.from(csv) },
  ]);
  await page.getByRole("checkbox").check();
  await costs.getByLabel("구분자").selectOption("\t");
  await expect(costs).toContainText("아직 읽지 않음");
  await expect(notes).toContainText("텍스트 추출 완료");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect.poll(() => state.removals.length).toBe(1);
  expect(state.removals[0]).toMatch(/\/attachments\/attachment-2$/);
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect(state.uploadFields[2]).toEqual({ name: "costs.csv", encoding: "cp949", delimiter: "\t", bytes: Buffer.from(csv) });
  expect(state.uploads).toHaveLength(3);
  expect(state.starts).toHaveLength(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].attachmentIds).toEqual(["attachment-one", "attachment-3"]);
  await expect(page.locator(".chat-attachments li")).toHaveCount(0);
});

test("removing previewed originals clears their contents and allows the same file to be selected again", async ({ page }) => {
  const state = await setup(page);
  const original = file("repeat.txt", "Synthetic private draft contents");
  await page.getByLabel("첨부파일 선택").setInputFiles(original);
  await page.getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect(page.locator(".chat-attachments pre")).toHaveText("Synthetic private draft contents");
  await page.getByRole("button", { name: "repeat.txt 제거" }).click();
  await expect(page.locator(".chat-attachments pre")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "미리보기 닫기" })).toHaveCount(0);
  await page.getByLabel("첨부파일 선택").setInputFiles(original);
  await expect(page.locator(".chat-attachments li")).toHaveCount(1);
  await expect(page.locator(".chat-attachments pre")).toHaveCount(0);
  await page.getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect(page.locator(".chat-attachments pre")).toHaveText("Synthetic private draft contents");
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeVisible();
  await page.getByRole("button", { name: "repeat.txt 제거" }).click();
  await expect(page.locator(".chat-attachments pre")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect.poll(() => state.removals.length).toBe(1);
  expect(state.removals[0]).toMatch(/\/attachments\/attachment-one$/);
  expect(state.uploads).toHaveLength(1);
  expect(state.starts).toHaveLength(0);
});

async function delayLocalPreview(page) {
  await page.addInitScript(() => {
    const read = File.prototype.text;
    window.attachmentPreviewReads = [];
    File.prototype.text = function () {
      if (this.name !== "delayed.txt") return read.call(this);
      return new Promise((resolve, reject) => window.attachmentPreviewReads.push({ resolve, reject }));
    };
  });
}

for (const dismissal of ["close", "remove", "newer preview"]) {
  test(`a delayed local preview cannot return after ${dismissal}`, async ({ page }) => {
    await delayLocalPreview(page);
    const state = await setup(page);
    await page.getByLabel("첨부파일 선택").setInputFiles([file("delayed.txt", "Delayed old contents"), file("current.txt", "Current contents")]);
    await row(page, "delayed.txt").getByRole("button", { name: "로컬 TXT 확인" }).click();
    await expect.poll(() => page.evaluate(() => window.attachmentPreviewReads.length)).toBe(1);
    if (dismissal === "close") await page.getByRole("button", { name: "미리보기 닫기" }).click();
    else if (dismissal === "remove") await page.getByRole("button", { name: "delayed.txt 제거" }).click();
    else {
      await row(page, "current.txt").getByRole("button", { name: "로컬 TXT 확인" }).click();
      await expect(page.locator(".chat-attachments pre")).toHaveText("Current contents");
    }
    await page.evaluate(async () => {
      window.attachmentPreviewReads[0].resolve("Delayed old contents");
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    if (dismissal === "newer preview") await expect(page.locator(".chat-attachments pre")).toHaveText("Current contents");
    else {
      await expect(page.locator(".chat-attachments pre")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "미리보기 닫기" })).toHaveCount(0);
    }
    expect(state.uploads).toHaveLength(0);
    expect(state.starts).toHaveLength(0);
  });
}

test("one-hour draft expiry clears local previews and leaves the message untouched", async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  await page.locator("#agent-chat-input").fill("Keep this unsent message");
  await page.getByLabel("첨부파일 선택").setInputFiles(file("expired.txt", "Expired draft contents"));
  await page.getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect(page.locator(".chat-attachments pre")).toHaveText("Expired draft contents");
  await page.clock.fastForward(60 * 60 * 1000 + 30001);
  await expect(page.getByRole("alert").filter({ hasText: "1시간 만료" })).toBeVisible();
  await expect(page.locator(".chat-attachments li")).toHaveCount(0);
  await expect(page.locator(".chat-attachments pre")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "미리보기 닫기" })).toHaveCount(0);
  await expect(page.locator("#agent-chat-input")).toHaveValue("Keep this unsent message");
  expect(state.uploads).toHaveLength(0);
  expect(state.starts).toHaveLength(0);
});

test("short overflowing paste is captured losslessly while replacing a selection can stay native", async ({ page }) => {
  const state = await setup(page);
  const input = page.locator("#agent-chat-input");
  const draft = "d".repeat(49998);
  const text = "😀\r\n끝 ";
  await input.fill(draft);
  await input.evaluate(field => field.setSelectionRange(0, 0));
  expect(await paste(page, text)).toBe(true);
  await expect(input).toHaveValue(draft);
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeVisible();
  expect(state.uploadFields[0].bytes).toEqual(Buffer.from(text));
  await page.getByRole("button", { name: "pasted-text.txt 제거" }).click();
  await input.evaluate(field => field.setSelectionRange(0, 10));
  expect(await paste(page, text)).toBe(false);
  await expect(page.locator(".chat-attachments li")).toHaveCount(0);
  expect(state.uploads).toHaveLength(1);
  expect(state.starts).toHaveLength(0);
});

test("long local preview is capped without clipping the uploaded original", async ({ page }) => {
  const state = await setup(page);
  const original = "  고객\r\n" + "x".repeat(41000) + "😀 preserved ending  ";
  expect(await paste(page, original)).toBe(true);
  await page.getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect(page.locator(".chat-attachments pre")).toContainText("미리보기만 40,000자로 제한됨");
  expect(await page.locator(".chat-attachments pre").textContent()).toBe(`${original.slice(0, 40000)}\n[미리보기만 40,000자로 제한됨. 원본은 유지됩니다.]`);
  await page.getByRole("button", { name: "미리보기 닫기" }).click();
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeVisible();
  expect(state.uploadFields[0].bytes).toEqual(Buffer.from(original));
  expect(state.starts).toHaveLength(0);
});

test("paste rejected at the file limit preserves existing originals and prevents native truncation", async ({ page }) => {
  const state = await setup(page);
  await page.locator("#agent-chat-input").fill("Keep this draft");
  await page.getByLabel("첨부파일 선택").setInputFiles(Array.from({ length: 6 }, (_, index) => file(`original-${index}.txt`, `Original ${index}`)));
  expect(await paste(page, "x".repeat(60000))).toBe(true);
  await expect(page.getByRole("alert").filter({ hasText: "파일 6개" })).toBeVisible();
  await expect(page.locator(".chat-attachments li")).toHaveCount(6);
  await expect(page.locator("#agent-chat-input")).toHaveValue("Keep this draft");
  await expect(page.getByText("pasted-text.txt", { exact: true })).toHaveCount(0);
  await row(page, "original-0.txt").getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect(page.locator(".chat-attachments pre")).toHaveText("Original 0");
  expect(state.uploads).toHaveLength(0);
  expect(state.starts).toHaveLength(0);
});

test("extracted text over the aggregate limit cannot be confirmed or sent", async ({ page }) => {
  const state = await setup(page, state => { state.extractionText = "😀".repeat(20001); });
  await page.getByLabel("첨부파일 선택").setInputFiles([file("one.txt", "Original one"), file("two.txt", "Original two")]);
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "총 추출량" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await page.locator("#agent-chat-input").press("Control+Enter");
  expect(state.starts).toHaveLength(0);
  await page.getByRole("button", { name: "two.txt 제거" }).click();
  await expect(page.getByRole("checkbox")).toBeEnabled();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect.poll(() => state.starts.length).toBe(1);
  expect(state.starts[0].attachmentIds).toEqual(["attachment-one"]);
  expect(state.uploads).toHaveLength(2);
});

test("attachment extraction keeps the existing AI spending guard", async ({ page }) => {
  const state = await setup(page, state => { state.aiUsage.spendingEnabled = false; });
  await page.getByLabel("첨부파일 선택").setInputFiles(file("guarded.txt", "Guarded original"));
  await expect(page.getByRole("button", { name: "파일 읽고 확인", exact: true })).toBeDisabled();
  await page.locator("#agent-chat-input").press("Control+Enter");
  await expect(page.getByRole("alert").filter({ hasText: "사용량과 모델 지원 상태" })).toBeVisible();
  expect(state.uploads).toHaveLength(0);
  expect(state.starts).toHaveLength(0);
});


test("close and reopen of the same file cannot restore an older pending preview", async ({ page }) => {
  await delayLocalPreview(page);
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles(file("delayed.txt", "Synthetic text"));
  await page.getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect.poll(() => page.evaluate(() => window.attachmentPreviewReads.length)).toBe(1);
  await page.getByRole("button", { name: "미리보기 닫기" }).click();
  await page.getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect.poll(() => page.evaluate(() => window.attachmentPreviewReads.length)).toBe(2);
  await page.evaluate(() => window.attachmentPreviewReads[1].resolve("Newest reopened contents"));
  await expect(page.locator(".chat-attachments pre")).toHaveText("Newest reopened contents");
  await page.evaluate(async () => {
    window.attachmentPreviewReads[0].resolve("Stale first contents");
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(page.locator(".chat-attachments pre")).toHaveText("Newest reopened contents");
  expect(state.uploads).toHaveLength(0);
  expect(state.starts).toHaveLength(0);
});

test("local preview rejects safely after dismissal and a current read failure can be retried", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await delayLocalPreview(page);
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles(file("delayed.txt", "Synthetic text"));
  await page.getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect.poll(() => page.evaluate(() => window.attachmentPreviewReads.length)).toBe(1);
  await page.getByRole("button", { name: "미리보기 닫기" }).click();
  await page.getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect.poll(() => page.evaluate(() => window.attachmentPreviewReads.length)).toBe(2);
  await page.evaluate(async () => {
    window.attachmentPreviewReads[0].reject(new Error("Stale local read failure"));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(page.locator(".chat-attachments").getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => window.attachmentPreviewReads[1].reject(new Error("Current local read failure")));
  await expect(page.locator(".chat-attachments").getByRole("alert")).toHaveText("파일을 읽지 못했습니다.");
  await expect(row(page, "delayed.txt")).toBeVisible();
  await page.getByRole("button", { name: "미리보기 닫기" }).click();
  await page.getByRole("button", { name: "로컬 TXT 확인" }).click();
  await expect.poll(() => page.evaluate(() => window.attachmentPreviewReads.length)).toBe(3);
  await page.evaluate(() => window.attachmentPreviewReads[2].resolve("Recovered original contents"));
  await expect(page.locator(".chat-attachments pre")).toHaveText("Recovered original contents");
  await expect(page.locator(".chat-attachments").getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(state.uploads).toHaveLength(0);
  expect(state.starts).toHaveLength(0);
});

test("removing a failed request's attachment clears its retry notice and preserves the draft", async ({ page }) => {
  const state = await setup(page);
  await page.locator("#agent-chat-input").fill("Keep attachment retry exact");
  await page.getByLabel("첨부파일 선택").setInputFiles(file("original.txt", "Original attachment"));
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await page.getByRole("checkbox").check();
  state.startFailures = 1;
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  const retryNotice = page.getByRole("status").filter({ hasText: "접수 여부가 불확실한 이전 요청" });
  await expect(retryNotice).toBeVisible();
  state.aiUsage.spendingEnabled = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "original.txt 제거", exact: true }).click();
  await expect(retryNotice).toHaveCount(0);
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await expect(page.locator("#agent-chat-input")).toHaveValue("Keep attachment retry exact");
  await page.getByLabel("첨부파일 선택").setInputFiles(file("new.txt", "New unsent attachment"));
  await expect(page.getByRole("button", { name: "파일 읽고 확인", exact: true })).toBeDisabled();
  await page.locator("#agent-chat-input").press("Control+Enter");
  expect(state.starts).toHaveLength(1);
  expect(state.uploads).toHaveLength(1);
  expect(state.blocked).toEqual([]);
});

test("an exact attachment-only retry stays enabled when platform spending becomes paused", async ({ page }) => {
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles(file("only.txt", "Attachment-only request"));
  await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
  await page.getByRole("checkbox").check();
  state.startFailures = 1;
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  const retryNotice = page.getByRole("status").filter({ hasText: "접수 여부가 불확실한 이전 요청" });
  await expect(retryNotice).toBeVisible();
  state.aiUsage.spendingEnabled = false;
  const refreshed = page.waitForResponse(response => response.url().endsWith("/me/ai-usage"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await (await refreshed).finished();
  const send = page.getByRole("button", { name: "보내기", exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => state.starts.length).toBe(2);
  expect(state.starts[1]).toEqual(state.starts[0]);
  expect(state.starts[0].requirementText).toBe("첨부 자료의 읽기 범위와 내용을 확인해 주세요.");
  expect(state.uploads).toHaveLength(1);
  expect(state.blocked).toEqual([]);
});

for (const personalKey of [false, true]) test(`policy-like text with an attachment shows ${personalKey ? "BYOK pricing" : "paused platform state"} instead of a free settings promise`, async ({ page }) => {
  const state = await setup(page, state => {
    state.aiUsage.spendingEnabled = false;
    state.connections = [{ id: "personal-example", provider: "OPENAI", model: "gpt-6-luna", maskedKey: "synthetic-only", updatedAt: "2026-10-01T00:00:00Z" }];
  });
  const input = page.locator("#agent-chat-input");
  await input.fill("기본 세율 10%로 변경");
  const freeNotice = page.getByRole("status").filter({ hasText: "주간 한도 차감 없음" });
  await expect(freeNotice).toBeVisible();
  await page.getByLabel("첨부파일 선택").setInputFiles(file("context.txt", "Synthetic supporting text"));
  await expect(freeNotice).toHaveCount(0);
  if (personalKey) {
    await page.locator(".chat-model-trigger").click();
    await page.getByRole("dialog", { name: "AI 모델 선택", exact: true }).getByLabel("AI 연결", { exact: true }).selectOption("personal-example");
    await page.keyboard.press("Escape");
    await expect(page.locator(".agent-chat-composer .byok-cost-notice")).toContainText("$0.04275");
    await page.screenshot({ path: "outputs/ui-ux/attachment-policy-byok-cost.png", fullPage: true });
    await expect(page.getByRole("button", { name: "파일 읽고 확인", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "파일 읽고 확인", exact: true }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await expect.poll(() => state.starts.length).toBe(1);
    expect(state.starts[0].requirementText).toBe("기본 세율 10%로 변경");
    expect(state.starts[0].attachmentIds).toEqual(["attachment-one"]);
    expect(state.starts[0].modelSelection.credentialId).toBe("personal-example");
  } else {
    await expect(page.getByRole("status").filter({ hasText: "기본 제공 AI 실행이 현재 중지" }).first()).toBeVisible();
    await page.screenshot({ path: "outputs/ui-ux/attachment-policy-platform-paused.png", fullPage: true });
    await expect(page.getByRole("button", { name: "파일 읽고 확인", exact: true })).toBeDisabled();
    await input.press("Control+Enter");
    expect(state.starts).toHaveLength(0);
    expect(state.uploads).toHaveLength(0);
  }
  expect(state.proposal).toBeNull();
  expect(state.blocked).toEqual([]);
});
