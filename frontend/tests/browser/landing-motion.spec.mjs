import { test as base, expect } from "@playwright/test";

const localOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const depthHosts = ".spatial-flow, .story-execution, .story-effort-prisms, .story-dashboard-ring";

// Landing examples must remain local, without a Business API or external request.
const test = base.extend({
  page: async ({ page }, runTest) => {
    // This suite validates the retained CSS fallback and its existing motion
    // contracts. Real GPU rendering is exercised in landing-webgl.spec.mjs.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        if (/webgl/.test(type)) return null;
        return original.call(this, type, ...args);
      };
    });
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

async function expectCohesiveText(page) {
  const failures = await page.locator(depthHosts).evaluateAll(hosts => {
    const failures = new Set();
    for (const host of hosts) {
      const text = [host, ...host.querySelectorAll("*")].filter(element =>
        !element.closest(".sr-only, svg") &&
        [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
      );
      for (const element of text) {
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (/blur\((?!0(?:px)?\))/.test(style.filter)) failures.add(`Blurred text: ${ancestor.className}`);
          if (ancestor === host) break;
          const matrix = new DOMMatrixReadOnly(style.transform);
          // Glyphs inherit the scene's one tilt. Local card travel and small,
          // fixed Z offsets are allowed, but a second rotation/scale is not.
          const distorted = [matrix.m11 - 1, matrix.m22 - 1, matrix.m33 - 1, matrix.m44 - 1,
            matrix.m12, matrix.m13, matrix.m14, matrix.m21, matrix.m23, matrix.m24,
            matrix.m31, matrix.m32, matrix.m34].some(value => Math.abs(value) > .001);
          if (style.perspective !== "none" || distorted || Math.abs(matrix.m43) > 12) failures.add(`Independent glyph distortion: ${ancestor.className}`);
          if (style.rotate !== "none" || (style.scale !== "none" && style.scale !== "1")) failures.add(`Independent glyph rotation/scale: ${ancestor.className}`);
        }
      }
    }
    return [...failures];
  });
  expect(failures, "Glyphs stay undistorted in the common scene coordinate system").toEqual([]);
}

async function sceneState(host) {
  return host.evaluate(element => {
    const style = getComputedStyle(element);
    const shell = getComputedStyle(element, "::before");
    const matrix = new DOMMatrixReadOnly(style.transform);
    return {
      transform: style.transform,
      shellTransform: shell.transform,
      // The common root's rendered off-plane components reverse at corners.
      x: matrix.m23,
      y: matrix.m13,
      perspective: matrix.m34,
      rx: Number.parseFloat(style.getPropertyValue("--pointer-rx")) || 0,
      ry: Number.parseFloat(style.getPropertyValue("--pointer-ry")) || 0,
      strength: Number.parseFloat(style.getPropertyValue("--pointer-strength")) || 0
    };
  });
}

function pointerAnchor(host) {
  return host.locator("xpath=..");
}

async function pointAtCorner(page, host, corner) {
  const anchor = pointerAnchor(host);
  await expect(anchor).toHaveClass(/\bpointer-depth-anchor\b/);
  await expect.poll(() => anchor.evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.max(Math.abs(matrix.m41), Math.abs(matrix.m42), Math.abs(matrix.m43));
  }), { message: "Wait for the anchor's entry reveal before measuring pointer geometry" }).toBeLessThan(.001);
  const box = await anchor.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width * corner, box.y + box.height * corner);
  await expect(host).toHaveAttribute("data-pointer-active", "true");
  await expect.poll(async () => (await sceneState(host)).strength).toBeGreaterThan(.98);
  await expect.poll(async () => {
    const state = await sceneState(host);
    const direction = corner < .5 ? 1 : -1;
    return state.x * direction > .005 && state.y * direction > .005;
  }, { message: "The scene root's rendered matrix must tilt with the pointer" }).toBe(true);
  const state = await sceneState(host);
  expect(Math.abs(state.rx)).toBeLessThanOrEqual(1.801);
  expect(Math.abs(state.ry)).toBeLessThanOrEqual(2.201);
  expect(state.perspective).toBeCloseTo(-1 / 1200, 5);
  expect(state.shellTransform, "The shell inherits its host's tilt without another transform").toBe("none");
  return state;
}

