import { test, expect } from "@playwright/test";

async function openUnfold(page, { width = 1440, locale = "ko", reduced = false } = {}) {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  await page.addInitScript(value => localStorage.setItem("freelance-ops-ui-locale-v1", value), locale);
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const section = page.locator(".workflow-unfold");
  await expect(section).toHaveAttribute("data-unfold-ready", "true");
  await expect(section.locator(".workflow-unfold-hint")).toHaveCount(0);
  return section;
}

async function cardPoses(section) {
  return section.locator(".workflow-unfold-card").evaluateAll(cards => cards.map(card => {
    const box = card.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, opacity: Number(getComputedStyle(card).opacity) };
  }));
}

for (const width of [390, 1440]) {
  test(`${width}px scroll opens one inquiry into five physical stages and reverses on return`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const section = await openUnfold(page, { width });
    const entry = await section.locator(".workflow-unfold-deck").evaluate(deck => {
      const first = deck.querySelector(".workflow-unfold-card");
      return scrollY + deck.getBoundingClientRect().top + first.offsetTop + first.offsetHeight / 2 - innerHeight * .82;
    });
    await page.evaluate(top => scrollTo({ top, behavior: "instant" }), entry);
    await expect(section).toHaveAttribute("data-unfold-state", "folded");
    const folded = await cardPoses(section);
    expect(folded.map(card => card.opacity)).toEqual([1, 0, 0, 0, 0]);
    await expect(section.getByRole("listitem")).toHaveCount(5);

    await page.evaluate(top => scrollTo({ top, behavior: "instant" }), entry + 185);
    await expect(section).toHaveAttribute("data-unfold-state", "unfolding");
    const opening = await cardPoses(section);
    expect(opening[1].opacity).toBeGreaterThan(0);
    expect(opening[4].opacity).toBeLessThan(opening[1].opacity);
    expect(Math.abs(opening[1].x - opening[0].x) + Math.abs(opening[1].y - opening[0].y)).toBeGreaterThan(20);
    // This is controlled by scroll position, not a timeline that finishes after a delay.
    await page.waitForTimeout(300);
    expect(await cardPoses(section)).toEqual(opening);

    await page.evaluate(top => scrollTo({ top, behavior: "instant" }), entry + 600);
    await expect(section).toHaveAttribute("data-unfold-state", "open");
    const opened = await cardPoses(section);
    expect(opened.map(card => card.opacity)).toEqual([1, 1, 1, 1, 1]);
    for (const [index, card] of opened.entries()) for (const other of opened.slice(index + 1)) {
      expect(card.x + card.width <= other.x + 1 || other.x + other.width <= card.x + 1 || card.y + card.height <= other.y + 1 || other.y + other.height <= card.y + 1, "Open stages must not overlap").toBe(true);
    }
    await section.screenshot({ path: `outputs/webgl/workflow-unfold-${width}.png` });
    await page.evaluate(top => scrollTo({ top, behavior: "instant" }), entry);
    await expect(section).toHaveAttribute("data-unfold-state", "folded");
    expect((await cardPoses(section)).map(card => card.opacity)).toEqual([1, 0, 0, 0, 0]);
    expect(errors).toEqual([]);
  });
}

for (const width of [320, 390, 768, 1440]) {
  for (const locale of ["ko", "en"]) {
    test(`${width}px ${locale} reduced motion shows a readable, complete five-stage sequence`, async ({ page }) => {
      const section = await openUnfold(page, { width, locale, reduced: true });
      await section.scrollIntoViewIfNeeded();
      await expect(section).toHaveAttribute("data-unfold-state", "open");
      await expect(section.locator(".workflow-unfold-card h3")).toHaveText(locale === "ko" ? ["문의", "요구사항", "리스크", "견적", "제안"] : ["Inquiry", "Requirements", "Risks", "Estimate", "Proposal"]);
      const failures = await section.evaluate(host => {
        const frame = host.getBoundingClientRect();
        return [...host.querySelectorAll(".workflow-unfold-card")].flatMap(card => {
          const box = card.getBoundingClientRect();
          const labels = [...card.querySelectorAll("h3, p")];
          const clipped = labels.some(label => label.scrollWidth > label.clientWidth + 1 || parseFloat(getComputedStyle(label).fontSize) < 14);
          return box.left < frame.left - 1 || box.right > frame.right + 1 || getComputedStyle(card).opacity !== "1" || clipped ? [card.textContent] : [];
        });
      });
      expect(failures).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } });
  test("all five workflow steps remain readable in document order", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".workflow-unfold-card");
    await expect(cards).toHaveCount(5);
    for (const card of await cards.all()) {
      await expect(card).toBeVisible();
      await expect(card).toHaveCSS("opacity", "1");
    }
  });
});
