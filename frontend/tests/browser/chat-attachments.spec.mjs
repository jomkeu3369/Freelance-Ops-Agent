import { test, expect } from "@playwright/test";
import { fixture, requestBarrier } from "./helpers/chat-fixture.mjs";

async function setup(page) {
  const state = await fixture(page);
  state.uploads = []; state.removals = []; state.attachmentFailure = false;
  await page.route("**/projects/*/attachments**", async route => {
    if (route.request().method() === "DELETE") { state.removals.push(route.request().url()); return route.fulfill({status: 204}); }
    state.uploads.push(route.request().postDataBuffer());
    if (state.uploadBarrier) await state.uploadBarrier.wait();
    if (state.attachmentFailure) return route.fulfill({status: 422, contentType: "application/json", body: JSON.stringify({detail: "Invalid attachment"})});
    return route.fulfill({status: 201, contentType: "application/json", body: JSON.stringify({id: "attachment-one", expiresAt: "2099-01-01T00:00:00Z", extraction: {name: "pasted-text.txt", mediaType: "text/plain", size: 9000, sha256: "0".repeat(64), status: "COMPLETE", text: "Extracted synthetic contents", notice: "", encoding: "utf-8", delimiter: null, units: 1}})});
  });
  await page.goto("/workspace/projects/project-one/agent");
  return state;
}
async function paste(page, text, composing = false) {
  await page.locator("#agent-chat-input").evaluate((field, {text, composing}) => {
    if (composing) field.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
    const data = new DataTransfer(); data.setData("text/plain", text);
    field.dispatchEvent(new ClipboardEvent("paste", {bubbles: true, cancelable: true, clipboardData: data}));
    if (composing) field.dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
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
  await paste(page, "x".repeat(9000), true);
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
  state.uploadBarrier = requestBarrier();
  await page.getByRole("button", {name: "파일 읽고 확인", exact: true}).click();
  await state.uploadBarrier.entered;
  await page.getByRole("button", {name: "파일 읽기 취소"}).click();
  await expect(page.getByRole("alert").filter({hasText: "취소"})).toBeVisible();
  state.uploadBarrier.release();
  expect(state.starts).toHaveLength(0);
});
test("oversize file rejected locally", async ({page}) => {
  const state = await setup(page);
  await page.getByLabel("첨부파일 선택").setInputFiles({name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(2097153, "a")});
  await expect(page.getByRole("alert").filter({hasText: "2 MiB"})).toBeVisible();
  expect(state.uploads).toHaveLength(0);
});
