import { test, expect } from "@playwright/test";
import { localeStorageKey } from "../../app/lib/ui-locale.mjs";

const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const motionSource = "/login/pet-path-motion-v1.mp4";
const motionPoster = "/login/pet-path-motion-poster-v1.webp";
const staticPoster = "/login/pet-path-poster-v1.webp";

async function expectPoster(page, source) {
  const poster = page.locator(".auth-backdrop__poster");
  await expect(poster).toHaveAttribute("src", source);
  await expect(poster).toBeVisible();
  await expect.poll(() => poster.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
}

async function expectMotionControl(page, { paused = false } = {}) {
  const control = page.locator(".auth-backdrop__toggle");
  await expect(control).toHaveCount(1);
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await expect(control).toHaveAttribute("type", "button");
  await expect(control).toHaveText(paused ? /^▶\uFE0F?$/u : /^⏸\uFE0F?$/u);
  const label = await control.getAttribute("aria-label");
  expect(label?.trim().length).toBeGreaterThan(0);
  await expect(control).toHaveAccessibleName(label);
  await expect(control).toHaveAttribute("title", label);
  const bounds = await control.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(bounds.width).toBeLessThanOrEqual(64);
  expect(bounds.height).toBeLessThanOrEqual(64);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x).toBeLessThan(80);
  if (viewport.width <= 760) {
    // On narrow overflowing forms the control docks beside the document footer,
    // not over an input. A fitting page still places it at the viewport bottom.
    await expect(control).toHaveCSS("position", "absolute");
    const root = await page.locator(".auth-page.auth-cinematic").boundingBox();
    const bottomInset = await control.evaluate(element => Number.parseFloat(getComputedStyle(element).bottom));
    expect(Math.abs(root.y + root.height - bounds.y - bounds.height - bottomInset)).toBeLessThanOrEqual(1);
  } else {
    await expect(control).toHaveCSS("position", "fixed");
    expect(bounds.y).toBeGreaterThanOrEqual(viewport.height - 100);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  }
  return control;
}

async function setDocumentHidden(page, hidden) {
  await page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
async function expectNaturalPanel(page) {
  for (const selector of [".auth-panel", ".auth-panel form", ".auth-fields"]) {
    const area = page.locator(selector);
    await expect(area).toHaveCSS("overflow-y", "visible");
    await expect(area).toHaveCSS("max-height", "none");
    expect(await area.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  }
}

async function expectCenteredFooter(page, { locale, fitsViewport = false } = {}) {
  const footer = page.locator(".auth-footer");
  const notices = footer.getByRole("link", { name: locale === "en" ? "Operational notices" : "운영 공지", exact: true });
  await expect(footer).toHaveCount(1);
  await expect(footer).toHaveText(locale === "en"
    ? "A clearer view of your work. Freelance Ops · Operational notices"
    : "내 일을 더 선명하게. Freelance Ops · 운영 공지");
  await expect(footer).toHaveCSS("text-align", "center");
  await expect(footer).toHaveCSS("position", "static");
  await expect(notices).toHaveAttribute("href", "/notices");
  await page.evaluate(() => document.fonts.ready);

  const geometry = await footer.evaluate(element => {
    // Measure the visible text, not just the paragraph box: a centered wide box
    // with right-aligned text would otherwise pass a bounding-box-only check.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const fragments = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent ?? "";
      const start = text.search(/\S/u);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, text.trimEnd().length);
      fragments.push(...Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0));
    }
    const root = element.closest(".auth-page");
    const scroll = document.scrollingElement;
    const toggle = document.querySelector(".auth-backdrop__toggle");
    return {
      footer: element.getBoundingClientRect().toJSON(),
      panel: document.querySelector(".auth-panel").getBoundingClientRect().toJSON(),
      toggle: toggle?.getBoundingClientRect().toJSON() ?? null,
      textLeft: Math.min(...fragments.map(rect => rect.left)),
      textRight: Math.max(...fragments.map(rect => rect.right)),
      fragmentCount: fragments.length,
      paddingBottom: Number.parseFloat(getComputedStyle(root).paddingBottom),
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: innerHeight,
      scrollWidth: scroll.scrollWidth,
      scrollHeight: scroll.scrollHeight,
      scrollY,
    };
  });

  expect(geometry.fragmentCount).toBeGreaterThan(0);
  const center = geometry.viewportWidth / 2;
  expect(Math.abs((geometry.footer.left + geometry.footer.right) / 2 - center), "footer box is centered in the screen").toBeLessThanOrEqual(1);
  expect(Math.abs((geometry.textLeft + geometry.textRight) / 2 - center), "rendered footer copy is visually centered").toBeLessThanOrEqual(3);
  expect(geometry.footer.left).toBeGreaterThanOrEqual(0);
  expect(geometry.footer.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.textLeft).toBeGreaterThanOrEqual(geometry.footer.left - 1);
  expect(geometry.textRight).toBeLessThanOrEqual(geometry.footer.right + 1);
  expect(geometry.scrollWidth - geometry.viewportWidth, "the document has no horizontal crop").toBeLessThanOrEqual(1);
  expect(geometry.footer.top - geometry.panel.bottom, "footer follows the form without overlap").toBeGreaterThanOrEqual(7);
  expect(geometry.paddingBottom, "footer has comfortable bottom safe-area spacing").toBeGreaterThanOrEqual(24);
  expect(Math.abs(geometry.scrollHeight - (geometry.footer.bottom + geometry.scrollY) - geometry.paddingBottom), "footer stays at the document bottom").toBeLessThanOrEqual(2);
  if (geometry.toggle) {
    expect(geometry.footer.left - geometry.toggle.right, "centered footer leaves clearance beside the motion control").toBeGreaterThanOrEqual(7);
  }
  if (fitsViewport) {
    expect(geometry.scrollHeight - geometry.viewportHeight, "a fitting login screen needs no page scroll").toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.viewportHeight - geometry.footer.bottom - geometry.paddingBottom), "fitting footer sits near the screen bottom").toBeLessThanOrEqual(2);
    await expect(footer).toBeInViewport({ ratio: 1 });
  }
  return notices;
}

