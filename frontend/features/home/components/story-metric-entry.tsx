import { useEffect, useRef } from "react";
import gsap from "gsap";

const formatCount = (value: number, decimals: number, digits: number) => value.toFixed(decimals).padStart(digits, "0");

/** Screen readers always get the real result, never the decorative count-up. */
export function StoryCount({ value, decimals = 0, digits = 1 }: { value: number; decimals?: number; digits?: number }) {
  const final = formatCount(value, decimals, digits);
  return <><span className="story-entry-count" aria-hidden="true" data-story-count={value} data-count-decimals={decimals} data-count-digits={digits} style={{ minWidth: `${final.length}ch` }}>{final}</span><span className="sr-only">{final}</span></>;
}

/** One coordinated entry per graph; there is no tween/timer before it enters view. */
export function useStoryMetricEntry(revision: string) {
  const rootRef = useRef<HTMLDivElement>(null);
  const entered = useRef(new WeakSet<Element>());

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motionRoot = root.closest<HTMLElement>("[data-motion-paused]");
    // The parent's SSR-safe reduced-motion default is not a user pause. Child
    // effects can run before its first preference read has committed.
    const motionReady = () => motionRoot?.dataset.motionReady !== "false";
    const motionPaused = () => motionRoot?.dataset.motionPaused === "true";
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
      scene.querySelectorAll<SVGElement>("[data-story-ring]").forEach((element) => {
        element.style.removeProperty("stroke-dasharray");
        element.style.removeProperty("stroke-dashoffset");
        element.style.removeProperty("opacity");
      });
      scene.querySelectorAll<HTMLElement | SVGElement>("[data-story-segment], [data-story-task-marker], [data-story-meter], [data-story-day-cell]").forEach((element) => {
        element.style.removeProperty("transform");
        element.style.removeProperty("transform-origin");
        element.style.removeProperty("opacity");
      });
      scene.querySelectorAll<HTMLElement>("[data-story-prism]").forEach((element) => {
        element.style.removeProperty("--story-prism-grow");
      });
      scene.dataset.storyEntryState = "complete";
    };
    const enter = (scene: HTMLElement) => {
      if (entered.current.has(scene) || document.hidden || preference.matches) return;
      if (!motionReady() || motionPaused()) return;
      entered.current.add(scene);
      scene.dataset.storyEntryState = "running";
      // Open evidence columns enter left to right, with the count and its
      // graphic sharing the same bounded offset. Other plots start immediately.
      const entryOffset = Math.min(2, Math.max(0, Number(scene.dataset.storyEntryOrder) || 0)) * .12;
      const counter = { progress: 0 };
      const timeline = gsap.timeline({ paused: true, onComplete: () => restore(scene) });
      active.set(scene, timeline);
      if (scene.querySelector("[data-story-count]")) {
        renderCount(scene, 0);
        timeline.to(counter, { progress: 1, duration: 1.45, ease: "power2.out", onUpdate: () => renderCount(scene, counter.progress) }, entryOffset);
      }

      // Scale the bodies in their local vertical axis, before their 3D rotation.
      // Their connected caps keep full depth; labels and grid baselines stay put.
      const prisms = scene.querySelectorAll("[data-story-prism]");
      if (prisms.length) timeline.fromTo(prisms, { "--story-prism-grow": .025 }, { "--story-prism-grow": 1, duration: .74, stagger: .1, ease: "power3.out" }, entryOffset + .06);
      const meters = scene.querySelectorAll("[data-story-meter]");
      if (meters.length) timeline.fromTo(meters, { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: .68, stagger: .1, ease: "power3.out" }, entryOffset + .06);
      // A half-day cell represents the same value throughout entry. Row starts
      // are coordinated, with a short left-to-right wave inside each row.
      scene.querySelectorAll<HTMLElement>("[data-story-day-row]").forEach((row, index) => {
        const cells = row.querySelectorAll("[data-story-day-cell].is-active");
        if (cells.length) timeline.fromTo(cells, { scaleX: 0, opacity: .3, transformOrigin: "left center" }, { scaleX: 1, opacity: 1, duration: .32, stagger: .035, ease: "power2.out" }, entryOffset + .06 + index * .1);
      });

      const ring = scene.querySelector<SVGCircleElement>("[data-story-ring]");
      if (ring) timeline.fromTo(ring, { strokeDasharray: "0 100", opacity: 0 }, { strokeDasharray: ring.getAttribute("stroke-dasharray") ?? "0 100", opacity: 1, duration: 1.45, ease: "power2.out" }, entryOffset);
      const taskMarkers = scene.querySelectorAll("[data-story-task-marker]");
      if (taskMarkers.length) timeline.fromTo(taskMarkers, { opacity: .35, y: 4 }, { opacity: 1, y: 0, duration: .45, stagger: .1, ease: "power2.out" }, entryOffset + .1);
      const segments = scene.querySelectorAll("[data-story-segment]");
      if (segments.length) timeline.fromTo(segments, { scaleY: .14, opacity: .15, transformOrigin: "center bottom" }, { scaleY: 1, opacity: 1, duration: .5, stagger: .055, ease: "power2.out" }, entryOffset + .08);
      timeline.play();
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const scene = entry.target as HTMLElement;
        if (entry.isIntersecting && entry.intersectionRatio >= .35) {
          visible.add(scene);
          enter(scene);
        } else {
          visible.delete(scene);
          // Scrolling past a card completes it, rather than running offscreen
          // or replaying a partly counted number on the way back.
          if (active.has(scene)) restore(scene);
        }
      }
    }, { threshold: .35, rootMargin: "0px 0px -6% 0px" });
    const syncMotion = () => {
      if (preference.matches) {
        for (const scene of scenes) {
          entered.current.add(scene);
          restore(scene);
        }
        return;
      }
      if (!motionReady()) return;
      if (motionPaused()) {
        // Finish active entries but don't consume graphs not yet visited.
        for (const scene of scenes) restore(scene);
        return;
      }
      for (const scene of scenes) if (!entered.current.has(scene)) scene.dataset.storyEntryState = "waiting";
      for (const scene of visible) enter(scene);
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
      } else if (motionReady() && motionPaused()) {
        restore(scene);
      } else {
        scene.dataset.storyEntryState = "waiting";
      }
      observer.observe(scene);
    }
    const motionObserver = new MutationObserver(syncMotion);
    if (motionRoot) motionObserver.observe(motionRoot, { attributes: true, attributeFilter: ["data-motion-paused", "data-motion-ready"] });
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      motionObserver.disconnect();
      preference.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
      for (const scene of scenes) restore(scene);
    };
  }, [revision]);

  return rootRef;
}
