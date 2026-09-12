import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function useHomeAnimation() {
  const pageRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const motion = gsap.matchMedia();
      motion.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".nav-shell", { y: -24, opacity: 0, duration: 0.75, ease: "power3.out" });
        gsap.from(".hero-reveal", {
          y: 28,
          opacity: 0,
          duration: 0.85,
          stagger: 0.09,
          ease: "power3.out"
        });
        gsap.fromTo(".scrub-word", { opacity: 0.24 }, {
          opacity: 1,
          stagger: 0.1,
          scrollTrigger: {
            trigger: ".manifesto-copy",
            start: "top 82%",
            end: "bottom 48%",
            scrub: 1
          }
        });
        gsap.from(".hero-stage", {
          y: 70, rotationX: 9, scale: 0.94, duration: 1.3, delay: 0.25,
          transformPerspective: 1400, ease: "power3.out"
        });
        gsap.from(".hero-float", { y: 25, opacity: 0, duration: 0.8, stagger: 0.18, delay: 0.8 });
        gsap.fromTo(".manifesto-halo", { scale: 0.6, y: 80 }, {
          scale: 1.25, y: -60, ease: "none",
          scrollTrigger: { trigger: ".manifesto", start: "top bottom", end: "bottom top", scrub: 1 }
        });
        gsap.utils.toArray<HTMLElement>(".section-heading, .problem-card, .deliverable-card, .evidence-copy, .outcome-copy, .final-cta h2").forEach((element) => {
          gsap.from(element, {
            y: 36, opacity: 0, duration: 0.75, ease: "power3.out",
            scrollTrigger: { trigger: element, start: "top 94%", once: true }
          });
        });
        gsap.utils.toArray<HTMLElement>(".scale-fade").forEach((element) => {
          gsap.fromTo(
            element,
            { scale: 0.96, opacity: 0.6 },
            {
              scale: 1,
              opacity: 1,
              ease: "none",
              scrollTrigger: {
                trigger: element,
                start: "top 92%",
                end: "top 46%",
                scrub: true
              }
            }
          );
        });
      });
      return () => motion.revert();
    },
    { scope: pageRef }
  );

  return pageRef;
}
