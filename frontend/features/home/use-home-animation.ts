import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function useHomeAnimation() {
  const pageRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      gsap.from(".nav-shell", { y: -24, opacity: 0, duration: 0.75, ease: "power3.out" });
      gsap.from(".hero-reveal", {
        y: 50,
        opacity: 0,
        duration: 1,
        stagger: 0.11,
        ease: "power3.out"
      });
      gsap.to(".scrub-word", {
        opacity: 1,
        stagger: 0.1,
        scrollTrigger: {
          trigger: ".manifesto-copy",
          start: "top 82%",
          end: "bottom 48%",
          scrub: 1
        }
      });
      gsap.utils.toArray<HTMLElement>(".scale-fade").forEach((element) => {
        gsap.fromTo(
          element,
          { scale: 0.88, opacity: 0.25 },
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
    },
    { scope: pageRef }
  );

  return pageRef;
}
