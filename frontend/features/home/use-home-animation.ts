import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function useHomeAnimation() {
  const pageRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(".nav-shell", { y: -12, opacity: 0, duration: .6, ease: "power3.out" });
      gsap.from(".spatial-heading > *", { y: 22, opacity: 0, filter: "blur(5px)", duration: .9, stagger: .08, ease: "power3.out" });
      gsap.from(".spatial-flow", { y: 25, opacity: 0, duration: 1.1, delay: .2, ease: "power3.out" });
      gsap.utils.toArray<HTMLElement>("[data-story-reveal], .spatial-comparison-heading, .spatial-comparison-grid article, .spatial-closing > div").forEach((element) => {
        gsap.from(element, { y: 24, opacity: 0, filter: "blur(6px)", duration: .8, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 92%", once: true } });
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
      if (!plate || !scene || !copy) return;
      const timeline = gsap.timeline({ scrollTrigger: { trigger: scene, start: "top 83%", end: "bottom 18%", scrub: .7 } });
      timeline.fromTo(plate, { clipPath: "inset(28% 43% round 28px)" }, { clipPath: "inset(0% 0% round 20px)", duration: 1.4, ease: "power2.inOut" })
        .fromTo(copy, { opacity: 0 }, { opacity: 1, duration: .6 }, .8)
        .to({}, { duration: .7 })
        .to(copy, { opacity: 0, duration: .5 })
        .to(plate, { clipPath: "inset(28% 43% round 28px)", duration: 1.4, ease: "power2.inOut" }, "<");
    });
    return () => motion.revert();
  }, { scope: pageRef });
  return pageRef;
}