async function openAuth(page, { locale = "ko", theme = "light", reduced = false, invalidVideo = false } = {}) {
  const blocked = [];
  page.on("pageerror", error => blocked.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (invalidVideo && url.origin === origin && url.pathname === "/login/pet-path-motion-v1.mp4") return route.fulfill({ status: 200, contentType: "video/mp4", body: "synthetic invalid media" });
    if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
    blocked.push(url.pathname); return route.abort();
  });
  await page.addInitScript(({ theme, locale, key }) => {
    localStorage.setItem("theme", theme); localStorage.setItem(key, locale);
  }, { theme, locale, key: localeStorageKey });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.goto("/workspace/projects");
  await expect(page.locator(".auth-layout")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".auth-layout")).toHaveCSS("border-left-width", "0px");
  await expect(page.locator(".auth-layout")).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".auth-header button, .auth-header select")).toHaveCount(0);
  await expect(page.locator(".auth-header a")).toHaveCount(1);
  await expect(page.locator(".auth-brand")).toHaveAttribute("href", "/");
  return blocked;
}

for (const theme of ["light", "dark"]) {
  test(`desktop ${theme}: scene stays exposed, right form has no nested scrollbar, header has only brand`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const blocked = await openAuth(page, { theme });
    await expect.poll(() => page.locator(".auth-backdrop__poster").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    const panel = await page.locator(".auth-panel").boundingBox();
    const message = await page.locator(".auth-scene-space").boundingBox();
    expect(panel.x).toBeGreaterThan(1440 * .55);
    expect(message.x + message.width).toBeLessThan(panel.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(1440);
    expect(panel.y + panel.height).toBeLessThanOrEqual(900);
    await expectNaturalPanel(page);
    await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "playing");
    await expect(page.locator(".auth-backdrop video")).toBeVisible();
    await expect(page.locator(".auth-backdrop video source")).toHaveCount(1);
    await expect(page.locator(".auth-backdrop video source")).toHaveAttribute("src", motionSource);
    await expect(page.locator(".auth-backdrop video")).toHaveAttribute("poster", motionPoster);
    await expectMotionControl(page);
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "업무 공간 열기", exact: true })).toBeVisible();
    await page.screenshot({ path: `outputs/ui-ux/login-cinematic-${theme}-desktop.png`, fullPage: true });
    expect(blocked).toEqual([]);
  });
}

