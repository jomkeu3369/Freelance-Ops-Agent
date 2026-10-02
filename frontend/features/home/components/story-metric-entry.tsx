import { useEffect, useRef } from "react";
import gsap from "gsap";

const formatCount = (value: number, decimals: number, digits: number) => value.toFixed(decimals).padStart(digits, "0");

/** Screen readers always get the real result, never the decorative count-up. */
export function StoryCount({ value, decimals = 0, digits = 1 }: { value: number; decimals?: number; digits?: number }) {
  const final = formatCount(value, decimals, digits);
  return <><span className="story-entry-count" aria-hidden="true" data-story-count={value} data-count-decimals={decimals} data-count-digits={digits} style={{ minWidth: `${final.length}ch` }}>{final}</span><span className="sr-only">{final}</span></>;
}

/** One short entry per card; there is no tween/timer before it enters view. */
export function useStoryMetricEntry(revision: string) {
  const rootRef = useRef<HTMLDivElement>(null);
  const entered = useRef(new WeakSet<Element>());

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scenes = Array.from(root.querySelectorAll<HTMLElement>("[data-story-metric-scene]"));
    const active = new Map<HTMLElement, gsap.core.Timeline>();
    const visible = new Set<HTMLElement>();

    // Read current DOM props, including after a scope change. Never leave a
    // captured essential-scope value over a newly rendered extended scope.
    const renderCount = (scene: HTMLElement, progress: number) => {
      scene.querySelectorAll<HTMLElement>("[data-story-count]").forEach((element) => {
        const value = Number(element.dataset.storyCount);
        const decimals = Number(element.dataset.countDecimals);
        const digits = Number(element.dataset.countDigits);
        element.textContent = formatCount(value * progress, decimals, digits);
      });
    };
    const restore = (scene: HTMLElement) => {
      active.get(scene)?.kill();
      active.delete(scene);
      renderCount(scene, 1);
      scene.querySelectorAll<SVGElement>("[data-story-ring], [data-story-sparkline]").forEach((element) => {
        element.style.removeProperty("stroke-dasharray");
        element.style.removeProperty("stroke-dashoffset");
        element.style.removeProperty("opacity");
      });
      scene.querySelectorAll<HTMLElement | SVGElement>("[data-story-segment], [data-story-spark-point]").forEach((element) => {
        element.style.removeProperty("transform");
        element.style.removeProperty("transform-origin");
        element.style.removeProperty("opacity");
      });
      scene.dataset.storyEntryState = "complete";
    };
    const enter = (scene: HTMLElement) => {
      if (entered.current.has(scene) || document.hidden || preference.matches) return;
      entered.current.add(scene);
      scene.dataset.storyEntryState = "running";
      const counter = { progress: 0 };
      const timeline = gsap.timeline({ paused: true, onComplete: () => restore(scene) });
      active.set(scene, timeline);
      renderCount(scene, 0);
      timeline.to(counter, { progress: 1, duration: 1.45, ease: "power2.out", onUpdate: () => renderCount(scene, counter.progress) }, 0);

      const ring = scene.querySelector<SVGCircleElement>("[data-story-ring]");
      if (ring) timeline.fromTo(ring, { strokeDasharray: "0 100", opacity: 0 }, { strokeDasharray: ring.getAttribute("stroke-dasharray") ?? "0 100", opacity: 1, duration: 1.45, ease: "power2.out" }, 0);
      const sparkline = scene.querySelector<SVGPolylineElement>("[data-story-sparkline]");
      if (sparkline) timeline.fromTo(sparkline, { strokeDasharray: "100 100", strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 1.3, ease: "power2.inOut" }, 0);
      const points = scene.querySelectorAll("[data-story-spark-point]");
      if (points.length) timeline.fromTo(points, { opacity: 0 }, { opacity: 1, duration: .35, stagger: .15, ease: "power1.out" }, .45);
      const segments = scene.querySelectorAll("[data-story-segment]");
      if (segments.length) timeline.fromTo(segments, { scaleY: .14, opacity: .15, transformOrigin: "center bottom" }, { scaleY: 1, opacity: 1, duration: .5, stagger: .055, ease: "power2.out" }, .08);
      timeline.play();
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const scene = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          visible.add(scene);
          enter(scene);
        } else {
          visible.delete(scene);
          // Scrolling past a card completes it, rather than running offscreen
          // or replaying a partly counted number on the way back.
          if (active.has(scene)) restore(scene);
        }
      }
    }, { threshold: .12, rootMargin: "0px 0px -6% 0px" });
    const syncMotion = () => {
      if (!preference.matches) return;
      for (const scene of scenes) {
        entered.current.add(scene);
        restore(scene);
      }
    };
    const syncVisibility = () => {
      if (document.hidden) {
        for (const scene of active.keys()) restore(scene);
      } else {
        for (const scene of visible) enter(scene);
      }
    };
    for (const scene of scenes) {
      if (preference.matches || entered.current.has(scene)) {
        entered.current.add(scene);
        restore(scene);
      } else {
        scene.dataset.storyEntryState = "waiting";
      }
      observer.observe(scene);
    }
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
      for (const scene of scenes) restore(scene);
    };
  }, [revision]);

  return rootRef;
}
