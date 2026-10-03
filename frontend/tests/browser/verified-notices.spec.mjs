import { test as base, expect } from "@playwright/test";

const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const session = { userId: "fixture-user", workspaceId: "fixture-space", accessToken: "fixture-access", refreshToken: "fixture-refresh", accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" };
const pendingRegistration = { userId: null, workspaceId: null, accessToken: null, refreshToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, tokenType: "EmailVerificationRequired" };
const token = "fixture_" + "a".repeat(35);
const notice = { id: "notice-one", kind: "OPERATIONAL", title: "Fixture operational notice", body: "Fixture only. No actual service announcement.", versionLabel: "fixture-v1", effectiveAt: "2099-01-02T00:00:00Z", publishAt: "2020-01-01T00:00:00Z", status: "PUBLISHED", contentHash: "a".repeat(64), revision: 2 };
const campaign = { id: "campaign-one", noticeId: notice.id, snapshotTitle: "Immutable fixture subject", snapshotVersionLabel: "snapshot-v1", snapshotBody: "Immutable fixture body", status: "DRAFT", contentHash: "a".repeat(64), recipientHash: "b".repeat(64), recipientCount: 3, testStatus: null, createdAt: "2026-01-01T00:00:00Z", deliveries: { PREPARED: 3 } };

// Closed network fixture: every API request is fulfilled locally; all other external traffic is aborted.
const test = base.extend({
  fixture: async ({ page }, runFixture) => {
    const state = { writes: [], reads: [], unexpected: [], errors: [], public: [], adminStatus: 200, mutationStatus: 200, verifyStatus: 200, verifyCode: null, resendStatus: 202, delay: 0, dashboard: { notices: [{ ...notice }], campaigns: [{ ...campaign }], transportReady: false } };
    page.on("pageerror", error => state.errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      const json = (body, status = 200) => route.fulfill({ status, json: body });
      if (path.startsWith("/api/")) {
        if (req.method() === "GET") state.reads.push(path);
        else state.writes.push({ path, body: req.postData() ? req.postDataJSON() : null });
        if (state.delay && req.method() === "POST") await new Promise(resolve => setTimeout(resolve, state.delay));
        if (path === "/api/v2/auth/register") return json(pendingRegistration);
        if (path === "/api/v2/auth/email-verification/request") return json({ status: "IF_ELIGIBLE_CHECK_EMAIL" }, state.resendStatus);
        if (path === "/api/v2/auth/email-verification/confirm") return json(state.verifyStatus === 200 ? { status: "VERIFIED" } : { detail: "Never expose server token detail", code: state.verifyCode }, state.verifyStatus);
        if (path === "/api/v2/notices") return json(state.public);
        if (path === "/api/v2/admin/notices" && req.method() === "GET") return json(state.dashboard, state.adminStatus);
        if (path.startsWith("/api/v2/admin/") && req.method() === "POST") {
          if (state.mutationStatus !== 200) return json({ detail: "Fixture stale" }, state.mutationStatus);
          if (path === "/api/v2/admin/notices") { const value = { ...notice, ...req.postDataJSON(), id: "created-notice", status: "DRAFT", publishAt: null, revision: 0 }; state.dashboard.notices.push(value); return json(value); }
          if (path.endsWith("/review")) { const value = state.dashboard.notices.find(item => path.includes(item.id)); value.status = "REVIEWED"; value.revision++; return json(value); }
          if (path.endsWith("/publish")) { const value = state.dashboard.notices.find(item => path.includes(item.id)); value.status = "PUBLISHED"; value.publishAt = req.postDataJSON().publishAt; value.revision++; return json(value); }
          if (path === "/api/v2/admin/notice-campaigns") return json(state.dashboard.campaigns[0]);
          const value = state.dashboard.campaigns[0];
          if (path.endsWith("/test")) { value.testStatus = "BLOCKED_TRANSPORT"; return json(value); }
          if (path.endsWith("/confirm")) { value.status = "QUEUED"; return json(value); }
          if (path.endsWith("/cancel")) { value.status = "CANCELLED"; value.deliveries = { CANCELLED: value.recipientCount }; return json(value); }
        }
        state.unexpected.push(`${req.method()} ${path}`); return route.abort();
      }
      if (url.origin === origin) return route.continue();
      state.unexpected.push(url.origin); return route.abort();
    });
    await runFixture(state);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  }
});
async function admin(page) { await page.addInitScript(value => sessionStorage.setItem("freelance-ops-session-v1", JSON.stringify(value)), session); await page.goto("/admin/notices"); }
async function signup(page) {
  await page.goto("/workspace/projects");
  await page.getByRole("tab", { name: "처음 시작하기", exact: true }).click();
  for (const [name, value] of Object.entries({ displayName: "Fixture", workspaceName: "Fixture", email: "fixture@example.invalid", password: "fixture-password-only", passwordConfirm: "fixture-password-only" })) await page.locator(`input[name=${name}]`).fill(value);
  await page.getByRole("checkbox").check();
  await page.locator('button[type="submit"]').click();
}

