import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

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
      gsap.from(".spatial-flow", { y: 25, opacity: 0, duration: 1.1, delay: .2, ease: "power3.out" });
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
      placeMark();
      ScrollTrigger.addEventListener("refreshInit", placeMark);
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
      const drift = () => window.innerHeight * .12;
      const transfer = gsap.timeline({ scrollTrigger: {
        id: "story-brand-merge", trigger: stage, start: "center 70%", endTrigger: target, end: "center 65%",
        scrub: .85, invalidateOnRefresh: true
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
        .to(copy, { opacity: 0, duration: .18, ease: "sine.inOut" }, .16)
        .to(plate, { autoAlpha: 0, duration: .09, ease: "sine.in" }, .44)
        .to(mark, { x: () => destination().x, y: () => destination().y, scale: () => destination().scale, duration: .54, ease: "power1.inOut" }, .46)
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
        layoutObserver.disconnect(); cancelAnimationFrame(refreshFrame); opening?.kill();
        ScrollTrigger.removeEventListener("refreshInit", placeMark);
        interruptEvents.forEach((event) => window.removeEventListener(event, finishOpening));
      };
    });
    return () => { ambientObserver.disconnect(); motion.revert(); };
  }, { scope: pageRef });
  return pageRef;
}