for (const locale of ["ko", "en"]) {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390]]) {
    test(`form-first ${locale} ${width}x${height}: page scrolling keeps signup and keyboard controls reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const blocked = await openAuth(page, { locale, reduced: true });
      const heading = locale === "en" ? "Welcome back." : "다시 만나 반가워요.";
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await expectNaturalPanel(page);
      await page.locator('input[name="email"]').fill("fixture@example.invalid");
      await page.locator('input[name="password"]').fill("synthetic-password-only");
      await page.getByRole("tab", { name: locale === "en" ? "Sign up" : "처음 시작하기", exact: true }).click();
      await expect(page.locator('input[name="ageAtLeast14"]')).not.toBeChecked();
      await page.locator('input[name="passwordConfirm"]').scrollIntoViewIfNeeded();
      await expect(page.locator('input[name="passwordConfirm"]')).toBeVisible();
      await expectNaturalPanel(page);
      await page.locator('button[type="submit"]').scrollIntoViewIfNeeded();
      await expect(page.locator('button[type="submit"]')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.getByRole("tab", { name: locale === "en" ? "Log in" : "로그인", exact: true }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.locator(".auth-backdrop video")).toBeHidden();
      await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
      await expectPoster(page, staticPoster);
      await page.screenshot({ path: `outputs/ui-ux/login-cinematic-${locale}-${width}x${height}.png`, fullPage: true });
      expect(blocked).toEqual([]);
    });
  }
}

for (const locale of ["ko", "en"]) {
  for (const [width, height] of [[1440, 900], [320, 568], [390, 844], [844, 390], [390, 420]]) {
    test(`centered footer ${locale} ${width}x${height}: bottom placement and signup scrolling preserve both controls`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const blocked = await openAuth(page, { locale });
      const backdrop = page.locator(".auth-backdrop");
      await expect(backdrop).toHaveAttribute("data-media-state", "playing");
      const control = await expectMotionControl(page);
      await control.click();
      await expect(backdrop).toHaveAttribute("data-media-state", "paused");
      await expectPoster(page, staticPoster);
      await expectNaturalPanel(page);
      await expectCenteredFooter(page, { locale, fitsViewport: height >= 844 });
      await page.screenshot({ path: `outputs/ui-ux/login-footer-centered-${locale}-${width}x${height}.png`, fullPage: true });

      await page.getByRole("tab", { name: locale === "en" ? "Sign up" : "처음 시작하기", exact: true }).click();
      await expect(page.locator('input[name="ageAtLeast14"]')).not.toBeChecked();
      await expectNaturalPanel(page);
      if (width <= 900) {
        expect(await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight), "tall signup content scrolls at document level").toBeGreaterThan(0);
      }
      const confirmPassword = page.locator('input[name="passwordConfirm"]');
      await confirmPassword.scrollIntoViewIfNeeded();
      await confirmPassword.focus();
      await expect(confirmPassword).toBeFocused();
      await expect(confirmPassword).toBeInViewport();
      const submit = page.locator('button[type="submit"]');
      await submit.scrollIntoViewIfNeeded();
      await expect(submit).toBeInViewport();
      const submitBounds = await submit.boundingBox();
      const toggleBounds = await control.boundingBox();
      expect(submitBounds.y + submitBounds.height <= toggleBounds.y || toggleBounds.y + toggleBounds.height <= submitBounds.y
        || submitBounds.x + submitBounds.width <= toggleBounds.x || toggleBounds.x + toggleBounds.width <= submitBounds.x,
      "signup submit is not covered by the motion control").toBe(true);

      const notices = await expectCenteredFooter(page, { locale });
      await notices.scrollIntoViewIfNeeded();
      await expect(notices).toBeInViewport({ ratio: 1 });
      await notices.click({ trial: true });
      await notices.focus();
      await expect(notices).toBeFocused();
      await expectCenteredFooter(page, { locale });
      await expectMotionControl(page, { paused: true });
      await expect(backdrop).toHaveAttribute("data-media-state", "paused");
      if (width <= 900) {
        expect(await page.evaluate(() => scrollY), "footer is reached by scrolling the document").toBeGreaterThan(0);
      }

      await page.getByRole("tab", { name: locale === "en" ? "Log in" : "로그인", exact: true }).click();
      await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: "instant" }));
      await expectNaturalPanel(page);
      await expectCenteredFooter(page, { locale, fitsViewport: height >= 844 });
      await expectPoster(page, staticPoster);
      await expectMotionControl(page, { paused: true });
      await control.focus();
      await page.keyboard.press("Space");
      await expect(backdrop).toHaveAttribute("data-media-state", "playing");
      await page.keyboard.press("Space");
      await expect(backdrop).toHaveAttribute("data-media-state", "paused");
      await expectPoster(page, staticPoster);
      await expectCenteredFooter(page, { locale });
      expect(blocked).toEqual([]);
    });
  }
}

test("project brand returns to home without submitting the login form", async ({ page }) => {
  const blocked = await openAuth(page);
  await page.locator(".auth-brand").click();
  await expect(page).toHaveURL(`${origin}/`);
  expect(blocked).toEqual([]);
});

test("one muted inline decoder plays, pauses across form changes, resumes, and wraps", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const blocked = await openAuth(page);
  const video = page.locator(".auth-backdrop video");
  const backdrop = page.locator(".auth-backdrop");
  await expect(backdrop).toHaveAttribute("data-media-state", "playing");
  expect(await video.evaluate(element => ({ muted: element.muted, inline: element.playsInline, loop: element.loop, width: element.videoWidth, height: element.videoHeight })))
    .toEqual({ muted: true, inline: true, loop: true, width: 1280, height: 720 });
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(.15);
  await page.locator(".auth-backdrop__toggle").click();
  await expect(backdrop).toHaveAttribute("data-media-state", "paused");
  await expect(video).toBeHidden();
  await expectPoster(page, staticPoster);
  await expectMotionControl(page, { paused: true });
  await page.screenshot({ path: "outputs/ui-ux/login-motion-manually-paused-original-still.png", fullPage: true });
  await page.locator('input[name="email"]').fill("fixture@example.invalid");
  await page.getByRole("tab", { name: "처음 시작하기", exact: true }).click();
  await expect(backdrop).toHaveAttribute("data-media-state", "paused");
  await expectPoster(page, staticPoster);
  await page.getByRole("tab", { name: "로그인", exact: true }).click();
  await expect(backdrop).toHaveAttribute("data-media-state", "paused");
  await expectMotionControl(page, { paused: true });
  await page.locator(".auth-backdrop__toggle").click();
  await expect(backdrop).toHaveAttribute("data-media-state", "playing");
  await expect(video.locator("source")).toHaveAttribute("src", motionSource);
  await expectMotionControl(page);
  await video.evaluate(element => { element.currentTime = element.duration - .12; });
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(1);
  await expect(backdrop).toHaveAttribute("data-media-state", "playing");
  await expect(video).toHaveCount(1);
  await expect(video.locator("source")).toHaveCount(1);
  expect(blocked).toEqual([]);
});

test("reduced motion avoids video bytes and changing the preference unloads the decoder", async ({ page }) => {
  const downloads = [];
  page.on("request", request => { if (request.url().endsWith(".mp4")) downloads.push(request.url()); });
  const blocked = await openAuth(page, { reduced: true });
  const backdrop = page.locator(".auth-backdrop");
  await expect(backdrop).toHaveAttribute("data-media-state", "disabled");
  await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
  await expect(page.locator(".auth-backdrop__toggle")).toHaveCount(0);
  await expectPoster(page, staticPoster);
  expect(downloads).toEqual([]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(backdrop).toHaveAttribute("data-media-state", "playing");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(backdrop).toHaveAttribute("data-media-state", "disabled");
  await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
  await expectPoster(page, staticPoster);
  expect(blocked).toEqual([]);
});

test("data saving keeps the original approved still and performs no video request", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { configurable: true, value: Object.assign(new EventTarget(), { saveData: true }) });
  });
  const downloads = [];
  page.on("request", request => { if (request.url().endsWith(".mp4")) downloads.push(request.url()); });
  const blocked = await openAuth(page);
  await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "disabled");
  await expect(page.locator(".auth-backdrop video source")).toHaveCount(0);
  await expect(page.locator(".auth-backdrop__toggle")).toHaveCount(0);
  await expectPoster(page, staticPoster);
  expect(downloads).toEqual([]);
  expect(blocked).toEqual([]);
});

test("autoplay refusal keeps the original approved still and permits one explicit user retry", async ({ page }) => {
  await page.addInitScript(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    let refused = false;
    HTMLMediaElement.prototype.play = function () {
      if (!refused) { refused = true; return Promise.reject(new DOMException("Synthetic autoplay refusal", "NotAllowedError")); }
      return nativePlay.call(this);
    };
  });
  const blocked = await openAuth(page);
  await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "blocked");
  await expect(page.locator(".auth-backdrop video")).toBeHidden();
  await expectPoster(page, staticPoster);
  await expectMotionControl(page, { paused: true });
  await page.locator(".auth-backdrop__toggle").click();
  await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "playing");
  expect(blocked).toEqual([]);
});

test("unreadable video retains the poster and working login controls", async ({ page }) => {
  const blocked = await openAuth(page, { invalidVideo: true });
  await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "error");
  await expect(page.locator(".auth-backdrop__toggle")).toHaveCount(0);
  await expect(page.locator(".auth-backdrop video")).toBeHidden();
  await expectPoster(page, staticPoster);
  await page.locator('input[name="email"]').fill("fixture@example.invalid");
  await expect(page.locator('input[name="email"]')).toHaveValue("fixture@example.invalid");
  expect(blocked).toEqual([]);
});

test("offscreen decorative video pauses and resumes when visible again", async ({ page }) => {
  const blocked = await openAuth(page);
  const backdrop = page.locator(".auth-backdrop");
  await expect(backdrop).toHaveAttribute("data-media-state", "playing");
  await page.locator(".auth-backdrop__visual").evaluate(element => { element.style.transform = "translateY(200vh)"; });
  await expect(backdrop).toHaveAttribute("data-media-state", "paused");
  await expect(page.locator(".auth-backdrop__poster")).toHaveAttribute("src", motionPoster);
  await expectMotionControl(page);
  await page.locator(".auth-backdrop__visual").evaluate(element => { element.style.transform = ""; });
  await expect(backdrop).toHaveAttribute("data-media-state", "playing");
  expect(blocked).toEqual([]);
});

test("mobile motion control stays reachable without obscuring the signup submit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  const blocked = await openAuth(page);
  await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "playing");
  await page.getByRole("tab", { name: "처음 시작하기", exact: true }).click();
  const submit = page.locator('button[type="submit"]');
  await submit.scrollIntoViewIfNeeded();
  const formBounds = await submit.boundingBox();
  const control = await expectMotionControl(page);
  const toggleBounds = await control.boundingBox();
  expect(formBounds.y + formBounds.height <= toggleBounds.y || toggleBounds.y + toggleBounds.height <= formBounds.y).toBe(true);
  await expectNaturalPanel(page);
  await expect(submit).toBeInViewport();
  await page.locator(".auth-backdrop__toggle").click();
  await expect(page.locator(".auth-backdrop")).toHaveAttribute("data-media-state", "paused");
  await expectPoster(page, staticPoster);
  await expectMotionControl(page, { paused: true });
  await page.screenshot({ path: "outputs/ui-ux/login-motion-mobile-short-height.png", fullPage: true });
  expect(blocked).toEqual([]);
});

for (const locale of ["ko", "en"]) {
  test(`one emoji-only ${locale} control has a tooltip, touch target and keyboard pause/play`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const blocked = await openAuth(page, { locale });
    const backdrop = page.locator(".auth-backdrop");
    await expect(backdrop).toHaveAttribute("data-media-state", "playing");
    const control = await expectMotionControl(page);
    const pauseLabel = await control.getAttribute("aria-label");
    await control.focus();
    await expect(control).toBeFocused();
    await page.keyboard.press("Space");
    await expect(backdrop).toHaveAttribute("data-media-state", "paused");
    await expectPoster(page, staticPoster);
    await expectMotionControl(page, { paused: true });
    expect(await control.getAttribute("aria-label")).not.toBe(pauseLabel);
    await page.keyboard.press("Enter");
    await expect(backdrop).toHaveAttribute("data-media-state", "playing");
    await expectMotionControl(page);
    await expect(control).toHaveAttribute("aria-label", pauseLabel);
    await expect(page.locator(".auth-backdrop video source")).toHaveAttribute("src", motionSource);
    expect(blocked).toEqual([]);
  });
}

test("explicit still mode survives visibility and offscreen pauses until play is requested", async ({ page }) => {
  const blocked = await openAuth(page);
  const backdrop = page.locator(".auth-backdrop");
  const visual = page.locator(".auth-backdrop__visual");
  const video = page.locator(".auth-backdrop video");
  await expect(backdrop).toHaveAttribute("data-media-state", "playing");
  // An automatic suspension retains the matching video poster and pause action.
  await setDocumentHidden(page, true);
  await expect(backdrop).toHaveAttribute("data-media-state", "paused");
  await expectPoster(page, motionPoster);
  await expectMotionControl(page);
  await setDocumentHidden(page, false);
  await expect(backdrop).toHaveAttribute("data-media-state", "playing");
  await page.locator(".auth-backdrop__toggle").click();
  await expect(backdrop).toHaveAttribute("data-media-state", "paused");
  await expectPoster(page, staticPoster);
  await visual.evaluate(element => new Promise(resolve => {
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) { observer.disconnect(); resolve(); }
    });
    observer.observe(element);
    element.style.transform = "translateY(200vh)";
  }));
  await setDocumentHidden(page, true);
  await setDocumentHidden(page, false);
  await visual.evaluate(element => { element.style.transform = ""; });
  await expect(visual).toBeInViewport();
  await expectPoster(page, staticPoster);
  await expect(backdrop).toHaveAttribute("data-media-state", "paused");
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true);
  await expectMotionControl(page, { paused: true });
  await page.locator(".auth-backdrop__toggle").click();
  await expect(backdrop).toHaveAttribute("data-media-state", "playing");
  await expect(video.locator("source")).toHaveAttribute("src", motionSource);
  expect(blocked).toEqual([]);
});