test("pending signup creates no client session; generic resend and unavailable transport", async ({ page, fixture }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page);
  await expect(page.getByRole("heading", { name: "이메일을 확인해 주세요" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("freelance-ops-session-v1"))).toBeNull();
  expect(fixture.reads).toEqual([]);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('input[name="verificationEmail"]')).toHaveValue("fixture@example.invalid");
  await page.getByRole("button", { name: "확인 링크 다시 요청" }).click();
  await expect(page.locator(".verification-request [role=status]")).toContainText("가입할 수 있는 이메일 주소라면");
  fixture.resendStatus = 503;
  await page.getByRole("button", { name: "확인 링크 다시 요청" }).click();
  await expect(page.getByRole("alert")).toContainText("현재 이메일 발송을 사용할 수 없습니다");
  await page.getByRole("button", { name: "로그인으로 돌아가기" }).click();
  await expect(page.getByRole("tab", { name: "로그인", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(fixture.writes.map(item => item.path)).toEqual(["/api/v2/auth/register", "/api/v2/auth/email-verification/request", "/api/v2/auth/email-verification/request"]);
  expect(fixture.writes[0].body.ageAtLeast14).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("fragment token is removed before explicit verification, one click only, back never replays", async ({ page, fixture }) => {
  fixture.delay = 500;
  await page.goto(`/verify-email#token=${token}`);
  const verify = page.getByRole("button", { name: "이메일 확인하기" });
  await expect(verify).toBeEnabled();
  await expect(page).toHaveURL(/\/verify-email$/);
  expect(fixture.writes).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(token);
  await page.locator('input[name="password"]').fill("verified-owner-password");
  await page.locator('input[name="passwordConfirm"]').fill("verified-owner-password");
  await verify.click();
  await expect(page.getByRole("button", { name: "확인 중…" })).toBeDisabled();
  await expect(page).toHaveURL(/\/workspace\/projects\?emailVerified=1|\/workspace\?emailVerified=1/);
  expect(fixture.writes).toEqual([{ path: "/api/v2/auth/email-verification/confirm", body: { token, password: "verified-owner-password" } }]);
  await page.goBack();
  expect(fixture.writes).toHaveLength(1);
});

test("reload and query-only links cannot submit; errors reveal no server details", async ({ page, fixture }) => {
  await page.goto(`/verify-email#token=${token}`);
  await expect(page.getByRole("button", { name: "이메일 확인하기" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "이메일 확인하기" })).toBeDisabled();
  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByRole("button", { name: "이메일 확인하기" })).toBeDisabled();
  expect(fixture.writes).toEqual([]);
  fixture.verifyStatus = 400;
  await page.goto("/notices");
  await page.goto(`/verify-email#token=${token}`);
  await page.locator('input[name="password"]').fill("verified-owner-password");
  await page.locator('input[name="passwordConfirm"]').fill("verified-owner-password");
  await page.getByRole("button", { name: "이메일 확인하기" }).click();
  await expect(page.getByRole("alert")).toContainText("확인 링크가 유효하지 않거나");
  await expect(page.getByText("Never expose server token detail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이메일 확인하기" })).toBeDisabled();
});

test("public empty state has no seed policy; drafts, legal metadata, and future notices stay hidden", async ({ page, fixture }) => {
  await page.goto("/notices");
  await expect(page.getByRole("status")).toContainText("아직 게시된 운영 공지가 없습니다.");
  fixture.public = [{ ...notice, title: "Published fixture", body: "<script>fixture literal</script>" }, { ...notice, id: "draft", title: "Hidden draft", status: "DRAFT" }, { ...notice, id: "legal", title: "Hidden policy", kind: "PRIVACY_VERSION" }, { ...notice, id: "future", title: "Hidden future", publishAt: "2099-01-01T00:00:00Z" }];
  await page.reload();
  await expect(page.getByRole("heading", { name: "Published fixture" })).toBeVisible();
  await expect(page.getByText("<script>fixture literal</script>")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("workspace session does not grant notices administration", async ({ page, fixture }) => {
  fixture.adminStatus = 403;
  await admin(page);
  await expect(page.getByRole("alert")).toContainText("접근 권한이 없습니다.");
  await expect(page.getByRole("button", { name: "비공개 초안 저장" })).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test("legal metadata saves a blank body and has no publication or email controls", async ({ page, fixture }) => {
  await admin(page);
  await page.locator('select[name="kind"]').selectOption("PRIVACY_VERSION");
  await expect(page.locator('textarea[name="body"]')).toHaveCount(0);
  await page.locator('input[name="title"]').fill("Internal fixture metadata");
  await page.locator('input[name="versionLabel"]').fill("draft-fixture");
  await page.locator('input[name="effectiveAt"]').fill("2099-01-02T10:00");
  await page.getByRole("button", { name: "비공개 초안 저장" }).click();
  const article = page.getByRole("article", { name: "Internal fixture metadata", exact: true });
  await expect(article).toBeVisible();
  expect(fixture.writes[0].body).toMatchObject({ kind: "PRIVACY_VERSION", body: "", title: "Internal fixture metadata" });
  await article.getByRole("button", { name: "검토 완료로 표시" }).click();
  await expect(article).toContainText("검토 완료");
  await expect(article.getByRole("button")).toHaveCount(0);
});

test("publishing requires impact confirmation and exact revision; dismissal writes nothing", async ({ page, fixture }) => {
  fixture.dashboard.notices[0].status = "REVIEWED";
  await admin(page);
  await page.getByRole("button", { name: "공개 게시 검토" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "공개 게시 승인" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "돌아가기" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  await page.getByRole("button", { name: "공개 게시 검토" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("게시 시각 (이 기기의 시간대)").fill("2099-01-01T10:00");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "공개 게시 승인" }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes[0].body).toMatchObject({ expectedRevision: 2, confirmation: "PUBLISH_NOTICE" });
  expect(fixture.writes[0].body.publishAt).toBe(new Date("2099-01-01T10:00").toISOString());
  await expect(page.getByRole("button", { name: "메일 수신자 초안 준비" })).toHaveCount(0);
});

test("disabled transport self-test does not claim sent or enable queue approval", async ({ page, fixture }) => {
  await admin(page);
  await page.getByRole("button", { name: "내 이메일로 테스트 요청" }).click();
  await expect(page.getByRole("status")).toContainText("테스트 메일을 보내지 않았습니다");
  await expect(page.getByRole("button", { name: "대기열 등록 검토" })).toBeDisabled();
  expect(fixture.writes).toEqual([{ path: "/api/v2/admin/notice-campaigns/campaign-one/test", body: null }]);
});

test("queue and cancellation require exact snapshot review and block repeat clicks", async ({ page, fixture }) => {
  fixture.dashboard.campaigns[0].testStatus = "ACCEPTED";
  fixture.delay = 400;
  await page.setViewportSize({ width: 390, height: 844 });
  await admin(page);
  await page.getByRole("button", { name: "대기열 등록 검토" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Immutable fixture subject");
  await expect(dialog).toContainText("snapshot-v1");
  await expect(dialog).toContainText("3명");
  await expect(dialog).toContainText("Immutable fixture body");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "대기열 등록 승인" }).click();
  await expect(dialog.getByRole("button", { name: "처리 중…" })).toBeDisabled();
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes[0].body).toEqual({ contentHash: campaign.contentHash, recipientHash: campaign.recipientHash, recipientCount: 3, confirmation: "QUEUE_OPERATIONAL_NOTICE" });
  await page.getByRole("button", { name: "미발송 취소 검토" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("회수되지 않습니다");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "미발송 취소 승인" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("미발송 메일을 취소했습니다");
  expect(fixture.writes).toHaveLength(2);
  expect(fixture.writes[1]).toEqual({ path: "/api/v2/admin/notice-campaigns/campaign-one/cancel", body: {} });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("conflict discards stale approval until current dashboard is reloaded", async ({ page, fixture }) => {
  fixture.dashboard.campaigns[0].testStatus = "ACCEPTED";
  fixture.mutationStatus = 409;
  await admin(page);
  await page.getByRole("button", { name: "대기열 등록 검토" }).click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", { name: "대기열 등록 승인" }).click();
  await expect(page.getByRole("alert")).toContainText("다시 확인한 뒤 검토해 주세요");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "대기열 등록 검토" })).toHaveCount(0);
  fixture.dashboard.campaigns[0].recipientCount = 0;
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "대기열 등록 검토" })).toBeDisabled();
  expect(fixture.writes).toHaveLength(1);
});

test("English verification and notices remain readable at 320px", async ({ page, fixture }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "en"));
  await page.goto("/verify-email");
  await expect(page.getByRole("heading", { name: "Verify email ownership" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify email", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/notices");
  await expect(page.getByRole("status")).toHaveText("There are no published operational notices yet.");
  expect(fixture.writes).toEqual([]);
});


test("UTF-8 password overflow preserves the token for correction and never posts", async ({ page, fixture }) => {
  await page.goto(`/verify-email#token=${token}`);
  await page.locator('input[name="password"]').fill("가".repeat(25));
  await page.locator('input[name="passwordConfirm"]').fill("가".repeat(25));
  await page.getByRole("button", { name: "이메일 확인하기" }).click();
  await expect(page.getByRole("alert")).toContainText("UTF-8 기준 72바이트");
  await expect(page.getByRole("button", { name: "이메일 확인하기" })).toBeEnabled();
  expect(fixture.writes).toEqual([]);
  await page.locator('input[name="password"]').fill("verified-owner-password");
  await page.locator('input[name="passwordConfirm"]').fill("verified-owner-password");
  await page.getByRole("button", { name: "이메일 확인하기" }).click();
  await expect(page).toHaveURL(/\/workspace\/projects\?emailVerified=1/);
  expect(fixture.writes).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem("freelance-ops-session-v1"))).toBeNull();
});

test("documented password rejection alone preserves the token for explicit retry", async ({ page, fixture }) => {
  fixture.verifyStatus = 400;
  fixture.verifyCode = "INVALID_VERIFICATION_PASSWORD";
  await page.goto(`/verify-email#token=${token}`);
  await page.locator('input[name="password"]').fill("verified-owner-password");
  await page.locator('input[name="passwordConfirm"]').fill("verified-owner-password");
  await page.getByRole("button", { name: "이메일 확인하기" }).click();
  await expect(page.getByRole("alert")).toContainText("UTF-8 기준 72바이트");
  await expect(page.getByRole("button", { name: "이메일 확인하기" })).toBeEnabled();
  await expect(page.locator('input[name="password"]')).toHaveValue("");
  expect(fixture.writes).toHaveLength(1);
  fixture.verifyStatus = 200;
  await page.locator('input[name="password"]').fill("corrected-owner-password");
  await page.locator('input[name="passwordConfirm"]').fill("corrected-owner-password");
  await page.getByRole("button", { name: "이메일 확인하기" }).click();
  await expect(page).toHaveURL(/\/workspace\/projects\?emailVerified=1/);
  expect(fixture.writes[1].body).toEqual({ token, password: "corrected-owner-password" });
});
