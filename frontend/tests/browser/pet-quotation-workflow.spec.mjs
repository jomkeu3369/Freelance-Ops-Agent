import { test, expect } from "@playwright/test";
import { petQuotationFixture, workflow } from "./helpers/pet-quotation-fixture.mjs";
import { requestBarrier } from "./helpers/chat-fixture.mjs";

async function captureWorkflow(page, stage) {
  const width = page.viewportSize()?.width;
  if (width === 1440 || width === 390) await page.screenshot({ path: `outputs/pet-readiness/screenshots/${width}-${stage}.png`, fullPage: true });
}

// These tests exercise real rendered UI with mocked business/AI HTTP boundaries.
// Seeded authentication is not a signup, email, provider, or backend integration test.
async function createCustomerAndProject(page, state) {
  await page.goto("/workspace/clients");
  await page.getByRole("textbox", { name: "담당자 이름", exact: true }).fill("가상 고객 김민지");
  await page.getByRole("textbox", { name: "회사명", exact: true }).fill("가상 예약 스튜디오");
  await page.getByRole("textbox", { name: "이메일", exact: true }).fill("customer@example.invalid");
  await page.getByRole("button", { name: "고객 등록", exact: true }).click();
  await expect.poll(() => state.clientCreates.length).toBe(1);
  await expect(page.locator(".client-list")).toContainText("가상 고객 김민지");

  await page.goto("/workspace/projects");
  await page.getByRole("button", { name: "첫 고객 문의 등록", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "이름과 문의 내용으로 시작하세요.", exact: true });
  await dialog.locator('[name="title"]').fill(workflow.title);
  await dialog.locator('[name="requirementText"]').fill(workflow.requirement);
  await dialog.locator(".quick-intake-options > summary").click();
  await dialog.locator('[name="clientId"]').selectOption(workflow.clientId);
  await dialog.getByRole("button", { name: "프로젝트 만들기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workflow.projectId}/(?:intake|agent)$`));
  await expect(page.locator(".project-heading h1")).toHaveText(workflow.title);
  expect(state.projectCreates).toEqual([{
    clientId: workflow.clientId, title: workflow.title, requirementText: workflow.requirement,
    currency: "KRW", deadline: null, budgetMin: null, budgetMax: null,
  }]);
  // Move through the visible workflow navigation rather than inventing a run.
  if (!page.url().endsWith("/agent")) await page.getByRole("navigation", { name: "프로젝트 진행 단계" }).getByRole("button", { name: /AI 분석/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workflow.projectId}/agent$`));
  await expect(page.getByRole("button", { name: "펫과 견적 만들기", exact: true })).toBeEnabled();
  const contrast = await page.locator(".chat-quotation-start").evaluate(button => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const foreground = luminance(getComputedStyle(button.querySelector("span")).color);
    const background = luminance(getComputedStyle(button).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await captureWorkflow(page, "analysis-ready");
  expect(state.starts).toEqual([]);
}

async function selectPet(page, state) {
  await page.getByRole("button", { name: "함께할 펫", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "함께할 펫", exact: true });
  await expect(panel.locator(".pet-library")).toContainText("견적 친구");
  await captureWorkflow(page, "pet-selection");
  await panel.getByRole("button", { name: "이 펫 선택", exact: true }).click();
  await expect(panel.getByRole("button", { name: "선택됨", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(state.petSelections).toEqual([{ action: "SELECT", expectedRevision: 1 }]);
  expect(state.starts).toEqual([]);
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
}

async function analyzeWithPet(page, state) {
  await selectPet(page, state);
  await page.getByRole("button", { name: "펫과 견적 만들기", exact: true }).click();
  await expect.poll(() => state.starts.length).toBe(1);
  // This CTA explicitly requests the full workflow and its platform input budget.
  expect(state.starts[0].workflowMode).toBe("PROJECT_ANALYSIS");
  expect(state.starts[0].budget.maxInputTokens).toBe(100000);
  expect(state.starts[0].requirementText).toBe(workflow.requirement);
  expect(state.selectedPetAtStart).toEqual([workflow.petId]);
  expect(state.quoteCreates).toEqual([]);
  const question = page.getByRole("textbox", { name: workflow.question, exact: true });
  await expect(question).toBeVisible();
  await expect(page.getByRole("button", { name: "답변하고 계속", exact: true })).toBeDisabled();
  await question.fill(workflow.answer);
  await page.getByRole("button", { name: "답변하고 계속", exact: true }).click();
  await expect.poll(() => state.resumes.length).toBe(1);
  expect(state.resumes[0]).toMatchObject({ interruptionId: "synthetic-question", answers: [{ questionIndex: 0, answer: workflow.answer }] });
  expect(state.resumes[0].idempotencyKey).toBeTruthy();
  await expect(page.locator(".interruption-form")).toHaveCount(0);
  await page.getByRole("button", { name: "결과 열기", exact: true }).click();
  const result = page.getByRole("dialog", { name: "분석 결과", exact: true });
  await expect(result).toContainText("핵심·권장·확장 3개 견적안을 준비했습니다.");
  await result.getByRole("button", { name: "견적 비교하기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workflow.projectId}/quote$`));
  await expect(page.locator(".quote-item-disclosure")).toContainText(workflow.itemTitle);
  expect(state.starts).toHaveLength(1);
  expect(state.publishes).toEqual([]);
  expect(state.shares).toEqual([]);
}

async function reviewQuote(page) {
  const save = page.getByRole("button", { name: "검토용 초안 저장", exact: true });
  await expect(save).toBeDisabled(); // AI scope does not invent a user rate.
  await page.locator(".quote-item-disclosure").first().click();
  const item = page.locator(".quote-item-block").first();
  await expect(item.getByRole("spinbutton", { name: "수량", exact: true })).toHaveValue("6");
  await expect(item.getByRole("textbox", { name: "가정 내용", exact: true })).toHaveValue("이메일 알림만 포함. 문자 발송과 결제는 제외한다.");
  await item.getByRole("spinbutton", { name: "단가", exact: true }).fill("50000");
  await expect(save).toBeEnabled();
  await captureWorkflow(page, "quote-review");
  return { item, save };
}

function expectClean(state) {
  expect(state.unexpectedWrites).toEqual([]);
  expect(state.blocked).toEqual([]);
  expect(state.pageErrors).toEqual([]);
}

for (const width of [1440, 390]) {
  test(`${width}px mocked customer → selected pet → clarification → reviewed quote → published public proposal`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 960 });
    const state = await petQuotationFixture(page);
    await createCustomerAndProject(page, state);
    await analyzeWithPet(page, state);
    const { save } = await reviewQuote(page);
    await save.click();
    const publish = page.getByRole("button", { name: "발행하기", exact: true });
    await expect(publish).toBeEnabled();
    expect(state.quoteCreates).toHaveLength(1);
    expect(state.quoteCreates[0]).toMatchObject({ scenario: "RECOMMENDED", currency: "KRW", taxRate: .1, applyDefaultRiskBuffer: true, items: [{ title: workflow.itemTitle, quantity: 6, unitRate: 50000, basis: { type: "ASSUMPTION" } }] });
    expect(state.publishes).toEqual([]);
    expect(state.shares).toEqual([]);
    await expect(page.getByRole("button", { name: "고객 링크 만들기", exact: true })).toHaveCount(0);
    await publish.click();
    await expect(page.locator(".saved-quote")).toContainText("발행 완료");
    await page.getByRole("button", { name: "고객 링크 만들기", exact: true }).click();
    const link = page.locator(".share-link a");
    await expect(link).toHaveAttribute("href", new RegExp(`/proposal/${workflow.token}$`));
    await expect(page.locator(".saved-quote")).toContainText("363,000");
    expect(state.publishes).toHaveLength(1);
    expect(state.shares).toEqual([{ expiresInDays: 14 }]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const publicUrl = await link.getAttribute("href");
    // A fresh navigation removes seeded auth before public proposal access.
    await page.addInitScript(() => sessionStorage.removeItem("freelance-ops-session-v1"));
    await page.goto(publicUrl);
    await expect(page.locator(".proposal-page h1")).toHaveText(workflow.title);
    await expect(page.locator(".proposal-items")).toContainText(workflow.itemTitle);
    await expect(page.locator(".proposal-calculation")).toContainText("363,000");
    expect(await page.evaluate(() => sessionStorage.getItem("freelance-ops-session-v1"))).toBeNull();
    await page.getByRole("textbox", { name: "이름", exact: true }).fill("가상 고객 김민지");
    await page.getByRole("textbox", { name: "이메일", exact: true }).fill("customer@example.invalid");
    await page.getByRole("textbox", { name: "의견", exact: true }).fill("가상 검증: 이메일 알림 범위와 금액을 확인했습니다.");
    await page.getByRole("button", { name: "응답 제출", exact: true }).click();
    await expect(page.getByRole("heading", { name: "제안을 승인했습니다.", exact: true })).toBeVisible();
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0]).toMatchObject({ authorization: null, body: { decision: "APPROVED", clientName: "가상 고객 김민지" } });
    expect(state.publicReads.length).toBeGreaterThan(0);
    expect(state.publicReads.every(read => read.authorization === null)).toBe(true);
    expectClean(state);
    await testInfo.attach("verification-boundaries", { body: "Rendered UI verified with synthetic HTTP responses. Signup/email verification, Spring/PostgreSQL persistence, LLM quality, provider access, real costs, and email delivery were not exercised.", contentType: "text/plain" });
  });
}

