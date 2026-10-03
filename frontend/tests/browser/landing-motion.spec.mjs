import { test as base, expect } from "@playwright/test";

const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const depthHosts = ".spatial-flow, .story-execution, .story-effort-prisms, .story-dashboard-ring";

// Landing examples must remain local, without a Business API or external request.
const test = base.extend({
  page: async ({ page }, runTest) => {
    const unexpected = [];
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === localOrigin && !url.pathname.startsWith("/api/")) return route.continue();
      unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await runTest(page);
    expect(unexpected, "Motion examples must not contact real services").toEqual([]);
    expect(errors, "Browser runtime errors").toEqual([]);
  }
});

test.use({ viewport: { width: 1440, height: 900 } });

async function openLanding(page, { clock = false, reducedMotion = "no-preference" } = {}) {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("freelance-ops-ui-locale-v1", "ko");
  });
  if (clock) await page.clock.install();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.locator("[data-pointer-depth]")).toHaveCount(4);
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-ready", "true");
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-paused", String(reducedMotion === "reduce"));
  await page.evaluate(() => document.fonts.ready);
  if (clock) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
}

async function expectFlatText(page) {
  const failures = await page.locator(depthHosts).evaluateAll(hosts => {
    const failures = new Set();
    for (const host of hosts) {
      const text = [host, ...host.querySelectorAll("*")].filter(element =>
        !element.closest('[aria-hidden="true"], .sr-only') &&
        [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
      );
      for (const element of [host, ...text]) {
        for (let ancestor = element; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.perspective !== "none" || (style.transform !== "none" && !new DOMMatrixReadOnly(style.transform).is2D)) failures.add(`Tilted text or hit target: ${ancestor.className}`);
          if (/blur\((?!0(?:px)?\))/.test(style.filter)) failures.add(`Blurred text: ${ancestor.className}`);
        }
      }
    }
    return [...failures];
  });
  expect(failures, "Only decoration may tilt; text and its ancestors stay planar").toEqual([]);
}

async function shellState(host) {
  return host.evaluate(element => {
    const style = getComputedStyle(element);
    const shell = getComputedStyle(element, "::before");
    const matrix = new DOMMatrixReadOnly(shell.transform);
    return {
      transform: shell.transform,
      // These rendered off-plane components must reverse at opposite corners.
      x: matrix.m23,
      y: matrix.m13,
      strength: Number.parseFloat(style.getPropertyValue("--pointer-strength")) || 0
    };
  });
}

async function pointAtCorner(page, host, corner) {
  const box = await host.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width * corner, box.y + box.height * corner);
  await expect(host).toHaveAttribute("data-pointer-active", "true");
  await expect.poll(async () => (await shellState(host)).strength).toBeGreaterThan(.98);
  await expect.poll(async () => {
    const state = await shellState(host);
    const direction = corner < .5 ? 1 : -1;
    return state.x * direction > .01 && state.y * direction > .01;
  }, { message: "The actual glass transform, not only custom properties, must tilt" }).toBe(true);
  return shellState(host);
}

async function expectReset(host) {
  await expect(host).toHaveAttribute("data-pointer-active", "false");
  await expect.poll(async () => {
    const state = await shellState(host);
    return Math.max(Math.abs(state.x), Math.abs(state.y), state.strength);
  }, { message: "Reset must remove the rendered tilt and highlight" }).toBeLessThan(.001);
}

