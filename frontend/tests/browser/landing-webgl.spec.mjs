import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 1000 } });

async function openScene(page, reduced = false) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /THREE|WebGL|hydrated/.test(message.text())) errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.goto("/");
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-ready", "true");
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

async function workflowReady(page) {
  const flow = page.locator(".spatial-flow");
  await flow.scrollIntoViewIfNeeded();
  await expect(flow).toHaveAttribute("data-workflow-state", "ready", { timeout: 20_000 });
  return flow;
}

async function expectStopped(flow) {
  await expect(flow).toHaveAttribute("data-workflow-running", "false");
  await expect.poll(async () => {
    const frames = await flow.getAttribute("data-workflow-frames");
    await new Promise(resolve => setTimeout(resolve, 200));
    return await flow.getAttribute("data-workflow-frames") === frames;
  }).toBe(true);
}

test("real workflow meshes retain native stage controls and move one project to its actual lane", async ({ page }) => {
  const errors = await openScene(page, true);
  const flow = await workflowReady(page);
  for (const name of ["문의", "요구사항", "리스크", "견적", "제안"]) {
    const stage = page.getByRole("button", { name, exact: true });
    await stage.click();
    await expect(stage).toHaveAttribute("aria-pressed", "true");
    await expect(flow.locator(".spatial-project-card")).toHaveCount(1);
    await expect(flow.locator(".spatial-project-card")).toHaveAttribute("aria-label", `${name} 예시 결과`);
  }
  await expect(flow).toHaveAttribute("data-column", "1");
  const location = await flow.evaluate(host => {
    const card = host.querySelector(".spatial-project-card").getBoundingClientRect();
    const lane = host.querySelectorAll(".spatial-lane")[1].getBoundingClientRect();
    const center = (card.left + card.right) / 2;
    return center > lane.left && center < lane.right;
  });
  expect(location).toBe(true);
  const projections = await flow.locator(".spatial-stage, .spatial-project-card").evaluateAll(elements => elements.map(element => {
    const m = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Number.isFinite(m.m41) && Math.abs(m.m14) > .000001;
  }));
  expect(projections.every(Boolean)).toBe(true);
  await flow.screenshot({ path: "outputs/webgl/workflow-desktop.png" });
  expect(errors).toEqual([]);
});

test("automatic transfer lifts the same project through the 3D scene", async ({ page }) => {
  const errors = await openScene(page);
  const flow = await workflowReady(page);
  await page.mouse.move(10, 10);
  const card = flow.locator(".spatial-project-card");
  await card.evaluate(element => {
    window.__workflowTransfers = [];
    window.__workflowCard = element;
    new MutationObserver(() => window.__workflowTransfers.push(element.dataset.transferState)).observe(element, { attributes: true, attributeFilter: ["data-transfer-state"] });
  });
  await expect(flow).toHaveAttribute("data-column", "1", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => window.__workflowTransfers.includes("travelling"))).toBe(true);
  await expect(card).toHaveAttribute("data-transfer-state", "settled");
  expect(await card.evaluate(element => window.__workflowCard === element)).toBe(true);
  await expect(card).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("projected stage buttons retain keyboard order and activation", async ({ page }) => {
  const errors = await openScene(page, true);
  await workflowReady(page);
  await page.getByRole("button", { name: "문의", exact: true }).focus();
  await page.keyboard.press("Tab");
  const next = page.getByRole("button", { name: "요구사항", exact: true });
  await expect(next).toBeFocused();
  await page.keyboard.press("Space");
  await expect(next).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("offscreen and hidden tabs stop rendering, then returning resumes it", async ({ page }) => {
  const errors = await openScene(page);
  const flow = await workflowReady(page);
  await page.mouse.move(10, 10);
  await expect(flow).toHaveAttribute("data-workflow-running", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectStopped(flow);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(flow).toHaveAttribute("data-workflow-running", "true");
  await page.locator("#scope-comparison").scrollIntoViewIfNeeded();
  await expectStopped(flow);
  await flow.scrollIntoViewIfNeeded();
  await expect(flow).toHaveAttribute("data-workflow-running", "true");
  expect(errors).toEqual([]);
});

test("reduced motion keeps a static 3D scene and redraws explicit stage/locale changes", async ({ page }) => {
  const errors = await openScene(page, true);
  const flow = await workflowReady(page);
  await expectStopped(flow);
  await page.locator(".home-language-trigger").click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Inquiry", exact: true }).click();
  await expect(flow).toHaveAttribute("data-column", "0");
  await expect(flow.locator(".spatial-project-card")).toHaveAttribute("aria-label", "Inquiry sample results");
  await expectStopped(flow);
  expect(errors).toEqual([]);
});

test("unavailable GPU preserves all readable controls and the original card movement", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/webgl/.test(type)) return null;
      return original.call(this, type, ...args);
    };
  });
  await openScene(page, true);
  const flow = page.locator(".spatial-flow");
  await expect(flow).toHaveAttribute("data-workflow-state", "fallback");
  await expect(flow.locator(".spatial-graph-wires")).toBeVisible();
  await page.getByRole("button", { name: "문의", exact: true }).click();
  await page.getByRole("button", { name: "제안", exact: true }).click();
  await expect(flow).toHaveAttribute("data-column", "1");
  await expect(flow.locator(".inquiry-liquid-shell")).toBeVisible();
});