test("mocked save failure retains reviewed inputs and cannot publish or share before explicit retry", async ({ page }) => {
  test.setTimeout(90_000);
  const state = await petQuotationFixture(page);
  await createCustomerAndProject(page, state);
  await analyzeWithPet(page, state);
  const { item, save } = await reviewQuote(page);
  state.saveFailures = 1;
  await save.click();
  await expect(page.locator(".quote-builder > [role=alert]")).toContainText("견적 초안을 저장하지 못했습니다.");
  await expect(item.getByRole("spinbutton", { name: "단가", exact: true })).toHaveValue("50000");
  await expect(page.getByRole("button", { name: "발행하기", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "고객 링크 만들기", exact: true })).toHaveCount(0);
  expect(state.publishes).toEqual([]);
  expect(state.shares).toEqual([]);
  await save.click();
  await expect(page.getByRole("button", { name: "발행하기", exact: true })).toBeEnabled();
  expect(state.quoteCreates).toHaveLength(2);
  expect(state.quoteCreates[1]).toEqual(state.quoteCreates[0]);
  await item.getByRole("spinbutton", { name: "수량", exact: true }).fill("7");
  await expect(page.getByRole("button", { name: "발행하기", exact: true })).toBeDisabled();
  expect(state.publishes).toEqual([]);
  expectClean(state);
});