test("pointer depth reverses the rendered glass at opposite corners while all four hosts keep flat text", async ({ page }) => {
  await openLanding(page);
  for (const host of await page.locator(depthHosts).all()) {
    await host.scrollIntoViewIfNeeded();
    await expect(host).toBeInViewport({ ratio: .5 });
    const chart = host.locator(".story-prism-chart");
    const hasPrisms = await chart.count() > 0;
    if (hasPrisms) await expect(chart).toHaveAttribute("data-story-entry-state", "complete");
    const bodyDepth = () => chart.locator("[data-story-prism]").first().evaluate(element => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { x: matrix.m41, y: matrix.m42, z: matrix.m43 };
    });
    const labelPositions = () => chart.locator(".spatial-bar-label, .story-prism-column > small").evaluateAll(labels => labels.map(label => {
      const box = label.getBoundingClientRect();
      return [box.left, box.top, box.width, box.height];
    }));
    const labels = hasPrisms ? await labelPositions() : [];
    const first = await pointAtCorner(page, host, .2);
    const firstBody = hasPrisms ? await bodyDepth() : null;
    if (hasPrisms) expect((await prismGeometry(chart)).every(bar => bar.connected && bar.solid)).toBe(true);
    await expectFlatText(page);
    const opposite = await pointAtCorner(page, host, .8);
    if (hasPrisms) {
      const oppositeBody = await bodyDepth();
      expect(firstBody.x * oppositeBody.x, "The prism body must move, independently of the glass shell").toBeLessThan(0);
      expect(firstBody.y * oppositeBody.y).toBeLessThan(0);
      expect(Math.min(firstBody.z, oppositeBody.z), "The real prism projects in front of the reading plane").toBeGreaterThan(20);
      expect((await prismGeometry(chart)).every(bar => bar.connected && bar.solid)).toBe(true);
      const currentLabels = await labelPositions();
      for (const [index, label] of labels.entries()) for (const [axis, value] of label.entries()) expect(currentLabels[index][axis]).toBeCloseTo(value, 1);
    }
    expect(first.transform).not.toBe(opposite.transform);
    expect(first.x * opposite.x, "Vertical tilt reverses").toBeLessThan(0);
    expect(first.y * opposite.y, "Horizontal tilt reverses").toBeLessThan(0);
    await expectFlatText(page);
    await page.mouse.move(0, 0);
    await expectReset(host);
  }
});

test("focus resets pointer depth, suppresses pointer moves, and live reduced motion clears a fresh tilt", async ({ page }) => {
  await openLanding(page);
  const host = page.locator(".spatial-flow");
  await pointAtCorner(page, host, .2);
  await host.locator("button").first().focus();
  await expectReset(host);
  const box = await host.boundingBox();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .8);
  await expectReset(host);
  await expectFlatText(page);
  await page.locator("#main-content").evaluate(element => element.focus({ preventScroll: true }));
  await pointAtCorner(page, host, .2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectReset(host);
  expect((await shellState(host)).transform).toBe("none");
  await expectFlatText(page);
});

for (const mode of ["reduced-motion", "coarse-pointer"]) {
  test.describe(mode, () => {
    test.use({ hasTouch: mode === "coarse-pointer" });
    test(`initial ${mode} has no glass tilt even with pointer events`, async ({ page }) => {
      await openLanding(page, { reducedMotion: mode === "reduced-motion" ? "reduce" : "no-preference" });
      if (mode === "coarse-pointer") expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      for (const host of await page.locator(depthHosts).all()) {
        await host.scrollIntoViewIfNeeded();
        const before = await shellState(host);
        // A desktop-sized touch context tests the media gate independently of the mobile breakpoint.
        await host.dispatchEvent("pointermove", { pointerType: "mouse", clientX: 100, clientY: 100 });
        await page.waitForTimeout(80);
        const after = await shellState(host);
        expect(after.transform).toBe("none");
        expect(after.strength).toBe(0);
        expect(after).toEqual(before);
      }
      await expectFlatText(page);
    });
  });
}

async function prismGeometry(chart) {
  return chart.locator("[data-story-prism]").evaluateAll(bars => bars.map(bar => {
    const style = getComputedStyle(bar);
    const matrix = new DOMMatrixReadOnly(style.transform);
    const faces = [...bar.children].map(face => face.getBoundingClientRect());
    const overlap = (a, b) => Math.min(a.right, b.right) >= Math.max(a.left, b.left) - 1 && Math.min(a.bottom, b.bottom) >= Math.max(a.top, b.top) - 1;
    return {
      grow: Math.hypot(matrix.m21, matrix.m22, matrix.m23),
      height: Number.parseFloat(style.height),
      bottom: bar.getBoundingClientRect().bottom,
      connected: faces.length === 3 && overlap(faces[2], faces[0]) && overlap(faces[2], faces[1]),
      solid: faces.every(face => face.width > .5 && face.height > .5),
      opacity: style.opacity,
      transformStyle: style.transformStyle
    };
  }));
}

async function expectFinalPrisms(chart, days) {
  await expect(chart).toHaveAttribute("data-story-entry-state", "complete");
  const bars = await prismGeometry(chart);
  expect(bars).toHaveLength(days.length);
  expect(Math.max(...bars.map(bar => bar.bottom)) - Math.min(...bars.map(bar => bar.bottom))).toBeLessThan(1);
  for (const [index, bar] of bars.entries()) {
    expect(bar.grow).toBeCloseTo(1, 4);
    expect(bar.height / days[index]).toBeCloseTo(bars[0].height / days[0], 2);
    expect(bar.connected, `Prism ${index + 1} must keep its cap attached to both faces`).toBe(true);
    expect(bar.solid).toBe(true);
    expect(bar.opacity).toBe("1");
    expect(bar.transformStyle).toBe("preserve-3d");
  }
}