async function expectReset(host) {
  await expect(host).toHaveAttribute("data-pointer-active", "false");
  await expect.poll(async () => {
    const state = await sceneState(host);
    return Math.max(Math.abs(state.x), Math.abs(state.y), state.strength);
  }, { message: "Reset must remove the rendered tilt and highlight" }).toBeLessThan(.001);
}

async function localLayers(host) {
  return host.evaluate(element => {
    const selectors = [".spatial-stages", ".spatial-board", ".spatial-stage-icon", ".inquiry-card-content", ".story-panel-top", ".story-prism-chart", ".story-prism-stack",
      ".spatial-bar-label", "[data-story-prism]", ".story-prism-column > small", ".story-ring-figure",
      ".story-ring-figure > svg", ".story-ring-figure > div"];
    return selectors.flatMap(selector => [...element.querySelectorAll(selector)].map((layer, index) => {
      const style = getComputedStyle(layer);
      return { selector, index, transform: style.transform, translate: style.translate, rotate: style.rotate, scale: style.scale, perspective: style.perspective };
    }));
  });
}

async function pairedGeometry(host) {
  return host.evaluate(element => {
    const relative = (first, second) => {
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      return { x: (a.left + a.right - b.left - b.right) / 2, y: (a.top + a.bottom - b.top - b.bottom) / 2 };
    };
    return {
      prisms: [...element.querySelectorAll(".story-prism-stack")].map(stack => {
        const label = stack.querySelector(".spatial-bar-label");
        const body = stack.querySelector("[data-story-prism]");
        return { ...relative(label, body), gap: body.getBoundingClientRect().top - label.getBoundingClientRect().bottom };
      }),
      ring: element.querySelector(".story-ring-figure") ? relative(element.querySelector(".story-ring-figure > svg"), element.querySelector(".story-ring-figure > div")) : null
    };
  });
}

