import { useEffect, type RefObject } from "react";
import gsap from "gsap";
import { pointerDepth } from "./pointer-depth.mjs";

/** One stable anchor drives the whole panel; content and its shell share a pivot. */
export function usePointerDepth(pageRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const media = window.matchMedia("(min-width: 821px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    const hosts = Array.from(root.querySelectorAll<HTMLElement>(".spatial-flow, .story-execution, .story-effort-prisms, .story-dashboard-ring"));
    const visible = new Set<Element>();
    const motionRoot = root.querySelector<HTMLElement>("[data-motion-paused]");
    const enabled = () => media.matches && !document.hidden && motionRoot?.dataset.motionPaused !== "true";
    const neutral = { "--pointer-rx": 0, "--pointer-ry": 0, "--pointer-x": 50, "--pointer-y": 50, "--pointer-strength": 0 };
    type Values = typeof neutral;
    const controls = new Map<HTMLElement, { reset: (immediate?: boolean) => void; invalidate: () => void }>();
    const cleanups = hosts.map(host => {
      host.dataset.pointerDepth = "true";
      const anchor = host.closest<HTMLElement>(".pointer-depth-anchor") ?? host;
      let bounds: DOMRect | undefined;
      let frame = 0;
      let clientX = 0;
      let clientY = 0;
      // Allocate once, only for an interacted-with host. quickTo reuses its
      // existing tween instead of creating independent layer tweens every frame.
      const channels = new Map<string, ReturnType<typeof gsap.quickTo>>();
      const steer = (values: Values, options = { duration: .24 }, immediate = false) => {
        for (const [property, value] of Object.entries(values)) {
          let channel = channels.get(property);
          if (!channel) {
            channel = gsap.quickTo(host, property, { duration: .24, ease: "power2.out" });
            channels.set(property, channel);
          }
          channel.tween.duration(options.duration);
          channel(value);
          if (immediate) channel.tween.progress(1).pause();
        }
      };
      const reset = (immediate = false) => {
        cancelAnimationFrame(frame);
        frame = 0;
        bounds = undefined;
        host.dataset.pointerActive = "false";
        // An offscreen or disabled host that was never used needs no tween.
        if (channels.size) steer(neutral, { duration: immediate ? 0 : .5 }, immediate);
      };
      const invalidate = () => { bounds = undefined; };
      controls.set(host, { reset, invalidate });
      const enter = () => { if (enabled() && visible.has(host)) bounds = anchor.getBoundingClientRect(); };
      const move = (event: PointerEvent) => {
        if (event.pointerType === "touch" || !enabled() || !visible.has(host) || host.matches(":focus-within")) return;
        clientX = event.clientX;
        clientY = event.clientY;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          // Preferences or focus may change between the event and this frame.
          if (!enabled() || !visible.has(host) || host.matches(":focus-within")) { reset(true); return; }
          bounds ??= anchor.getBoundingClientRect();
          const point = pointerDepth(clientX, clientY, bounds);
          host.dataset.pointerActive = "true";
          steer({ "--pointer-rx": point.rx, "--pointer-ry": point.ry, "--pointer-x": point.x, "--pointer-y": point.y, "--pointer-strength": 1 });
        });
      };
      const leave = () => reset();
      anchor.addEventListener("pointerenter", enter, { passive: true });
      anchor.addEventListener("pointermove", move, { passive: true });
      anchor.addEventListener("pointerleave", leave);
      anchor.addEventListener("pointercancel", leave);
      anchor.addEventListener("focusin", leave);
      return () => {
        anchor.removeEventListener("pointerenter", enter);
        anchor.removeEventListener("pointermove", move);
        anchor.removeEventListener("pointerleave", leave);
        anchor.removeEventListener("pointercancel", leave);
        anchor.removeEventListener("focusin", leave);
        cancelAnimationFrame(frame);
        channels.forEach(channel => channel.tween.kill());
        Object.keys(neutral).forEach(property => host.style.removeProperty(property));
        delete host.dataset.pointerDepth;
        delete host.dataset.pointerActive;
      };
    });
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else { visible.delete(entry.target); controls.get(entry.target as HTMLElement)?.reset(true); }
      }
    }, { threshold: .08 });
    hosts.forEach(host => observer.observe(host));
    const invalidateBounds = () => controls.forEach(control => control.invalidate());
    const sizeObserver = new ResizeObserver(invalidateBounds);
    // A sibling can move a host without resizing it, so include the page box.
    sizeObserver.observe(root);
    hosts.forEach(host => sizeObserver.observe(host));
    window.addEventListener("resize", invalidateBounds, { passive: true });
    // Scrolling changes the panel under a stationary pointer. Reset once,
    // rather than retaining a stale corner tilt or forcing scroll-time layout.
    const resetOnScroll = () => controls.forEach((control, host) => {
      control.invalidate();
      if (host.dataset.pointerActive === "true") control.reset();
    });
    window.addEventListener("scroll", resetOnScroll, { passive: true, capture: true });
    const sync = () => { if (!enabled()) controls.forEach(control => control.reset(true)); };
    const pauseObserver = new MutationObserver(sync);
    if (motionRoot) pauseObserver.observe(motionRoot, { attributes: true, attributeFilter: ["data-motion-paused"] });
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect(); pauseObserver.disconnect(); sizeObserver.disconnect();
      window.removeEventListener("resize", invalidateBounds);
      window.removeEventListener("scroll", resetOnScroll, true);
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      cleanups.forEach(cleanup => cleanup());
    };
  }, [pageRef]);
}