test("fresh hydration preserves the first plot entry and prisms grow sequentially into connected, proportional bars", async ({ page }) => {
  await openLanding(page, { clock: true });
  const firstPlot = page.locator("[data-story-metric-scene]").first();
  await expect(firstPlot).toHaveAttribute("data-story-entry-state", "waiting");
  await page.clock.runFor(300);
  await expect(firstPlot).toHaveAttribute("data-story-entry-state", "waiting");
  await firstPlot.scrollIntoViewIfNeeded();
  await expect(firstPlot).toHaveAttribute("data-story-entry-state", "running");
  await page.clock.runFor(1400);
  await expect(firstPlot).toHaveAttribute("data-story-entry-state", "complete");
  const chart = page.locator(".story-prism-chart");
  await expect(chart).toHaveAttribute("data-story-entry-state", "waiting");
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toHaveAttribute("data-story-entry-state", "running");
  await page.clock.runFor(220);
  const growing = await prismGeometry(chart);
  expect(growing[0].grow).toBeGreaterThan(growing[1].grow);
  expect(growing[1].grow).toBeGreaterThan(growing[2].grow);
  expect(growing[0].grow).toBeLessThan(1);
  expect(growing[2].grow).toBeGreaterThan(0);
  expect(Math.max(...growing.map(bar => bar.bottom)) - Math.min(...growing.map(bar => bar.bottom))).toBeLessThan(1);
  await expectFlatText(page);
  await page.clock.runFor(1400);
  await expectFinalPrisms(chart, [5, 3.5, 1.5]);
  await page.getByRole("button", { name: /^예약 변경 추가/ }).evaluate(button => button.click());
  await page.clock.runFor(800);
  await expectFinalPrisms(chart, [5, 3.5, 1.5, 3]);
  await expect(chart.locator(".spatial-bar-label")).toHaveText(["5일", "3.5일", "1.5일", "3일"]);
});