test("all four scenes reverse one shared root tilt while their local layers and labels remain connected", async ({ page }) => {
  await openLanding(page);
  for (const host of await page.locator(depthHosts).all()) {
    await host.scrollIntoViewIfNeeded();
    await expect(host).toBeInViewport({ ratio: .5 });
    const chart = host.locator(".story-prism-chart");
    const hasPrisms = await chart.count() > 0;
    if (hasPrisms) await expect(chart).toHaveAttribute("data-story-entry-state", "complete");
    const first = await pointAtCorner(page, host, .2);
    const firstLayers = await localLayers(host);
    const firstPairs = await pairedGeometry(host);
    const firstAnchor = await pointerAnchor(host).boundingBox();
    if (hasPrisms) expect((await prismGeometry(chart)).every(bar => bar.connected && bar.solid)).toBe(true);
    await expectCohesiveText(page);
    const opposite = await pointAtCorner(page, host, .8);
    expect(await localLayers(host), "Pointer motion must not steer any child layer independently").toEqual(firstLayers);
    const oppositeAnchor = await pointerAnchor(host).boundingBox();
    for (const key of ["x", "y", "width", "height"]) expect(oppositeAnchor[key], `The event anchor's ${key} must not follow the visual tilt`).toBeCloseTo(firstAnchor[key], 2);
    const oppositePairs = await pairedGeometry(host);
    if (hasPrisms) {
      const localDepth = await chart.locator(".story-prism-stack").evaluateAll(stacks => stacks.map(stack => {
        const group = new DOMMatrixReadOnly(getComputedStyle(stack.closest(".story-prism-chart")).transform);
        const body = new DOMMatrixReadOnly(getComputedStyle(stack.querySelector("[data-story-prism]")).transform);
        return { x: group.m41, y: group.m42, z: group.m43, bodyTranslation: [body.m41, body.m42, body.m43] };
      }));
      for (const layer of localDepth) {
        expect(Math.abs(layer.x) + Math.abs(layer.y)).toBeLessThan(.001);
        expect(layer.z).toBeGreaterThan(0);
        expect(layer.z).toBeLessThanOrEqual(12);
        expect(layer.bodyTranslation.every(value => Math.abs(value) < .001), "The prism keeps its fixed local rotation without pointer translation").toBe(true);
      }
      expect((await prismGeometry(chart)).every(bar => bar.connected && bar.solid)).toBe(true);
      for (const [index, pair] of firstPairs.prisms.entries()) {
        const oppositePair = oppositePairs.prisms[index];
        expect(pair.gap, "The value remains above its own bar").toBeGreaterThan(-2);
        expect(oppositePair.gap).toBeGreaterThan(-2);
        expect(Math.hypot(oppositePair.x - pair.x, oppositePair.y - pair.y), "Projected label/bar spacing changes gently with the shared plane").toBeLessThan(10);
      }
    }
    for (const pairs of [firstPairs, oppositePairs]) if (pairs.ring) expect(Math.hypot(pairs.ring.x, pairs.ring.y), "Ring and numeric overlay share the same projected center").toBeLessThan(1.5);
    const channels = await host.evaluate(element => [...element.style].filter(property => property.startsWith("--pointer-")).sort());
    expect(channels, "A scene has one shared five-channel pointer state").toEqual(["--pointer-rx", "--pointer-ry", "--pointer-strength", "--pointer-x", "--pointer-y"]);
    expect(first.transform).not.toBe(opposite.transform);
    expect(first.x * opposite.x, "Vertical tilt reverses").toBeLessThan(0);
    expect(first.y * opposite.y, "Horizontal tilt reverses").toBeLessThan(0);
    await expectCohesiveText(page);
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
  const box = await pointerAnchor(host).boundingBox();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .8);
  await expectReset(host);
  await expectCohesiveText(page);
  await page.locator("#main-content").evaluate(element => element.focus({ preventScroll: true }));
  await pointAtCorner(page, host, .2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectReset(host);
  expect((await sceneState(host)).transform).toBe("none");
  await expectCohesiveText(page);
});

test("pointer cancellation, manual pause, and page visibility reset the common scene tilt", async ({ page }) => {
  await openLanding(page);
  const host = page.locator(".spatial-flow");
  await pointAtCorner(page, host, .2);
  await pointerAnchor(host).dispatchEvent("pointercancel", { pointerType: "mouse" });
  await expectReset(host);
  await pointAtCorner(page, host, .8);
  await page.locator(".spatial-motion-toggle").evaluate(button => button.click());
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-paused", "true");
  await expectReset(host);
  const box = await pointerAnchor(host).boundingBox();
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2);
  await expectReset(host);
  await page.locator(".spatial-motion-toggle").evaluate(button => button.click());
  await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-paused", "false");
  await pointAtCorner(page, host, .8);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectReset(host);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await pointAtCorner(page, host, .2);
  await expectCohesiveText(page);
});

for (const mode of ["reduced-motion", "coarse-pointer"]) {
  test.describe(mode, () => {
    test.use({ hasTouch: mode === "coarse-pointer" });
    test(`initial ${mode} has no scene tilt even with pointer events`, async ({ page }) => {
      await openLanding(page, { reducedMotion: mode === "reduced-motion" ? "reduce" : "no-preference" });
      if (mode === "coarse-pointer") expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      for (const host of await page.locator(depthHosts).all()) {
        await host.scrollIntoViewIfNeeded();
        const before = await sceneState(host);
        // A desktop-sized touch context tests the media gate independently of the mobile breakpoint.
        await pointerAnchor(host).dispatchEvent("pointermove", { pointerType: "mouse", clientX: 100, clientY: 100 });
        await page.waitForTimeout(80);
        const after = await sceneState(host);
        expect(after.transform).toBe("none");
        expect(after.strength).toBe(0);
        expect(after).toEqual(before);
      }
      await expectCohesiveText(page);
    });
  });
}

