import { test, expect } from "@playwright/test";
import { PNG } from "playwright-core/lib/utilsBundle";

test.use({ viewport: { width: 1440, height: 1000 } });

const isolatedLight = `
  body * { visibility: hidden !important; }
  [data-webgl-kind="hero"], [data-webgl-kind="hero"] > canvas { visibility: visible !important; }
`;

async function openHero(page, { path = "/", reduced = false, clock = false } = {}) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /THREE|WebGL|GLSL|hydrated/.test(message.text())) errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  if (clock) await page.clock.install();
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  const hero = page.locator('[data-webgl-kind="hero"]');
  await expect(hero).toHaveAttribute("data-webgl-state", "ready", { timeout: 25_000 });
  await page.mouse.move(5, 5);
  if (clock) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10_000));
  return { hero, errors };
}

async function pixels(page, path) {
  return PNG.sync.read(await page.screenshot({ style: isolatedLight, animations: "allow", ...(path ? { path } : {}) }));
}

function difference(first, second, region = () => true) {
  expect([second.width, second.height]).toEqual([first.width, first.height]);
  let total = 0, samples = 0, changed = 0;
  for (let y = 0; y < first.height; y += 2) for (let x = 0; x < first.width; x += 2) {
    if (!region(x, y)) continue;
    const offset = (y * first.width + x) * 4;
    let delta = 0;
    for (let channel = 0; channel < 3; channel++) delta += Math.abs(first.data[offset + channel] - second.data[offset + channel]);
    total += delta / 3;
    samples++;
    if (delta > 9) changed++;
  }
  return { mean: total / Math.max(1, samples), changed };
}

function brightTarget(frame) {
  let best = { x: 0, y: 0, energy: -1 };
  // Aim at the rendered light instead of assuming a shader-space coordinate.
  for (let y = 180; y < frame.height * .78; y += 70) for (let x = frame.width * .3; x < frame.width * .88; x += 70) {
    let energy = 0;
    for (let dy = -30; dy <= 30; dy += 6) for (let dx = -30; dx <= 30; dx += 6) {
      const offset = (Math.floor(y + dy) * frame.width + Math.floor(x + dx)) * 4;
      energy += Math.max(0, Math.max(frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]) - 45);
    }
    if (energy > best.energy) best = { x, y, energy };
  }
  return best;
}

async function stopped(hero) {
  await expect(hero).toHaveAttribute("data-webgl-running", "false");
  await expect.poll(async () => {
    const count = await hero.getAttribute("data-webgl-frames");
    await new Promise(resolve => setTimeout(resolve, 180));
    return await hero.getAttribute("data-webgl-frames") === count;
  }).toBe(true);
}

test("the default electric ribbon changes visible pixels while retaining its canvas bounds", async ({ page }) => {
  const { hero, errors } = await openHero(page, { clock: true });
  await expect(hero).toHaveAttribute("data-webgl-variant", "electric");
  await expect(hero).toHaveAttribute("data-webgl-running", "true");
  const bounds = await hero.boundingBox();
  const first = await pixels(page);
  await page.clock.runFor(800);
  const next = await pixels(page, "outputs/webgl/electric-hero.png");
  expect(difference(first, next).changed, "Animation must alter real light pixels, not just increment a frame counter").toBeGreaterThan(250);
  expect(await hero.boundingBox()).toEqual(bounds);
  expect(brightTarget(next).energy, "The GPU surface must contain visible light").toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test("pointer interaction bends nearby light more than the distant bundle", async ({ page }) => {
  const { hero, errors } = await openHero(page, { clock: true });
  const first = await pixels(page);
  await page.clock.runFor(640);
  const neutral = await pixels(page);
  const target = brightTarget(neutral);
  expect(target.energy).toBeGreaterThan(100);
  const near = (x, y) => Math.hypot(x - target.x, y - target.y) < 220;
  const far = (x, y) => Math.hypot(x - target.x, y - target.y) > 420;
  const bounds = await hero.boundingBox();
  await page.mouse.move(target.x, target.y);
  await page.clock.runFor(640);
  await expect(hero).toHaveAttribute("data-webgl-running", "true");
  const response = await pixels(page, "outputs/webgl/electric-pointer.png");
  const nearbyChange = difference(neutral, response, near).mean - difference(first, neutral, near).mean;
  const distantChange = difference(neutral, response, far).mean - difference(first, neutral, far).mean;
  expect(nearbyChange, "Pointer response must add a visible local deformation beyond ordinary animation").toBeGreaterThan(.03);
  expect(nearbyChange, "The interaction must concentrate near the pointer, not rotate the whole light field").toBeGreaterThan(Math.max(.02, distantChange) * 2);
  expect(await hero.boundingBox()).toEqual(bounds);
  expect(errors).toEqual([]);
});

test("reduced motion renders a stable electric frame and ignores pointer motion", async ({ page }) => {
  const { hero, errors } = await openHero(page, { reduced: true });
  await stopped(hero);
  const first = await pixels(page);
  expect(brightTarget(first).energy).toBeGreaterThan(100);
  await page.mouse.move(1000, 400);
  await page.waitForTimeout(300);
  expect(difference(first, await pixels(page)).changed).toBe(0);
  await stopped(hero);
  expect(errors).toEqual([]);
});

test("mobile keeps a visible static electric ribbon without a render loop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { hero, errors } = await openHero(page);
  await expect(hero).toHaveAttribute("data-webgl-variant", "electric");
  await stopped(hero);
  const first = await pixels(page);
  expect(brightTarget(first).energy).toBeGreaterThan(100);
  await page.waitForTimeout(300);
  expect(difference(first, await pixels(page, "outputs/webgl/electric-mobile.png")).changed).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("the classic URL retains the previous renderer across reloads", async ({ page }) => {
  const { hero, errors } = await openHero(page, { path: "/?hero-light=classic", reduced: true });
  await expect(hero).toHaveAttribute("data-webgl-variant", "classic");
  const classic = await pixels(page, "outputs/webgl/classic-hero.png");
  await page.reload();
  await expect(hero).toHaveAttribute("data-webgl-state", "ready");
  await expect(hero).toHaveAttribute("data-webgl-variant", "classic");
  await expect(page).toHaveURL(/hero-light=classic/);
  await page.goto("/");
  await expect(hero).toHaveAttribute("data-webgl-state", "ready");
  await expect(hero).toHaveAttribute("data-webgl-variant", "electric");
  expect(difference(classic, await pixels(page)).changed, "The comparison switch must select a different rendered light").toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test("offscreen and hidden tabs stop the electric renderer, then resume it on return", async ({ page }) => {
  const { hero, errors } = await openHero(page);
  await expect(hero).toHaveAttribute("data-webgl-running", "true");
  await page.locator("#scope-comparison").scrollIntoViewIfNeeded();
  await stopped(hero);
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await expect(hero).toHaveAttribute("data-webgl-running", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await stopped(hero);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(hero).toHaveAttribute("data-webgl-running", "true");
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await expect(page.locator(".spatial-flow")).not.toBeInViewport({ ratio: .2 });
  await expect(page.locator(".spatial-flow")).toHaveAttribute("data-playing", "false");
  await expect(hero).toHaveAttribute("data-webgl-running", "true");
  const frames = Number(await hero.getAttribute("data-webgl-frames"));
  await expect.poll(async () => Number(await hero.getAttribute("data-webgl-frames"))).toBeGreaterThan(frames);
  expect(errors).toEqual([]);
});