for (const interruption of ["pause-before-entry", "hidden-during-entry"]) {
  test(`${interruption} keeps accurate fallback metrics and preserves the correct first-entry lifecycle`, async ({ page }) => {
    await openLanding(page, { clock: true });
    const chart = page.locator(".story-prism-chart");
    await expect(chart).toHaveAttribute("data-story-entry-state", "waiting");
    if (interruption === "pause-before-entry") {
      await page.locator(".spatial-motion-toggle").click();
    } else {
      await chart.scrollIntoViewIfNeeded();
      await expect(chart).toHaveAttribute("data-story-entry-state", "running");
      await page.clock.runFor(180);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
    await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-paused", "true");
    await expectFinalPrisms(chart, [5, 3.5, 1.5]);
    await page.getByRole("button", { name: /^예약 변경 추가/ }).evaluate(button => button.click());
    await page.clock.runFor(1600);
    await expectFinalPrisms(chart, [5, 3.5, 1.5, 3]);
    const finalCounts = ["13", "04", "13", "3.9"];
    await expect(page.locator("[data-story-count]")).toHaveText(finalCounts);
    await expect(page.locator("[data-story-count] + .sr-only")).toHaveText(finalCounts);
    if (interruption === "hidden-during-entry") await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Changing scope explicitly pauses the demo in both cases.
    await page.locator(".spatial-motion-toggle").evaluate(button => button.click());
    await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-paused", "false");
    if (interruption === "pause-before-entry") await expect(chart).toHaveAttribute("data-story-entry-state", "waiting");
    await chart.scrollIntoViewIfNeeded();
    if (interruption === "pause-before-entry") {
      await expect(chart).toHaveAttribute("data-story-entry-state", "running");
      await page.clock.runFor(1400);
    } else {
      await page.clock.runFor(250);
    }
    await expectFinalPrisms(chart, [5, 3.5, 1.5, 3]);
    await expect(page.locator("[data-story-count]")).toHaveText(finalCounts);
  });
}

test("live Korean/English changes and desktop/mobile resize keep text planar and reset narrow-screen depth", async ({ page }) => {
  await openLanding(page);
  for (const language of ["en", "ko"]) {
    await page.getByRole("combobox", { name: /표시 언어|Interface language/ }).selectOption(language);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    for (const width of [1440, 390, 821]) {
      await page.setViewportSize({ width, height: 900 });
      const host = page.locator(".spatial-flow");
      await host.scrollIntoViewIfNeeded();
      if (width > 820) {
        await pointAtCorner(page, host, .2);
      } else {
        await expectReset(host);
        expect((await shellState(host)).transform).toBe("none");
      }
      await expectFlatText(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  }
});

async function transferGeometry(card) {
  return card.evaluate(element => {
    const shell = element.querySelector(".inquiry-liquid-shell");
    const content = element.querySelector(".inquiry-card-content");
    const shellBox = shell.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return {
      width: shellBox.width,
      height: shellBox.height,
      x: matrix.m41,
      textOpacity: Number(getComputedStyle(content).opacity),
      // Translation is allowed; glyphs must never inherit the droplet's scaling.
      textFlat: matrix.is2D && Math.abs(matrix.m11 - 1) < .001 && Math.abs(matrix.m22 - 1) < .001 && Math.abs(matrix.m12) < .001 && Math.abs(matrix.m21) < .001 && getComputedStyle(content).transform === "none"
    };
  });
}

async function expectSettledTransfer(page, column) {
  const card = page.locator(".spatial-project-card");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-project-id", "FO-024");
  await expect(card).toHaveAttribute("data-transfer-state", "settled");
  await expect(page.locator(".spatial-flow")).toHaveAttribute("data-column", String(column));
  await expect(card.locator(".inquiry-card-content")).toHaveCSS("opacity", "1");
  await expect(card.locator(".inquiry-liquid-shell")).toHaveCSS("transform", "none");
  const geometry = await card.evaluate(element => {
    const lanes = element.closest(".spatial-board").querySelectorAll(".spatial-lane");
    return {
      x: new DOMMatrixReadOnly(getComputedStyle(element).transform).m41,
      distance: lanes[1].offsetLeft - lanes[0].offsetLeft,
      sameNode: window.__motionTransferCard === element
    };
  });
  expect(geometry.x).toBeCloseTo(column ? geometry.distance : 0, 0);
  expect(geometry.sameNode, "Every transfer must preserve the same semantic project card").toBe(true);
  await expectFlatText(page);
}

test("manual proposal transfer condenses into a droplet, stretches in flight, and settles without scaling text", async ({ page }) => {
  await openLanding(page, { clock: true });
  const card = page.locator(".spatial-project-card");
  await card.evaluate(element => { window.__motionTransferCard = element; });
  await expectSettledTransfer(page, 0); // Preference hydration must not invent a reverse transfer.
  const original = await transferGeometry(card);
  await page.locator(".spatial-stage").nth(4).click();
  await expect(card).toHaveAttribute("data-transfer-state", "condensing");
  await page.clock.runFor(260);
  await expect(card).toHaveAttribute("data-transfer-state", "droplet");
  const droplet = await transferGeometry(card);
  expect(droplet.width).toBeLessThan(original.width * .6);
  expect(droplet.height).toBeLessThan(original.height * .5);
  expect(droplet.width / droplet.height).toBeCloseTo(1, 1);
  expect(droplet.textOpacity).toBe(0);
  expect(droplet.textFlat).toBe(true);
  await page.clock.runFor(140);
  await expect(card).toHaveAttribute("data-transfer-state", "travelling");
  const stretched = await transferGeometry(card);
  expect(stretched.width / stretched.height).toBeGreaterThan(1.7);
  expect(stretched.x).toBeGreaterThan(droplet.x);
  expect(stretched.textFlat).toBe(true);
  await page.clock.runFor(1000);
  await expectSettledTransfer(page, 1);
  await expect(card.locator(".spatial-status")).toHaveText("협상 중");
});

test("rapid forward/reverse proposal selection interrupts one coherent card and clears every temporary morph", async ({ page }) => {
  await openLanding(page, { clock: true });
  const card = page.locator(".spatial-project-card");
  const stages = page.locator(".spatial-stage");
  await card.evaluate(element => { window.__motionTransferCard = element; });
  for (const [stage, elapsed] of [[4, 400], [0, 140], [4, 380], [0, 120]]) {
    const before = (await transferGeometry(card)).x;
    await stages.nth(stage).click();
    await expect(card).toHaveAttribute("data-transfer-state", "condensing");
    expect((await transferGeometry(card)).x, "A reversal starts at the current position without teleporting").toBeCloseTo(before, 0);
    await page.clock.runFor(elapsed);
    expect((await transferGeometry(card)).textFlat).toBe(true);
  }
  await page.clock.runFor(1400);
  await expectSettledTransfer(page, 0);
  await expect(card.locator(".spatial-status")).toHaveText("진행 중");
  await stages.nth(4).click();
  await page.clock.runFor(1400);
  await expectSettledTransfer(page, 1);
});