async function prismGeometry(chart) {
  return chart.locator("[data-story-prism]").evaluateAll(bars => bars.map(bar => {
    const style = getComputedStyle(bar);
    const matrix = new DOMMatrixReadOnly(style.transform);
    const faces = [...bar.children].map(face => face.getBoundingClientRect());
    const overlap = (a, b) => Math.min(a.right, b.right) >= Math.max(a.left, b.left) - 1 && Math.min(a.bottom, b.bottom) >= Math.max(a.top, b.top) - 1;
    const name = bar.closest(".story-prism-column").querySelector("small");
    return {
      grow: Math.hypot(matrix.m21, matrix.m22, matrix.m23),
      height: Number.parseFloat(style.height),
      bottom: bar.getBoundingClientRect().bottom,
      labelClearance: name.getBoundingClientRect().top - Math.max(...faces.map(face => face.bottom)),
      connected: faces.length === 3 && overlap(faces[2], faces[0]) && overlap(faces[2], faces[1]),
      solid: faces.every(face => face.width > .5 && face.height > .5),
      opacity: style.opacity,
      transformStyle: style.transformStyle
    };
  }));
}

async function expectFinalPrisms(chart, days) {
  await expect(chart).toHaveAttribute("data-story-entry-state", "complete");
  const panelPlacement = await chart.evaluate(element => {
    const panel = element.closest(".story-effort-prisms");
    const anchor = panel.closest(".pointer-depth-anchor");
    return { inset: panel.offsetLeft, unusedWidth: anchor.clientWidth - panel.offsetWidth };
  });
  expect(Math.abs(panelPlacement.inset), "The prism panel must not inherit an implicit second grid column inside its anchor").toBeLessThanOrEqual(1);
  expect(Math.abs(panelPlacement.unusedWidth)).toBeLessThanOrEqual(1);
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
    expect(bar.labelClearance, "Task names need a real gutter below the projected solid, not just its untransformed box").toBeGreaterThanOrEqual(18);
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
  await expectCohesiveText(page);
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

test("live Korean/English changes and desktop/mobile resize preserve cohesive text and reset narrow-screen depth", async ({ page }) => {
  await openLanding(page);
  for (const language of ["en", "ko"]) {
    await page.locator(".home-language-trigger").click();
    await page.getByRole("option", { name: language === "ko" ? "한국어" : "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    for (const width of [1440, 390, 821]) {
      await page.setViewportSize({ width, height: 900 });
      const host = page.locator(".spatial-flow");
      await host.scrollIntoViewIfNeeded();
      if (width > 820) {
        await pointAtCorner(page, host, .2);
      } else {
        await expectReset(host);
        expect((await sceneState(host)).transform).toBe("none");
      }
      await expectCohesiveText(page);
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
      textFlat: Math.abs(matrix.m43) <= 12 && Math.abs(matrix.m13) < .001 && Math.abs(matrix.m23) < .001 && Math.abs(matrix.m31) < .001 && Math.abs(matrix.m32) < .001 && Math.abs(matrix.m33 - 1) < .001 && Math.abs(matrix.m11 - 1) < .001 && Math.abs(matrix.m22 - 1) < .001 && Math.abs(matrix.m12) < .001 && Math.abs(matrix.m21) < .001 && getComputedStyle(content).transform === "none"
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
  await expectCohesiveText(page);
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

test("hero returning light keeps room beyond its original viewport and fades before the paint edge", async ({ page }) => {
  await openLanding(page);
  for (const width of [1180, 1857, 2560]) {
    await page.setViewportSize({ width, height: 829 });
    const light = await page.locator('.scene-hero-light').evaluate(element => {
      const canvas = element.querySelector('svg');
      const core = element.querySelector('.scene-bend-core');
      const surface = element.getBoundingClientRect();
      const originalViewport = canvas.getBoundingClientRect();
      const brightArc = core.getBoundingClientRect();
      return { headroom: surface.bottom - brightArc.bottom, extension: surface.height - originalViewport.height,
        svgOverflow: getComputedStyle(canvas).overflow, outerOverflow: getComputedStyle(element).overflow,
        mask: getComputedStyle(element).maskImage, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(light.headroom, 'The full bright bend ends before the feathered paint boundary').toBeGreaterThan(260);
    expect(light.extension, 'The returning arc is not cut at the original cover viewport').toBeGreaterThanOrEqual(340);
    expect(light.svgOverflow).toBe('visible');
    expect(light.outerOverflow).toBe('hidden');
    expect(light.mask).toContain('linear-gradient');
    expect(light.mask).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(light.pageOverflow).toBe(0);
  }
});

for (const language of ["ko", "en"]) {
  for (const hash of ["review", "evidence"]) {
    test(`initial ${language} #${hash} lands after fonts and animation setup, including reload`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
      await page.goto(`/#${hash}`);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const assertDestination = async destination => {
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator(".spatial-story-run")).toHaveAttribute("data-motion-ready", "true");
        await expect.poll(() => page.locator(`#${destination}-title`).evaluate(element => {
          const heading = element.getBoundingClientRect();
          const nav = document.querySelector(".nav-shell").getBoundingClientRect();
          return heading.top >= nav.bottom + 8 && heading.bottom <= innerHeight;
        }), { message: "A direct anchor must remain visible after ScrollTrigger's initial refreshes" }).toBe(true);
        await expect(page).toHaveURL(new RegExp(`#${destination}$`));
        await expect(page.locator("[data-story-brand-mark]")).toHaveCSS("visibility", destination === "review" ? "hidden" : "visible");
        await expect(page.locator("[data-story-brand-target]")).toHaveCSS("visibility", destination === "review" ? "visible" : "hidden");
      };
      await assertDestination(hash);
      await page.reload();
      await assertDestination(hash);
      if (hash === "review") {
        await page.locator(".nav-shell").getByRole("link", { name: language === "ko" ? "검증 원칙" : "Review principles", exact: true }).click();
        await assertDestination("evidence");
        await page.goBack();
        await assertDestination("review");
      }
    });
  }
}

for (const language of ["ko", "en"]) {
  test(`compact ${language} chart keeps four task names legible and a resource-independent home mark`, async ({ page }) => {
    await page.setViewportSize({ width: 295, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), language);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole("button", { name: language === "ko" ? /예약 변경 추가/ : /Add rescheduling/ }).click();
    const chart = page.locator(".story-prism-chart");
    await expect(chart).toHaveAttribute("data-count", "4");
    for (const width of [295, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await chart.scrollIntoViewIfNeeded();
      const failures = await chart.evaluate(element => [...element.querySelectorAll(".story-prism-column > small")].flatMap(label => {
        const box = label.getBoundingClientRect();
        const text = label.querySelector(".story-prism-task-short");
        const range = document.createRange(); range.selectNodeContents(text);
        const fits = [...range.getClientRects()].every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1);
        return fits && Number.parseFloat(getComputedStyle(label).fontSize) >= 13 ? [] : [label.innerText];
      }));
      expect(failures, "Meaningful names must fit their columns without shrinking or clipping").toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      const brand = page.locator(".nav-shell .brand");
      await expect(brand.locator("img")).toHaveCount(0);
      await expect(brand.locator("svg.brand-mark")).toHaveCSS("width", "26px");
      await expect(brand.locator("svg.brand-mark")).toHaveCSS("height", "26px");
    }
    await page.setViewportSize({ width: 295, height: 189 });
    const menuButton = page.getByRole("button", { name: language === "ko" ? "페이지 메뉴 열기" : "Open page menu", exact: true });
    await menuButton.click();
    const menu = page.locator("#home-navigation");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS("overflow-y", "auto");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    const lastLink = menu.locator("a").last();
    await expect(lastLink).toBeFocused();
    expect(await lastLink.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.top >= 70 && box.bottom <= innerHeight - 8;
    }), "The last menu item must remain visibly reachable in a short zoomed viewport").toBe(true);
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await expect(menuButton).toBeFocused();
  });
}
