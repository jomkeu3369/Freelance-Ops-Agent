import { test, expect } from "@playwright/test";

const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const session = { userId: "synthetic-admin", workspaceId: "synthetic-space", accessToken: "synthetic-token", refreshToken: "synthetic-refresh", accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" };
const member = index => ({ id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`, email: `member${index}@example.invalid`, displayName: `가상 회원 ${index}`, status: index === 2 ? "DISABLED" : "ACTIVE", emailVerificationRequired: false, emailVerifiedAt: null, joinedAt: "2026-10-05T00:00:00Z", lastLoginAt: index === 1 ? "2026-10-05T01:00:00Z" : null });

async function fixture(page, denied = false) {
  const state = { denied, requests: [], blockNext: null };
  await page.addInitScript(value => sessionStorage.setItem("freelance-ops-session-v1", JSON.stringify(value)), session);
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route("**/api/v2/admin/**", async route => {
    const url = new URL(route.request().url());
    state.requests.push({ path: url.pathname, method: route.request().method(), query: Object.fromEntries(url.searchParams) });
    if (state.denied) return route.fulfill({ status: 403, json: { message: "Forbidden" } });
    const recordingStartedAt = "2026-10-05T00:00:00Z";
    const pageNumber = Number(url.searchParams.get("page") ?? 0);
    if (url.pathname.endsWith("/summary")) return route.fulfill({ json: { totalMembers: 27, activeMembers: 26, pendingVerification: 0, joinedLast7Days: 27, signedInLast7Days: 1, recordingStartedAt } });
    if (url.pathname.endsWith("/members")) {
      let members = Array.from({ length: 27 }, (_, i) => member(i + 1));
      const q = url.searchParams.get("q"), status = url.searchParams.get("status");
      if (q) members = members.filter(row => row.email.includes(q));
      if (status) members = members.filter(row => row.status === status);
      const payload = { items: members.slice(pageNumber * 25, (pageNumber + 1) * 25), total: members.length, page: pageNumber, size: 25, recordingStartedAt };
      if (state.blockNext) { const block = state.blockNext; state.blockNext = null; await block; }
      return route.fulfill({ json: payload }).catch(() => {});
    }
    if (url.pathname.endsWith("/login-events")) return route.fulfill({ json: { items: [{ id: "login-one", userId: url.searchParams.get("userId") || member(1).id, method: "PASSWORD", occurredAt: "2026-10-05T01:00:00Z" }], total: 1, page: 0, size: 25, recordingStartedAt } });
    if (url.pathname.endsWith("/member-audit-events")) return route.fulfill({ json: { items: [{ id: "audit-one", source: "WEEKLY_CREDITS", actorUserId: "synthetic-admin", action: "CHANGE_LIMIT", target: "weekly_limit", previousValue: "100", newValue: "125", previousEpoch: 0, newEpoch: 0, createdAt: "2026-10-05T00:00:00Z" }], total: 1, page: 0, size: 25, recordingStartedAt: null } });
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}

test("member reader searches, filters, pages and opens only the selected member's login metadata", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "회원 및 활동", exact: true })).toBeVisible();
  await expect(page.getByText("1 / 2 페이지 · 총 27건")).toBeVisible();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByText("member26@example.invalid", { exact: true })).toBeVisible();
  await expect(page.getByText("member1@example.invalid", { exact: true })).toHaveCount(0);
  await page.getByLabel("회원 검색").fill("member1@");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("1 / 1 페이지 · 총 1건")).toBeVisible();
  await page.getByRole("button", { name: "member1@example.invalid 로그인 기록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "가상 회원 1의 로그인 기록" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "비밀번호 로그인", exact: true })).toBeVisible();
  expect(state.requests.some(request => request.path.endsWith("login-events") && request.query.userId === member(1).id)).toBeTruthy();
  expect(state.requests.every(request => request.method === "GET")).toBeTruthy();
});

test("no grant reveals no member metadata or statistics", async ({ page }) => {
  await fixture(page, true);
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main [role=alert]")).toContainText("접근 권한이 없습니다");
  await expect(page.getByLabel("회원 현황")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("revoked grant clears previously loaded data on refresh", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("member1@example.invalid", { exact: true })).toBeVisible();
  state.denied = true;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("접근 권한이 없습니다");
  await expect(page.getByText("member1@example.invalid", { exact: true })).toHaveCount(0);
});

test("audit preserves ledger values and never sends a reset or member mutation", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "관리자 변경 기록", exact: true }).click();
  await expect(page.getByRole("cell", { name: "100 → 125", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "한도 변경", exact: true })).toBeVisible();
  expect(state.requests.every(request => request.method === "GET")).toBeTruthy();
});

test("mobile layout stays within viewport and explicitly shows missing historical logins", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await page.getByLabel("계정 상태").selectOption("DISABLED");
  await expect(page.getByText("1 / 1 페이지 · 총 1건")).toBeVisible();
  await expect(page.getByRole("cell", { name: "기록 없음", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: "outputs/admin-members-mobile.png", fullPage: true });
});

test("late response cannot restore account data after session loss", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("member1@example.invalid", { exact: true })).toBeVisible();
  let release;
  state.blockNext = new Promise(resolve => { release = resolve; });
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByText("불러오는 중…", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.removeItem("freelance-ops-session-v1");
    window.dispatchEvent(new CustomEvent("freelance-ops-session-recovery", { detail: null }));
  });
  release();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByLabel("회원 현황")).toHaveCount(0);
});
