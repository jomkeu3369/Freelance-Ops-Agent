import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createBrandFlight } from "./brand-flight.mjs";
import { restoreInitialAnchor } from "./initial-anchor.mjs";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function useHomeAnimation() {
  const pageRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const ambientObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) (entry.target as HTMLElement).dataset.ambientVisible = String(entry.isIntersecting);
    }, { threshold: .08 });
    pageRef.current?.querySelectorAll<HTMLElement>("[data-ambient]").forEach((element) => ambientObserver.observe(element));
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      // CSS owns percentage-based centering. A GSAP transform would cache its
      // horizontal pixel offset and move the header offscreen after zoom/resize.
      gsap.from(".nav-shell", { opacity: 0, duration: .6, ease: "power3.out" });
      gsap.from(".spatial-heading > *", { y: 14, opacity: 0, duration: .8, stagger: .08, ease: "power3.out" });
      gsap.from(".pointer-depth-hero", { y: 25, opacity: 0, duration: 1.1, delay: .2, ease: "power3.out" });
      gsap.utils.toArray<HTMLElement>("[data-story-reveal], .spatial-comparison-heading, .spatial-comparison-grid article, .spatial-closing > div").forEach((element) => {
        gsap.from(element, { y: 16, opacity: 0, duration: .8, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 92%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>(".story-review-chat").forEach((element) => {
        gsap.from(element.querySelectorAll("[data-story-chat]"), { y: 12, opacity: 0, duration: .6, stagger: .3, ease: "power2.out", scrollTrigger: { trigger: element, start: "top 86%", once: true } });
      });
    });
    motion.add("(min-width: 821px) and (prefers-reduced-motion: no-preference)", () => {
      const intro = pageRef.current?.querySelector<HTMLElement>("[data-story-intro]");
      let opening: gsap.core.Timeline | undefined;
      const finishOpening = () => { opening?.kill(); if (intro) gsap.set(intro, { display: "none" }); };
      if (intro && window.scrollY < 16 && (!window.location.hash || window.location.hash === "#top") && !document.hidden) {
        const shell = intro.querySelector(".spatial-intro-shell");
        const openingMark = intro.querySelector(".spatial-intro-mark");
        const size = Math.max(window.innerWidth, window.innerHeight) * 1.5;
        gsap.set(intro, { display: "block" });
        gsap.set(shell, { width: size, height: size, xPercent: -50, yPercent: -50, scale: 1 });
        opening = gsap.timeline({ onComplete: () => gsap.set(intro, { display: "none" }) });
        opening.to(shell, { scale: 90 / size, duration: .64, ease: "power2.inOut" })
          .to(shell, { opacity: 0, duration: .12 }, .56)
          .to(openingMark, { opacity: 0, scale: .82, duration: .17 }, .61);
      }
      // Decorative, never a loading gate. Input or scrolling dismisses it.
      const interruptEvents = ["wheel", "touchstart", "pointerdown", "keydown", "scroll", "visibilitychange"] as const;
      interruptEvents.forEach((event) => window.addEventListener(event, finishOpening, { passive: true, once: true }));
      const plate = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-plate]");
      const scene = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-scene]");
      const copy = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-copy]");
      const mark = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-mark]");
      const target = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-target]");
      const card = pageRef.current?.querySelector<HTMLElement>("[data-story-merge-card]");
      const stage = scene?.querySelector<HTMLElement>(".story-brand-stage");
      if (!plate || !scene || !copy || !mark || !target || !card || !stage) return () => {
        finishOpening(); interruptEvents.forEach((event) => window.removeEventListener(event, finishOpening));
      };

      // Read actual layout on refresh, including translated copy and loaded fonts.
      // The source is outside the clipped plate so it can become the lower hub.
      const clipInsets = () => {
        const half = mark.offsetWidth * .78;
        const top = mark.offsetTop;
        const side = stage.offsetWidth / 2 - half;
        return { top: top - half, side, bottom: stage.offsetHeight - top - half };
      };
      const destination = () => {
        const from = stage.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        return { x: to.left + to.width / 2 - (from.left + from.width / 2), y: to.top + to.height / 2 - (from.top + mark.offsetTop), scale: to.width / mark.offsetWidth };
      };
      const placeMark = () => gsap.set(mark, { top: Math.max(stage.offsetHeight * .57 + 24, copy.offsetTop + copy.offsetHeight + 24 + mark.offsetHeight / 2) });
      const drift = () => window.innerHeight * .12;
      let flight = createBrandFlight();
      const refreshFlight = () => {
        placeMark();
        const from = stage.getBoundingClientRect();
        const origin = { x: from.left + from.width / 2, y: from.top + mark.offsetTop };
        const cards = [...card.parentElement!.querySelectorAll<HTMLElement>(".story-benefit-card")];
        const blocks = cards.map(item => {
          const revealY = Number(gsap.getProperty(item, "y")) || 0;
          return [...item.querySelectorAll<HTMLElement>(":scope > h3, :scope > p:not(.story-panel-footnote)")].map(block => {
            const rect = block.getBoundingClientRect();
            return { left: rect.left, right: rect.right, bottom: rect.bottom - revealY };
          });
        });
        const left = Math.max(...blocks[0].map(rect => rect.right));
        const right = Math.min(...blocks[1].map(rect => rect.left));
        const size = Math.min(mark.offsetWidth * .64, Math.max(36, right - left - 20));
        const copyBottom = Math.max(...blocks.flat().map(rect => rect.bottom));
        flight = createBrandFlight({
          start: { x: 0, y: drift(), scale: 1 }, corridorX: (left + right) / 2 - origin.x,
          clearY: copyBottom - origin.y + size / 2 + 20,
          destination: destination(), compactScale: size / mark.offsetWidth
        });
      };
      refreshFlight();
      ScrollTrigger.addEventListener("refreshInit", refreshFlight);
      gsap.set(mark, { xPercent: -50, yPercent: -50, x: 0, y: 0, transformOrigin: "center center" });
      gsap.set(target, { autoAlpha: 0 });
      // The panel is readable from first visibility. One scrubbed playhead
      // owns hold, collapse and travel, preventing conflicting boundary clocks.
      // CSSOM normalizes inset shorthand. Tween scalar custom properties,
      // never the serialized shape string; both sides share one value.
      gsap.set(plate, {
        clipPath: "inset(var(--brand-clip-top) var(--brand-clip-side) var(--brand-clip-bottom) var(--brand-clip-side) round var(--brand-clip-radius))",
        "--brand-clip-top": "0px", "--brand-clip-side": "0px", "--brand-clip-bottom": "0px", "--brand-clip-radius": "20px",
        autoAlpha: 1, y: 0
      });
      gsap.set(copy, { opacity: 1 });
      // Measure once per layout refresh. Scrubbing samples only numeric geometry,
      // staying in the text gutter before turning into the diagram below copy.
      const flightProgress = { value: 0 };
      const renderFlight = () => gsap.set(mark, flight.sample(flightProgress.value));
      let poseFrame = 0;
      const syncRefreshedPose = () => {
        cancelAnimationFrame(poseFrame);
        poseFrame = requestAnimationFrame(() => {
          const trigger = transfer.scrollTrigger;
          if (!trigger) return;
          // Refresh restores the timeline with callbacks suppressed. Finish any
          // old scrub and explicitly paint its numeric flight at the new layout.
          trigger.getTween()?.progress(1);
          transfer.progress(trigger.progress, true);
          if (trigger.progress >= .46) renderFlight();
        });
      };
      const transfer = gsap.timeline({ scrollTrigger: {
        id: "story-brand-merge", trigger: stage, start: "center 70%", endTrigger: target, end: "center 65%",
        scrub: .85, invalidateOnRefresh: true, onRefresh: syncRefreshedPose
      } });
      transfer.to(plate, { y: drift, duration: .46, ease: "none" }, 0)
        .fromTo(mark, { x: 0, y: 0, scale: 1, autoAlpha: 1, color: "#d7baff", backgroundColor: "#171021" }, { y: drift, duration: .46, ease: "none" }, 0)
        .fromTo(plate, {
          "--brand-clip-top": "0px", "--brand-clip-side": "0px", "--brand-clip-bottom": "0px", "--brand-clip-radius": "20px"
        }, {
          "--brand-clip-top": () => `${clipInsets().top}px`, "--brand-clip-side": () => `${clipInsets().side}px`,
          "--brand-clip-bottom": () => `${clipInsets().bottom}px`, "--brand-clip-radius": "28px",
          duration: .34, ease: "sine.inOut"
        }, .12)
        // Finish fading before the closing edge reaches the first text line.
        // This keeps the full-open reading hold, without clipping live glyphs.
        .to(copy, { opacity: 0, duration: .08, ease: "sine.out" }, .12)
        .to(plate, { autoAlpha: 0, duration: .09, ease: "sine.in" }, .44)
        .fromTo(flightProgress, { value: 0 }, { value: 1, onUpdate: renderFlight, immediateRender: false, duration: .54, ease: "power1.inOut" }, .46)
        .to(mark, { color: "#24142f", backgroundColor: "#cfacf0", boxShadow: "inset 0 1px #ffffff88, 0 0 38px #c391e521", duration: .24 }, .76)
        .set(target, { autoAlpha: 1 }, 1)
        .set(mark, { autoAlpha: 0 }, 1);

      let refreshFrame = 0;
      const layoutObserver = new ResizeObserver(() => {
        cancelAnimationFrame(refreshFrame);
        refreshFrame = requestAnimationFrame(() => ScrollTrigger.refresh());
      });
      // Changes below this handoff (for example estimator scope rows) cannot
      // move its target. Avoid refreshing every ScrollTrigger for those edits.
      pageRef.current!.querySelectorAll<HTMLElement>(".spatial-workflow, .spatial-capability-strip, .story-features, .story-brand-scene, .story-benefits").forEach(element => layoutObserver.observe(element));
      layoutObserver.observe(card);
      layoutObserver.observe(copy);
      // A flexed diagram can change internally while its outer card keeps the
      // same min-height (for example after translated text or fonts wrap).
      const targetFrame = target.closest<HTMLElement>(".story-radial");
      if (targetFrame) layoutObserver.observe(targetFrame);
      layoutObserver.observe(target);
      return () => {
        layoutObserver.disconnect(); cancelAnimationFrame(refreshFrame); cancelAnimationFrame(poseFrame); opening?.kill();
        ScrollTrigger.removeEventListener("refreshInit", refreshFlight);
        interruptEvents.forEach((event) => window.removeEventListener(event, finishOpening));
      };
    });
    const cancelInitialAnchor = restoreInitialAnchor(pageRef.current, () => ScrollTrigger.refresh());
    return () => { cancelInitialAnchor(); ambientObserver.disconnect(); motion.revert(); };
  }, { scope: pageRef });
  return pageRef;
}