test("context loss restores CSS controls and releases their camera projection", async ({ page }) => {
  await openScene(page, true);
  const flow = await workflowReady(page);
  await flow.locator("canvas").evaluate(canvas => canvas.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
  await expect(flow).toHaveAttribute("data-workflow-state", "fallback");
  await expect(flow.locator(".spatial-graph-wires")).toBeVisible();
  expect(await flow.locator(".spatial-stage").evaluateAll(elements => elements.every(element => !element.style.getPropertyValue("--workflow-projection")))).toBe(true);
  await page.getByRole("button", { name: "문의", exact: true }).click();
  await expect(flow).toHaveAttribute("data-column", "0");
});

for (const width of [390, 768, 1024, 1440, 1920]) {
  for (const locale of ["ko", "en"]) {
    test(`${width}px ${locale} keeps every projected node and project card inside the scene`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1080 });
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), locale);
      const errors = await openScene(page, true);
      const flow = await workflowReady(page);
      await expect(flow.locator(".spatial-motion-toggle, .spatial-demo-disclaimer, .spatial-auto")).toHaveCount(0);
      await expect(flow).not.toContainText(/가상의 문의|가상의 프로젝트|fictional project|fictional inquiry/i);
      await expect(flow).toHaveAttribute("data-column", "1");
      const bounds = await flow.evaluate(host => {
        const container = host.getBoundingClientRect();
        const footer = host.querySelector(".spatial-flow-bottom").getBoundingClientRect();
        return [...host.querySelectorAll(".spatial-stage, .spatial-project-card")].map(element => {
          const r = element.getBoundingClientRect();
          return { name: element.getAttribute("aria-label"), fits: r.left >= container.left && r.right <= container.right && r.top >= container.top && r.bottom <= footer.top };
        });
      });
      expect(bounds.filter(item => !item.fits)).toEqual([]);
      const readability = await flow.evaluate(host => {
        const footer = host.querySelector(".spatial-flow-bottom").getBoundingClientRect();
        const container = host.getBoundingClientRect();
        const labels = [...host.querySelectorAll(".spatial-stage > span:last-of-type, .spatial-lane > span, .spatial-lane > small, .spatial-card-detail > p, .spatial-flow-bottom > span")];
        return {
          smallLabels: labels.filter(element => parseFloat(getComputedStyle(element).fontSize) < 13).map(element => element.textContent),
          footerInset: container.bottom - footer.bottom,
          footerFits: footer.left >= container.left && footer.right <= container.right
        };
      });
      expect(readability.smallLabels, "Functional labels must remain readable at every viewport").toEqual([]);
      expect(readability.footerInset, "The status row needs a visible inset from the rounded frame").toBeGreaterThanOrEqual(12);
      expect(readability.footerFits).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await flow.screenshot({ path: `outputs/webgl/workflow-${locale}-${width}.png` });
      if (width === 1920 && locale === "ko") {
        await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
        await page.screenshot({ path: "outputs/webgl/landing-refined-1920.png" });
      }
      expect(errors).toEqual([]);
    });
  }
}

test("hero and footer retain continuous shader light fields", async ({ page }) => {
  const errors = await openScene(page, true);
  await expect(page.locator('[data-webgl-kind="hero"]')).toHaveAttribute("data-webgl-state", "ready", { timeout: 20_000 });
  const footer = page.locator('[data-webgl-kind="footer"]');
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toHaveAttribute("data-webgl-state", "ready", { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("offscreen resize refreshes the workflow projection without restarting its render loop", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("freelance-ops-ui-locale-v1", "en"));
  const errors = await openScene(page, true);
  const flow = await workflowReady(page);
  await page.locator("#review").scrollIntoViewIfNeeded();
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => flow.evaluate(host => {
      const box = host.getBoundingClientRect();
      const contained = [...host.querySelectorAll(".spatial-stage, .spatial-project-card")].every(element => {
        const face = element.getBoundingClientRect();
        return face.left >= box.left - 1 && face.right <= box.right + 1;
      });
      return contained && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    }), { message: "An offscreen graph must already fit the new layout before scrolling back to it" }).toBe(true);
    await expectStopped(flow);
  }
  expect(errors).toEqual([]);
});
