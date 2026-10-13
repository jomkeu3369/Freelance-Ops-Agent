const neutralGaze = Object.freeze({ x: 0, y: 0 });

/**
 * Translate a viewport pointer into small SVG eye movements. Bounds and pointer
 * coordinates must share the viewport space, so page scrolling needs no offsets.
 * @param {{ x: number, y: number }} pointer
 * @param {{ left: number, top: number, width: number, height: number }} bounds
 */
export function petGazeOffset(pointer, bounds) {
  if (![pointer.x, pointer.y, bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0) return neutralGaze;
  const eyeX = bounds.left + bounds.width * .5;
  const eyeY = bounds.top + bounds.height * (53 / 128);
  const dx = (pointer.x - eyeX) / Math.max(bounds.width, 80);
  const dy = (pointer.y - eyeY) / Math.max(bounds.height, 80);
  const distance = Math.hypot(dx, dy);
  const scale = distance > 1 ? 1 / distance : 1;
  return { x: Math.round(dx * scale * 4 * 1000) / 1000, y: Math.round(dy * scale * 2.5 * 1000) / 1000 };
}

/**
 * One frame and one set of passive listeners serve every visible pet. No React
 * renders, API requests, execution changes, or stored preferences are involved.
 * @param {Window} browser
 */
export function createPetGazeTracker(browser) {
  const pets = new Set();
  const reducedMotion = browser.matchMedia("(prefers-reduced-motion: reduce)");
  const fineHover = browser.matchMedia("(hover: hover) and (pointer: fine)");
  let pointer = null;
  let frame = 0;

  function setGaze(pet, offset) {
    pet.querySelector(".pet-eyes")?.setAttribute("transform", `translate(${offset.x} ${offset.y})`);
  }
  function cancelFrame() {
    if (frame) browser.cancelAnimationFrame(frame);
    frame = 0;
  }
  function reset() {
    pointer = null;
    cancelFrame();
    pets.forEach(pet => setGaze(pet, neutralGaze));
  }
  function enabled() {
    return !reducedMotion.matches && fineHover.matches && browser.document.visibilityState !== "hidden";
  }
  function paint() {
    frame = 0;
    if (!pointer || !enabled()) return reset();
    pets.forEach(pet => {
      if (pet.isConnected) setGaze(pet, petGazeOffset(pointer, pet.getBoundingClientRect()));
    });
  }
  function schedule() {
    if (pointer && enabled() && !frame) frame = browser.requestAnimationFrame(paint);
  }
  function onPointer(event) {
    // A touch on hybrid hardware is neutral too. Pen hover can look, pen dragging cannot.
    if (!enabled() || event.pointerType === "touch" || event.buttons > 0) return reset();
    if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  }
  function onPointerDown(event) {
    if (event.pointerType === "touch" || event.pointerType === "pen") reset();
  }
  function onPointerOut(event) { if (!event.relatedTarget) reset(); }
  function onVisibility() { if (!enabled()) reset(); }
  function start() {
    browser.addEventListener("pointermove", onPointer, { passive: true });
    browser.addEventListener("pointerdown", onPointerDown, { passive: true });
    browser.addEventListener("pointerout", onPointerOut, { passive: true });
    browser.addEventListener("blur", reset);
    browser.addEventListener("pagehide", reset);
    browser.addEventListener("scroll", schedule, { passive: true, capture: true });
    browser.addEventListener("resize", schedule, { passive: true });
    browser.document.addEventListener("visibilitychange", onVisibility);
    reducedMotion.addEventListener("change", reset);
    fineHover.addEventListener("change", reset);
  }
  function stop() {
    reset();
    browser.removeEventListener("pointermove", onPointer);
    browser.removeEventListener("pointerdown", onPointerDown);
    browser.removeEventListener("pointerout", onPointerOut);
    browser.removeEventListener("blur", reset);
    browser.removeEventListener("pagehide", reset);
    browser.removeEventListener("scroll", schedule, true);
    browser.removeEventListener("resize", schedule);
    browser.document.removeEventListener("visibilitychange", onVisibility);
    reducedMotion.removeEventListener("change", reset);
    fineHover.removeEventListener("change", reset);
  }
  return {
    /** @param {SVGSVGElement} pet */
    subscribe(pet) {
      if (!pets.size) start();
      pets.add(pet);
      setGaze(pet, neutralGaze);
      schedule();
      return () => {
        setGaze(pet, neutralGaze);
        pets.delete(pet);
        if (!pets.size) stop();
      };
    }
  };
}
