import { test, expect } from "@playwright/test";
import { readFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { api, collectTraffic, account, login, intake, selectSyntheticConnection, latestStatus, openNavigation, installLiveGuards } from "./helpers/real-server.mjs";

installLiveGuards();

const decisionAcknowledgement = "선택 의견, 범위 차이, 중복, 근거와 미확정 가정·열린 질문을 검토했습니다. 이 내용을 결과 확정본으로 저장합니다.";
const specAcknowledgement = "명세 전체를 검토했으며 이 내용을 PDF와 이 프로젝트의 다음 분석 참고 자료로 확정합니다.";

for (const [count, mobile] of [[1, false], [2, false], [3, true]]) {
  test.describe(`${count} opinion localhost journey`, () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    test(`${count} real selected opinions survive edited confirmation, PDF and project reuse${mobile ? " on mobile" : ""}`, async ({ page, request }, testInfo) => {
      const evidence = collectTraffic(page);
      const { email, session } = await account(request);
      await login(page, email);
      const requirementText = "LIVE 실제 연결 검증: 고객 제공 자료로 로그인과 고객 관리 기능을 구성합니다.";
      const { project, root, headers } = await intake(page, request, session, `실제 연결 ${count} 의견`, requirementText);
      const base = `${root}/projects/${project.id}`;
      await page.getByRole("navigation", { name: "프로젝트 진행 단계", exact: true }).getByRole("button", { name: /AI 분석/ }).click();
      await expect(page).toHaveURL(/\/agent$/);
      const credentialId = await selectSyntheticConnection(page, session);
      const spend = await (await request.get(`${api}/api/v2/me/ai-usage`, { headers })).json();
      expect(spend.spendingEnabled).toBe(false);
  
      await page.getByRole("button", { name: "AI 설정 열기" }).click();
      const studio = page.locator(".pet-prompt-studio");
      await studio.getByRole("textbox").fill("차분한 고양이, 일정 관리와 빠뜨린 요구사항 확인");
      await studio.getByRole("button", { name: "펫 미리보기", exact: true }).click();
      await expect(studio.locator(".pet-composed-preview")).toBeVisible();
      await studio.getByRole("button", { name: "저장하고 선택", exact: true }).evaluate(node => { node.click(); node.click(); });
      await expect(studio.getByRole("button", { name: "선택됨", exact: true })).toBeVisible();
      const pets = await (await request.get(`${root}/agent-pets`, { headers })).json();
      expect(pets.pets).toHaveLength(1); expect(pets.selectedPetId).toBe(pets.pets[0].id);
      await page.keyboard.press("Escape");
      await page.reload();
      const eyes = page.locator(".workspace-companion .pet-eyes");
      await expect(eyes).toHaveAttribute("transform", "translate(0 0)");
      if (!mobile) { await page.mouse.move(1400, 750); await expect.poll(() => eyes.getAttribute("transform")).not.toBe("translate(0 0)"); }
      // Project model choice is ephemeral after reload; explicitly reselect it.
      await page.getByRole("button", { name: /AI 모델 선택:/ }).click();
      await page.getByRole("combobox", { name: "AI 연결", exact: true }).selectOption(credentialId);
      await page.getByRole("dialog", { name: "AI 모델 선택", exact: true }).getByRole("button", { name: "닫기", exact: true }).click();
      await page.locator("#agent-chat-input").fill("이 프로젝트에서 먼저 확인할 점은 무엇인가요?");
      await page.getByRole("button", { name: "보내기", exact: true }).click();
      await expect.poll(() => latestStatus(request, base, headers)).toBe("COMPLETED");
      await expect(page.getByRole("button", { name: "프로젝트 전체 분석 시작", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "프로젝트 전체 분석 시작", exact: true }).evaluate(node => { node.click(); node.click(); });
      const answer = page.locator(".agent-chat .interruption-form");
      await expect(answer).toBeVisible();
      await page.reload();
      await expect(answer).toBeVisible();
      await answer.locator("textarea").fill("고객이 자료를 제공하며 결제 기능은 제외합니다.");
      await answer.getByRole("button", { name: "답변하고 계속", exact: true }).click();
      await expect.poll(() => latestStatus(request, base, headers)).toBe("COMPLETED");
      const source = await (await request.get(`${base}/analysis-decisions/sources/latest`, { headers })).json();
      expect(source.sourceCurrent).toBe(true); expect(source.view.result.quotationDrafts).toHaveLength(3);
      expect(source.view.result.departmentResults).toHaveLength(4);
      await page.getByRole("button", { name: "계획 의견 선택·확정", exact: true }).click();
      for (const name of ["핵심 범위", "권장 범위", "확장 범위"].slice(0, count)) await page.getByRole("checkbox", { name: `${name} 관점 선택`, exact: true }).check();
      await page.getByRole("button", { name: "선택 의견으로 정리 초안 만들기", exact: true }).evaluate(node => { node.click(); node.click(); });
      const decisionBody = page.getByRole("textbox", { name: "검토한 결과 내용", exact: true });
      await expect(decisionBody).toBeVisible();
      await decisionBody.fill(`${await decisionBody.inputValue()}\n사용자 검토: 선택한 기능 범위만 수행합니다.`);
      await page.getByRole("button", { name: "수정 내용 새 버전 저장", exact: true }).click();
      await page.getByRole("checkbox", { name: decisionAcknowledgement, exact: true }).check();
      await page.getByRole("button", { name: "검토한 결과 확정", exact: true }).click();
      await page.getByRole("button", { name: "확정 결과로 명세 만들기", exact: true }).click();
      await expect(page).toHaveURL(/\/specification$/);
      await page.getByRole("button", { name: "확정 결과로 명세 생성", exact: true }).click();
      const body = page.getByRole("textbox", { name: "명세 내용", exact: true });
      await expect(body).toBeVisible();
      const finalText = `LIVE_FINAL_${count}\n고객 제공 자료로 선택한 기능만 수행합니다.\n가격과 가정은 별도 검토합니다.`;
      await page.getByRole("textbox", { name: "명세 제목", exact: true }).fill("검토 완료 명세서");
      await body.fill(finalText);
      await page.getByRole("button", { name: "수정본 새 버전 저장", exact: true }).click();
      await page.getByRole("checkbox", { name: specAcknowledgement, exact: true }).check();
      await page.getByRole("button", { name: "명세서 최종 확정", exact: true }).evaluate(node => { node.click(); node.click(); });
      await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeEnabled();
      const specifications = await (await request.get(`${base}/specifications`, { headers })).json();
      expect(specifications).toHaveLength(2);
      const confirmedSummary = specifications.find(value => value.status === "CONFIRMED");
      const specification = await (await request.get(`${base}/specifications/${confirmedSummary.id}`, { headers })).json();
      expect(specification.bodyText).toBe(finalText); expect(specification.status).toBe("CONFIRMED");
      const intruder = (await account(request)).session;
      for (const suffix of [specification.id, `${specification.id}/pdf`]) {
        const forbidden = await request.get(`${base}/specifications/${suffix}`, { headers: { Authorization: `Bearer ${intruder.accessToken}` } });
        expect([403, 404]).toContain(forbidden.status());
      }
      const pdf = await request.get(`${base}/specifications/${specification.id}/pdf`, { headers });
      const pdfStatus = pdf.status(); expect([200, 503]).toContain(pdfStatus);
      if (pdfStatus === 200) expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
      else expect((await (await request.get(`${base}/specifications/${specification.id}`, { headers })).json()).bodyText).toBe(finalText);
      if (process.env.LIVE_PDF_FONT) {
        const fontHash = createHash("sha256").update(await readFile(process.env.LIVE_PDF_FONT)).digest("hex");
        expect(fontHash).toBe("6d0af5258997aec7354a6e340fc2325ba321c410ca48b3af858c8c3d6e92a324");
        const target = path.resolve("../backend/build/resources/main/fonts/Pretendard-Regular.ttf");
        await mkdir(path.dirname(target), { recursive: true }); await copyFile(process.env.LIVE_PDF_FONT, target);
      }
      const waiting = page.waitForEvent("download");
      await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
      const downloaded = await waiting;
      const bytes = await readFile(await downloaded.path()); expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      await page.reload();
      await expect(page.locator(".specification-detail > pre.specification-content")).toContainText(finalText);
      await (await openNavigation(page, "근거 자료 관리")).click();
      await expect(page.locator(".knowledge-detail")).toContainText(finalText);
      const histories = await (await request.get(`${base}/agent-runs/history`, { headers })).json(); expect(histories).toHaveLength(2);
      const decisions = await (await request.get(`${base}/analysis-decisions`, { headers })).json();
      expect(decisions).toHaveLength(2);
      expect(decisions.filter(value => value.status === "CONFIRMED")).toHaveLength(1);
      expect(decisions.find(value => value.status === "CONFIRMED").selectedOpinionIds).toHaveLength(count);
      expect(evidence.traffic.filter(value => value.path.endsWith("/auth/login") && value.method === "POST")).toHaveLength(1);
      expect(evidence.errors).toEqual([]);
      expect(evidence.traffic.filter(value => value.status >= 500)).toEqual([]);
      await writeFile(testInfo.outputPath("workflow-evidence.json"), JSON.stringify({ projectId: project.id, sourceRunId: source.runId, selectedOpinions: count, pdfInitialStatus: pdfStatus, confirmedSpecificationId: specification.id, ...evidence }, null, 2));
      await testInfo.attach("real-local-http-evidence", { contentType: "application/json", body: Buffer.from(JSON.stringify({ boundary: "Actual Chrome → Next/Spring → FastAPI → PostgreSQL. External model adapter only is synthetic; BYOK row is existing never-decrypted test fixture; local PDF font only.", projectId: project.id, sourceRunId: source.runId, selectedOpinions: count, pdfInitialStatus: pdfStatus, confirmedSpecificationId: specification.id, ...evidence }, null, 2)) });
      await testInfo.attach("confirmed-local-document", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  });
}