test("mocked uncertain quotation start retries the same key, project source and skill request", async ({ page }) => {
  const state = await petQuotationFixture(page);
  await createCustomerAndProject(page, state);
  await selectPet(page, state);
  const composer = page.locator("#agent-chat-input");
  await composer.fill("전송하지 않은 별도 대화 초안");
  state.lostStartResponses = 1;
  const start = page.getByRole("button", { name: "펫과 견적 만들기", exact: true });
  await start.click();
  await expect.poll(() => state.starts.length).toBe(1);
  await expect(page.getByText("가상 서버: 시작 응답을 확인하지 못했습니다.", { exact: true })).toBeVisible();
  await expect(start).toBeEnabled();
  await composer.fill("수정한 별도 대화 초안도 견적 원문을 대체하지 않음");
  await start.click();
  await expect(page.getByRole("textbox", { name: workflow.question, exact: true })).toBeVisible();
  expect(state.starts).toHaveLength(2);
  expect(state.startKeys[0]).toBeTruthy();
  expect(state.startKeys[1]).toBe(state.startKeys[0]);
  expect(state.starts[1]).toEqual(state.starts[0]);
  expect(state.starts[1].requirementText).toBe(workflow.requirement);
  expect(state.starts[1].workflowMode).toBe("PROJECT_ANALYSIS");
  expect(state.starts[1].budget.maxInputTokens).toBe(100000);
  expect(state.starts[1].skillSelection).toMatchObject({ mode: "AUTO", manualIds: [], excludedIds: [] });
  await expect(composer).toHaveValue("수정한 별도 대화 초안도 견적 원문을 대체하지 않음");
  expect(state.resumes).toEqual([]);
  expect(state.quoteCreates).toEqual([]);
  expectClean(state);
});

async function startSlowPetSelection(page, state) {
  const barrier = requestBarrier();
  state.nextPetSelection = barrier;
  await page.getByRole("button", { name: "함께할 펫", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "함께할 펫", exact: true });
  await panel.getByRole("button", { name: "이 펫 선택", exact: true }).click();
  await barrier.entered;
  expect(state.pets.selectedPetId).toBeNull();
  await panel.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(panel).toHaveCount(0);
  return barrier;
}

