import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

async function setup(page, configure = () => {}) {
  const state = await fixture(page);
  state.uploads = []; state.uploadFields = []; state.removals = []; state.attachmentFailure = false;
  configure(state);
  await page.route("**/projects/*/attachments**", async route => {
    if (route.request().method() === "DELETE") { state.removals.push(route.request().url()); return route.fulfill({status: 204}); }
    const body = route.request().postDataBuffer();
    const index = state.uploads.push(body);
    const fields = await new Response(body, { headers: { "Content-Type": route.request().headers()["content-type"] } }).formData();
    const file = fields.get("file");
    state.uploadFields.push({ name: file.name, encoding: fields.get("encoding"), delimiter: fields.get("delimiter"), bytes: Buffer.from(await file.arrayBuffer()) });
    const barrier = state.uploadBarrier;
    state.uploadBarrier = null;
    if (barrier) await barrier.wait();
    if (state.attachmentFailure) return route.fulfill({status: 422, contentType: "application/json", body: JSON.stringify({detail: "Invalid attachment"})});
    return route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({id: index === 1 ? "attachment-one" : `attachment-${index}`, expiresAt: "2099-01-01T00:00:00Z", extraction: {name: file.name, mediaType: file.type, size: file.size, sha256: "0".repeat(64), status: "COMPLETE", text: state.extractionText ?? "Extracted synthetic contents", notice: "", encoding: fields.get("encoding"), delimiter: fields.get("delimiter"), units: 1}})});
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
test("oversize file rejected locally", async ({page}) => {
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles({name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(2097153, "a")});
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
