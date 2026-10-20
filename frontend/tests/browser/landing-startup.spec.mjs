import { test as base, expect } from "@playwright/test";

const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const test = base.extend({
  page: async ({ page }, runTest) => {
    const unexpected = [];
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
      unexpected.push(`${route.request().method()} ${url.pathname}`);
      return route.abort();
    });
    await runTest(page);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  }
});

test.use({ viewport: { width: 1440, height: 900 } });

test("늦게 도착한 스크립트가 이미 표시된 제목과 버튼을 다시 가리지 않는다", async ({ page }) => {
  let release;
  const scripts = new Promise(resolve => { release = resolve; });
  await page.route(/\.js(?:\?|$)/, async route => { await scripts; return route.fallback(); });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(page.locator("h1")).toBeVisible();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName("first-contentful-paint").length)).toBeGreaterThan(0);
    await page.evaluate(() => {
      window.__entranceRehidContent = false;
      const intro = document.querySelector("[data-story-intro]");
      const content = [document.querySelector("h1"), document.querySelector(".nav-shell")];
      const observer = new MutationObserver(() => {
        if (intro.style.display === "block" || content.some(element => Number(element.style.opacity || 1) < .99))
          window.__entranceRehidContent = true;
      });
      [intro, ...content].forEach(element => observer.observe(element, { attributes: true, attributeFilter: ["style"] }));
    });
    release();
    await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-ready", "true");
    expect(await page.evaluate(() => window.__entranceRehidContent)).toBe(false);
    await expect(page.locator("h1")).toHaveCSS("opacity", "1");
    await expect(page.locator(".nav-shell")).toHaveCSS("opacity", "1");
    await expect(page.locator("[data-story-intro]")).toBeHidden();
  } finally {
    release();
  }
});

async function holdSceneStartup(page) {
  await page.addInitScript(() => {
    window.__sceneIdle = new Map();
    window.__gpuContexts = 0;
    let next = 1_000_000;
    const request = window.requestIdleCallback?.bind(window);
    const cancel = window.cancelIdleCallback?.bind(window);
    window.requestIdleCallback = (callback, options) => {
      if (options?.timeout !== 1200 && request) return request(callback, options);
      window.__sceneIdle.set(++next, callback);
      return next;
    };
    window.cancelIdleCallback = id => {
      if (!window.__sceneIdle.delete(id)) cancel?.(id);
    };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/webgl/.test(type)) window.__gpuContexts++;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto("/");
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-ready", "true");
  await expect.poll(() => page.evaluate(() => window.__sceneIdle.size)).toBeGreaterThan(0);
}

test("GPU 준비를 기다리는 동안에도 첫 화면과 언어 선택을 사용할 수 있다", async ({ page }) => {
  await holdSceneStartup(page);
  expect(await page.evaluate(() => window.__gpuContexts)).toBe(0);
  await expect(page.locator("h1")).toBeVisible();
  await page.locator(".home-language-trigger").click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => window.__gpuContexts)).toBe(0);
  await page.evaluate(() => {
    const callbacks = [...window.__sceneIdle.values()];
    window.__sceneIdle.clear();
    callbacks.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 }));
  });
  // 교차 관찰 순서는 브라우저마다 달라질 수 있으므로 먼저 준비된 장면을 확인한다.
  await expect.poll(() => page.locator(".webgl-scene, .spatial-flow").evaluateAll(scenes =>
    scenes.some(scene => /^(ready|fallback)$/.test(scene.dataset.webglState ?? scene.dataset.workflowState ?? ""))
  ), { timeout: 20_000 }).toBe(true);
  expect(await page.evaluate(() => window.__gpuContexts)).toBeGreaterThan(0);
});

test("숨겨진 탭은 대기 중인 GPU 준비를 취소하고 복귀한 뒤 다시 예약한다", async ({ page }) => {
  await holdSceneStartup(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => window.__sceneIdle.size)).toBe(0);
  expect(await page.evaluate(() => window.__gpuContexts)).toBe(0);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => window.__sceneIdle.size)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__gpuContexts)).toBe(0);
});

for (const language of ["ko", "en"]) {
  for (const section of ["review", "evidence"]) {
    test(`${language} #${section} 첫 진입과 새로고침은 초기화가 끝난 뒤에도 제목 위치를 유지한다`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
      await page.goto(`/#${section}`);
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-ready", "true");
        await expect.poll(() => page.locator(`#${section}-title`).evaluate(element => {
          const heading = element.getBoundingClientRect();
          const nav = document.querySelector(".nav-shell").getBoundingClientRect();
          return heading.top >= nav.bottom + 8 && heading.bottom <= innerHeight;
        })).toBe(true);
        await expect(page).toHaveURL(new RegExp(`#${section}$`));
      }
    });
  }
}
