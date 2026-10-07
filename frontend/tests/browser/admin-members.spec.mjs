import { test, expect } from "@playwright/test";

const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const session = { userId: "synthetic-admin", workspaceId: "synthetic-space", accessToken: "synthetic-token", refreshToken: "synthetic-refresh", accessTokenExpiresAt: "2099-01-01T00:00:00Z", refreshTokenExpiresAt: "2099-01-01T00:00:00Z", tokenType: "Bearer" };
const member = index => ({ id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`, email: `member${index}@example.invalid`, displayName: `가상 회원 ${index}`, status: index === 2 ? "DISABLED" : "ACTIVE", emailVerificationRequired: false, emailVerifiedAt: null, joinedAt: "2026-10-05T00:00:00Z", lastLoginAt: index === 1 ? "2026-10-05T01:00:00Z" : null });

async function fixture(page, denied = false) {
  const state = { denied, deniedUsage: false, requests: [], blockNext: null, blockUsage: null };
  await page.addInitScript(value => sessionStorage.setItem("freelance-ops-session-v1", JSON.stringify(value)), session);
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route("**/api/v2/admin/**", async route => {
    const url = new URL(route.request().url());
    state.requests.push({ path: url.pathname, method: route.request().method(), query: Object.fromEntries(url.searchParams) });
    if (state.denied) return route.fulfill({ status: 403, json: { message: "Forbidden" } });
    const recordingStartedAt = "2026-10-05T00:00:00Z";
    const pageNumber = Number(url.searchParams.get("page") ?? 0);
    if (/\/members\/[^/]+\/ai-usage(?:\/history)?$/.test(url.pathname)) {
      if (state.deniedUsage) return route.fulfill({ status: 403, json: { message: "Forbidden" } });
      if (state.blockUsage) { const block = state.blockUsage; state.blockUsage = null; await block; }
      if (url.pathname.endsWith("/history")) return route.fulfill({ json: url.searchParams.has("cursor") ? {
        items: [{ runId: "deleted-run", model: "gpt-6-astra", status: "DELETED", startedAt: "2026-10-04T01:00:00Z", platformCostUsd: 0.00999999, platformReservedUsd: 0, usageKnown: true, byokInputTokens: 0, byokOutputTokens: 0 }], nextCursor: null
      } : {
        items: [{ runId: "unknown-run", model: "gpt-6.1-sol", status: "FAILED", startedAt: "2026-10-05T01:00:00Z", platformCostUsd: 0.00000001, platformReservedUsd: 0.12345678, usageKnown: false, byokInputTokens: 1234, byokOutputTokens: 56 }], nextCursor: "opaque+cursor/=fixture"
      } }).catch(() => {});
      return route.fulfill({ json: { currency: "USD", limitUsd: 1.25, settledUsd: 0.01, reservedUsd: 0.12345678, remainingUsd: 1.11654322, remainingPercent: 89.3234, reservedPercent: 9.8765, periodStart: "2026-10-05", resetAt: "2026-10-11T15:00:00Z", timezone: "Asia/Seoul", spendingEnabled: false, models: [] } }).catch(() => {});
    }
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


test("selected member ledger keeps sub-cent USD, unknown holds, BYOK and cursor history distinct", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "member1@example.invalid 실제 비용", exact: true }).click();
  await expect(page.getByRole("heading", { name: "가상 회원 1의 실제 비용" })).toBeVisible();
  await expect(page.getByLabel("회원 USD 사용량")).toContainText("$1.11654322");
  await expect(page.getByRole("cell", { name: "$0.00000001", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "확인 대기 · 예약 유지", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /1,234 \/ 56/ })).toContainText("미확정 토큰 포함 가능");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByText("2 페이지 · 최신 실행부터")).toBeVisible();
  await expect(page.getByText("삭제된 실행 · 비용 기록 유지", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  expect(state.requests.some(request => request.path.endsWith("ai-usage/history") && request.query.cursor === "opaque+cursor/=fixture")).toBeTruthy();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(page.getByText("1 페이지 · 최신 실행부터")).toBeVisible();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByText("2 페이지 · 최신 실행부터")).toBeVisible();
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByText("1 페이지 · 최신 실행부터")).toBeVisible();
  const usageRequests = state.requests.filter(request => request.path.includes("/ai-usage"));
  expect(usageRequests.every(request => request.path.includes(`/members/${member(1).id}/`) && request.method === "GET")).toBeTruthy();
  expect(state.requests.every(request => request.method === "GET")).toBeTruthy();
});

test("a ledger authorization failure clears the snapshot, history and previously visible statistics", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "member2@example.invalid 실제 비용", exact: true }).click();
  await expect(page.getByLabel("회원 USD 사용량")).toBeVisible();
  state.deniedUsage = true;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.locator("main [role=alert]")).toContainText("접근 권한이 없습니다");
  await expect(page.getByLabel("회원 USD 사용량")).toHaveCount(0);
  await expect(page.getByLabel("회원 현황")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("member2@example.invalid", { exact: true })).toHaveCount(0);
});

test("leaving the selected member ignores a late cost response and mobile USD stays inside the viewport", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "member1@example.invalid 실제 비용", exact: true }).click();
  await expect(page.getByLabel("회원 USD 사용량")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: "outputs/admin-member-usage-mobile.png", fullPage: true });
  let release;
  state.blockUsage = new Promise(resolve => { release = resolve; });
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByText("불러오는 중…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "회원 목록으로", exact: true }).click();
  release();
  await expect(page.getByText("member1@example.invalid", { exact: true })).toBeVisible();
  await expect(page.getByLabel("회원 USD 사용량")).toHaveCount(0);
  await expect(page.getByLabel("회원 비용 기록")).toHaveCount(0);
});

test("session loss during ledger refresh cannot restore a selected member or costs", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/admin/members", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "member1@example.invalid 실제 비용", exact: true }).click();
  await expect(page.getByLabel("회원 USD 사용량")).toBeVisible();
  let release;
  state.blockUsage = new Promise(resolve => { release = resolve; });
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByText("불러오는 중…", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.removeItem("freelance-ops-session-v1");
    window.dispatchEvent(new CustomEvent("freelance-ops-session-recovery", { detail: null }));
  });
  release();
  await expect(page.getByLabel("회원 USD 사용량")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("member1@example.invalid", { exact: true })).toHaveCount(0);
});
