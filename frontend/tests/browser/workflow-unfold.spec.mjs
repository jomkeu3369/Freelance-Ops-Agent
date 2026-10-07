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

async function expectBranchHierarchy(section, width) {
  const [source, ...children] = await cardPoses(section);
  const frame = await section.boundingBox();
  expect(Math.abs(source.x + source.width / 2 - (frame.x + frame.width / 2))).toBeLessThan(2);
  for (const child of children) expect(child.y).toBeGreaterThan(source.y + source.height + 35);
  if (width > 700) {
    for (const child of children) expect(Math.abs(child.y - children[0].y)).toBeLessThan(2);
  } else {
    expect(Math.abs(children[0].y - children[1].y)).toBeLessThan(2);
    expect(Math.abs(children[2].y - children[3].y)).toBeLessThan(2);
    expect(children[2].y).toBeGreaterThan(children[0].y + children[0].height + 35);
  }
  const routes = await section.evaluate(host => {
    const deck = host.querySelector(".workflow-unfold-deck").getBoundingClientRect();
    const boxes = [...host.querySelectorAll(".workflow-unfold-card")].map(card => {
      const box = card.getBoundingClientRect();
      return { left: box.left - deck.left, right: box.right - deck.left, top: box.top - deck.top, bottom: box.bottom - deck.top };
    });
    return [...host.querySelectorAll(".workflow-unfold-beam")].map((beam, index) => {
      const length = beam.getTotalLength();
      const first = beam.getPointAtLength(0);
      const last = beam.getPointAtLength(length);
      const source = boxes[0];
      const target = boxes[index + 1];
      let crossesSibling = false;
      for (let step = 1; step < 40; step++) {
        const point = beam.getPointAtLength(length * step / 40);
        crossesSibling ||= boxes.some((box, cardIndex) => cardIndex !== 0 && cardIndex !== index + 1 && point.x > box.left + 1 && point.x < box.right - 1 && point.y > box.top + 1 && point.y < box.bottom - 1);
      }
      return { startsAtInquiry: Math.abs(first.x - (source.left + source.right) / 2) < 2 && Math.abs(first.y - source.bottom) < 2, endsAtChild: Math.abs(last.x - (target.left + target.right) / 2) < 2 && Math.abs(last.y - target.top) < 2, crossesSibling };
    });
  });
  expect(routes).toEqual(Array.from({ length: 4 }, () => ({ startsAtInquiry: true, endsAtChild: true, crossesSibling: false })));
}

for (const width of [390, 1440]) {
  test(`${width}px scroll branches one upper inquiry into four lower stages and reverses on return`, async ({ page }) => {
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

    for (const progress of [.2, .28, .4, .55, .7]) {
      await page.evaluate(({ entry, progress }) => scrollTo({ top: entry + innerHeight * .1 + Math.min(340, innerHeight * (innerWidth <= 700 ? .4 : .36)) * progress, behavior: "instant" }), { entry, progress });
      await expect.poll(async () => Number(await section.getAttribute("data-unfold-progress"))).toBeCloseTo(progress, 2);
      const overlappingText = await section.locator(".workflow-unfold-card").evaluateAll(cards => cards.flatMap((card, index) => {
        if (index === 0 || Number(getComputedStyle(card.querySelector("h3")).opacity) < .05) return [];
        const box = card.getBoundingClientRect();
        return cards.some((other, otherIndex) => {
          if (otherIndex === index || Number(getComputedStyle(other).opacity) < .05) return false;
          const next = other.getBoundingClientRect();
          return box.left < next.right - 1 && box.right > next.left + 1 && box.top < next.bottom - 1 && box.bottom > next.top + 1;
        }) ? [card.querySelector("h3").textContent] : [];
      }));
      expect(overlappingText, `Labels wait until their cards separate at progress ${progress}`).toEqual([]);
      if (progress === .28) await page.screenshot({ path: `outputs/webgl/workflow-branching-${width}-opening.png` });
    }

    await page.evaluate(top => scrollTo({ top, behavior: "instant" }), entry + 600);
    await expect(section).toHaveAttribute("data-unfold-state", "open");
    const opened = await cardPoses(section);
    expect(opened.map(card => card.opacity)).toEqual([1, 1, 1, 1, 1]);
    for (const title of await section.locator(".workflow-unfold-card h3").all()) await expect(title).toHaveCSS("opacity", "1");
    await expectBranchHierarchy(section, width);
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
    test(`${width}px ${locale} reduced motion shows a readable inquiry with four connected branches`, async ({ page }) => {
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
      await expectBranchHierarchy(section, width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
}

test("resizing while the folded sequence is offscreen keeps the page within the viewport", async ({ page }) => {
  const section = await openUnfold(page, { width: 1920 });
  await expect(section).toHaveAttribute("data-unfold-visible", "false");
  for (const width of [390, 1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(section).toHaveAttribute("data-unfold-state", "folded");
    const inquiry = (await cardPoses(section))[0];
    expect(inquiry.x).toBeGreaterThanOrEqual(0);
    expect(inquiry.x + inquiry.width).toBeLessThanOrEqual(width);
  }
});

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
    const [source, ...children] = await cardPoses(page.locator(".workflow-unfold"));
    expect(children.every(card => card.y > source.y + source.height)).toBe(true);
    await expect(page.locator(".workflow-unfold-static-compact")).toBeVisible();
    await expect(page.locator(".workflow-unfold-static-compact path")).toHaveCount(4);
  });
});