async function expectPetChangeBlocksBothRuns(page, state, draft) {
  const start = page.getByRole("button", { name: "펫과 견적 만들기", exact: true });
  const send = page.getByRole("button", { name: "보내기", exact: true });
  await expect(start).toBeDisabled();
  await expect(send).toBeDisabled();
  await page.locator("#agent-chat-input").press("Control+Enter");
  const steps = page.getByRole("navigation", { name: "프로젝트 진행 단계", exact: true });
  await steps.getByRole("button", { name: /문의/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workflow.projectId}/intake$`));
  await steps.getByRole("button", { name: /AI 분석/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workflow.projectId}/agent$`));
  await expect(page.locator("#agent-chat-input")).toHaveValue(draft);
  await expect(start).toBeDisabled();
  await expect(send).toBeDisabled();
  await page.locator("#agent-chat-input").press("Control+Enter");
  expect(state.starts).toEqual([]);
}

async function expectSelectedPetCanStart(page, state, draft) {
  const start = page.getByRole("button", { name: "펫과 견적 만들기", exact: true });
  await expect(start).toBeEnabled();
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeEnabled();
  await expect(page.locator("#agent-chat-input")).toHaveValue(draft);
  expect(state.starts).toEqual([]);
  expect(state.pets.selectedPetId).toBe(workflow.petId);
  await start.click();
  await expect(page.getByRole("textbox", { name: workflow.question, exact: true })).toBeVisible();
  expect(state.starts).toHaveLength(1);
  expect(state.selectedPetAtStart).toEqual([workflow.petId]);
  expect(state.run.metadata.petProfiles.map(pet => pet.petId)).toEqual([workflow.petId]);
  expect(state.starts[0].workflowMode).toBe("PROJECT_ANALYSIS");
  expect(state.starts[0].budget.maxInputTokens).toBe(100000);
  expectClean(state);
}

test("mocked pending pet SELECT blocks quote and chat after closing its panel and switching steps", async ({ page }) => {
  const state = await petQuotationFixture(page);
  await createCustomerAndProject(page, state);
  const draft = "펫 선택이 확인될 때까지 전송하지 않을 대화 초안";
  await page.locator("#agent-chat-input").fill(draft);
  const barrier = await startSlowPetSelection(page, state);
  try {
    await expectPetChangeBlocksBothRuns(page, state, draft);
    expect(state.petSelections).toEqual([{ action: "SELECT", expectedRevision: 1 }]);
    const response = page.waitForResponse(received => received.request().method() === "PATCH" && received.url().endsWith(`/agent-pets/${workflow.petId}`));
    barrier.release();
    expect((await response).status()).toBe(204);
    await expectSelectedPetCanStart(page, state, draft);
  } finally {
    barrier.release();
  }
});

test("mocked failed pet SELECT keeps quote and chat blocked until explicit successful reselection", async ({ page }) => {
  const state = await petQuotationFixture(page);
  await createCustomerAndProject(page, state);
  const draft = "실패한 펫 변경을 확인하고 나서 보낼 대화 초안";
  await page.locator("#agent-chat-input").fill(draft);
  state.petSelectionFailures = 1;
  const barrier = await startSlowPetSelection(page, state);
  try {
    await expectPetChangeBlocksBothRuns(page, state, draft);
    const response = page.waitForResponse(received => received.request().method() === "PATCH" && received.url().endsWith(`/agent-pets/${workflow.petId}`));
    barrier.release();
    expect((await response).status()).toBe(503);
    // A successful list GET on reopening is not confirmation of the failed
    // selection. Only the user's successful retry may unlock paid execution.
    await expectPetChangeBlocksBothRuns(page, state, draft);
    expect(state.pets.selectedPetId).toBeNull();
    await page.getByRole("button", { name: "함께할 펫", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "함께할 펫", exact: true });
    const choose = panel.getByRole("button", { name: "이 펫 선택", exact: true });
    await expect(choose).toBeEnabled();
    expect(state.pets.selectedPetId).toBeNull();
    await choose.click();
    await expect(panel.getByRole("button", { name: "선택됨", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(state.petSelections).toEqual([
      { action: "SELECT", expectedRevision: 1 },
      { action: "SELECT", expectedRevision: 1 },
    ]);
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await expectSelectedPetCanStart(page, state, draft);
  } finally {
    barrier.release();
  }
});
