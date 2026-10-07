"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { SceneController, SceneKind } from "../webgl/scene-renderer";

type Props = { kind: SceneKind; children: ReactNode; paused?: boolean };

/** Keep the readable, server-rendered example until the first successful GPU frame. */
export function WebGLScene({ kind, children, paused = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SceneController | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = host.querySelector("canvas")!;
    const root = host.closest("[data-motion-paused]");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobile = window.matchMedia("(max-width: 820px)");
    let disposed = false;
    let loading = false;
    let failed = false;
    let visible = false;
    let frame = 0;
    let lastFrame = 0;
    let elapsed = 3;
    let rendered = 0;
    const pointer = { x: 0, y: 0, active: false };
    let pointerBounds: DOMRect | null = null;
    const canMove = () => visible && !document.hidden && !reduced.matches && !mobile.matches && root?.getAttribute("data-motion-paused") !== "true" && host.dataset.webglPaused !== "true";
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
      host.dataset.webglRunning = "false";
    };
    const fail = () => {
      failed = true;
      stop();
      host.dataset.webglReady = "false";
      host.dataset.webglState = "fallback";
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
    const draw = (now: number) => {
      frame = 0;
      const controller = controllerRef.current;
      if (!controller || disposed || !visible || document.hidden) return;
      const moving = canMove();
      // At most 40fps; delta is clamped after a tab or visibility interruption.
      if (moving && lastFrame && now - lastFrame < 25) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, .05) : .025;
      lastFrame = now;
      if (moving) elapsed += delta;
      try {
        controller.render(elapsed, delta, moving, moving ? pointer : { x: 0, y: 0, active: false });
        host.dataset.webglReady = "true";
        host.dataset.webglState = "ready";
        host.dataset.webglFrames = String(++rendered);
        host.dataset.webglRunning = String(moving);
        if (moving) frame = requestAnimationFrame(draw);
      } catch {
        fail();
      }
    };
    const invalidate = () => {
      stop();
      if (controllerRef.current && visible && !document.hidden && !disposed) frame = requestAnimationFrame(draw);
    };
    const start = async () => {
      if (loading || failed || disposed || controllerRef.current) return;
      loading = true;
      try {
        const { createScene } = await import("../webgl/scene-renderer");
        if (disposed) return;
        // Keep the original renderer available for visual comparison and rollback.
        const variant = kind === "footer" || new URLSearchParams(window.location.search).get("hero-light") === "classic" ? "classic" : "electric";
        controllerRef.current = createScene(canvas, kind, mobile.matches, variant);
        host.dataset.webglVariant = variant;
        controllerRef.current.resize(host.clientWidth, host.clientHeight);
        invalidate();
      } catch {
        if (!disposed) fail();
      } finally {
        loading = false;
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) void start();
      invalidate();
    }, { threshold: .01 });
    observer.observe(host);
    const resize = new ResizeObserver(() => {
      try {
        pointerBounds = null;
        pointer.active = false;
        controllerRef.current?.resize(host.clientWidth, host.clientHeight);
        invalidate();
      } catch { fail(); }
    });
    resize.observe(host);
    const mutation = new MutationObserver(invalidate);
    if (root) mutation.observe(root, { attributes: true, attributeFilter: ["data-motion-paused"] });
    mutation.observe(host, { attributes: true, attributeFilter: ["data-webgl-paused"] });
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || !canMove()) { pointer.active = false; return; }
      const bounds = pointerBounds ??= canvas.getBoundingClientRect();
      pointer.active = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      if (!pointer.active) return;
      pointer.x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
      pointer.y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    };
    const resetPointer = () => { pointer.active = false; pointerBounds = null; };
    const onVisibility = () => { resetPointer(); invalidate(); };
    const pointerHost = host.closest(".spatial-world");
    pointerHost?.addEventListener("pointermove", onPointer as EventListener, { passive: true });
    pointerHost?.addEventListener("pointerleave", resetPointer);
    const onContextLost = (event: Event) => { event.preventDefault(); fail(); };
    canvas.addEventListener("webglcontextlost", onContextLost);
    window.addEventListener("scroll", resetPointer, { passive: true, capture: true });
    window.addEventListener("resize", resetPointer, { passive: true });
    window.addEventListener("blur", resetPointer);
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onVisibility);
    mobile.addEventListener("change", onVisibility);
    return () => {
      disposed = true;
      stop();
      observer.disconnect(); resize.disconnect(); mutation.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      window.removeEventListener("scroll", resetPointer, true);
      window.removeEventListener("resize", resetPointer);
      window.removeEventListener("blur", resetPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onVisibility);
      mobile.removeEventListener("change", onVisibility);
      pointerHost?.removeEventListener("pointermove", onPointer as EventListener);
      pointerHost?.removeEventListener("pointerleave", resetPointer);
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, [kind]);

  return <div ref={hostRef} className={`webgl-scene webgl-${kind}`} data-webgl-kind={kind} data-webgl-ready="false" data-webgl-paused={paused} aria-hidden="true">
    <div className="webgl-fallback">{children}</div>
    <canvas className="webgl-canvas" />
  </div>;
}
