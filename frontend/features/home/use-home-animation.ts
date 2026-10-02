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
      gsap.from(".nav-shell", { y: -12, opacity: 0, duration: .6, ease: "power3.out" });
      gsap.from(".spatial-heading > *", { y: 22, opacity: 0, filter: "blur(5px)", duration: .9, stagger: .08, ease: "power3.out" });
      gsap.from(".spatial-flow", { y: 25, opacity: 0, duration: 1.1, delay: .2, ease: "power3.out" });
      gsap.utils.toArray<HTMLElement>("[data-story-reveal], .spatial-comparison-heading, .spatial-comparison-grid article, .spatial-closing > div").forEach((element) => {
        gsap.from(element, { y: 24, opacity: 0, filter: "blur(6px)", duration: .8, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 92%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>(".story-review-chat").forEach((element) => {
        gsap.from(element.querySelectorAll("[data-story-chat]"), { y: 12, opacity: 0, duration: .6, stagger: .3, ease: "power2.out", scrollTrigger: { trigger: element, start: "top 86%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>("[data-story-meter]").forEach((element) => {
        gsap.from(element, { scaleX: 0, transformOrigin: "left center", duration: 1.25, ease: "power2.out", scrollTrigger: { trigger: element, start: "top 90%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>("[data-story-prism]").forEach((element, index) => {
        gsap.from(element, { y: 30, opacity: 0, duration: 1, delay: index * .08, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 92%", once: true } });
      });
    });
    motion.add("(min-width: 821px) and (prefers-reduced-motion: no-preference)", () => {
      const plate = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-plate]");
      const scene = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-scene]");
      const copy = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-copy]");
      const mark = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-mark]");
      const target = pageRef.current?.querySelector<HTMLElement>("[data-story-brand-target]");
      const card = pageRef.current?.querySelector<HTMLElement>("[data-story-merge-card]");
      const stage = scene?.querySelector<HTMLElement>(".story-brand-stage");
      if (!plate || !scene || !copy || !mark || !target || !card || !stage) return;

      // Read actual layout on refresh, including translated copy and loaded fonts.
      // The source is outside the clipped plate so it can become the lower hub.
      const squareClip = () => {
        const half = mark.offsetWidth * .78;
        const top = stage.offsetHeight * .57;
        return `inset(${top - half}px ${stage.offsetWidth / 2 - half}px ${stage.offsetHeight - top - half}px round 28px)`;
      };
      const destination = () => {
        const from = stage.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        return { x: to.left + to.width / 2 - (from.left + from.width / 2), y: to.top + to.height / 2 - (from.top + from.height * .57), scale: to.width / mark.offsetWidth };
      };
      gsap.set(mark, { xPercent: -50, yPercent: -50, x: 0, y: 0, transformOrigin: "center center" });
      gsap.set(target, { autoAlpha: 0 });
      const timeline = gsap.timeline({ scrollTrigger: { id: "story-brand-fold", trigger: scene, start: "center 82%", end: "center 42%", scrub: .45, invalidateOnRefresh: true } });
      timeline.fromTo(plate, { clipPath: squareClip }, { clipPath: "inset(0% 0% round 20px)", duration: 1.4, ease: "power2.inOut" })
        .fromTo(copy, { opacity: 0 }, { opacity: 1, duration: .6 }, .8)
        .to({}, { duration: .7 })
        .to(copy, { opacity: 0, duration: .5 })
        .to(plate, { clipPath: squareClip, duration: 1.4, ease: "power2.inOut" }, "<");

      // One mark travels all the way into the empty radial hub. Its page-space
      // delta cancels the intervening scroll; no fixed viewport coordinates.
      // A zero-duration handoff at the same geometry also reverses cleanly.
      const transfer = gsap.timeline({ scrollTrigger: { id: "story-brand-merge", trigger: scene, start: "center 42%", endTrigger: target, end: "center 65%", scrub: .45, invalidateOnRefresh: true } });
      transfer.to(plate, { autoAlpha: 0, duration: .12, ease: "power1.in" }, 0)
        .fromTo(mark, { x: 0, y: 0, scale: 1, autoAlpha: 1, color: "#d7baff", backgroundColor: "#171021" }, { x: () => destination().x, y: () => destination().y, scale: () => destination().scale, duration: 1, ease: "none" }, 0)
        .to(mark, { color: "#24142f", backgroundColor: "#cfacf0", boxShadow: "inset 0 1px #ffffff88, 0 0 38px #c391e521", duration: .22 }, .78)
        .set(target, { autoAlpha: 1 }, 1)
        .set(mark, { autoAlpha: 0 }, 1);

      let refreshFrame = 0;
      const layoutObserver = new ResizeObserver(() => {
        cancelAnimationFrame(refreshFrame);
        refreshFrame = requestAnimationFrame(() => ScrollTrigger.refresh());
      });
      layoutObserver.observe(pageRef.current!);
      layoutObserver.observe(card);
      return () => { layoutObserver.disconnect(); cancelAnimationFrame(refreshFrame); };
    });
    return () => { ambientObserver.disconnect(); motion.revert(); };
  }, { scope: pageRef });
  return pageRef;
}
