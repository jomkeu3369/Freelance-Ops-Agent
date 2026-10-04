import { useEffect, useRef, useState, type RefObject } from "react";
import type { WorkflowRenderer } from "./webgl/workflow-renderer";

export function useWorkflowDepth(sceneRef: RefObject<HTMLDivElement | null>, selected: number, column: number) {
  const [ready, setReady] = useState(false);
  const controller = useRef<WorkflowRenderer | null>(null);
  const input = useRef({ selected, column });
  const invalidateRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    input.current = { selected, column };
    controller.current?.setState(selected, column);
    invalidateRef.current?.();
  }, [selected, column]);

  useEffect(() => {
    const host = sceneRef.current;
    const canvas = host?.querySelector<HTMLCanvasElement>(".workflow-canvas");
    if (!host || !canvas) return;
    const root = host.closest<HTMLElement>("[data-motion-paused]");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const compact = matchMedia("(max-width: 820px), (pointer: coarse)");
    let disposed = false, loading = false, failed = false, visible = false;
    let frame = 0, last = 0, time = 0, frames = 0;
    let pointerBounds: DOMRect | undefined;
    const pointer = { x: 0, y: 0 };
    const moving = () => !document.hidden && !reduced.matches && !compact.matches && root?.dataset.motionPaused !== "true";
    const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; host.dataset.workflowRunning = "false"; };
    const fail = () => {
      failed = true; stop();
      controller.current?.dispose(); controller.current = null;
      host.dataset.workflowReady = "false"; host.dataset.workflowState = "fallback";
      if (!disposed) setReady(false);
    };
    const draw = (now: number) => {
      frame = 0;
      if (disposed || !visible || document.hidden || !controller.current) return;
      const animate = moving();
      if (animate && last && now - last < 25) { frame = requestAnimationFrame(draw); return; }
      const delta = last ? Math.min(.05, (now - last) / 1000) : .025;
      last = now;
      if (animate) time += delta;
      try {
        controller.current.render(time, delta, animate, pointer);
        if (host.dataset.workflowReady !== "true") { host.dataset.workflowReady = "true"; setReady(true); }
        host.dataset.workflowState = "ready";
        host.dataset.workflowFrames = String(++frames);
        host.dataset.workflowRunning = String(animate);
        if (animate) frame = requestAnimationFrame(draw);
      } catch { fail(); }
    };
    const invalidate = () => { stop(); if (visible && !document.hidden && controller.current && !disposed) frame = requestAnimationFrame(draw); };
    invalidateRef.current = invalidate;
    const start = async () => {
      if (loading || failed || disposed || controller.current) return;
      loading = true;
      try {
        const { createWorkflowRenderer } = await import("./webgl/workflow-renderer");
        if (disposed) return;
        controller.current = createWorkflowRenderer(host, canvas, compact.matches);
        controller.current.setState(input.current.selected, input.current.column);
        controller.current.resize();
        invalidate();
      } catch { if (!disposed) fail(); }
      finally { loading = false; }
    };
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) void start();
      invalidate();
    }, { threshold: .01 });
    intersection.observe(host);
    const resize = new ResizeObserver(() => {
      pointerBounds = undefined;
      try { controller.current?.resize(); invalidate(); } catch { fail(); }
    });
    resize.observe(host);
    host.querySelectorAll(".spatial-stage, .spatial-board, .spatial-project-card").forEach(element => resize.observe(element));
    const mutation = new MutationObserver(invalidate);
    if (root) mutation.observe(root, { attributes: true, attributeFilter: ["data-motion-paused"] });
    const move = (event: PointerEvent) => {
      if (!moving() || event.pointerType === "touch" || host.matches(":focus-within")) return;
      pointerBounds ??= host.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, (event.clientX - pointerBounds.left) / pointerBounds.width * 2 - 1));
      pointer.y = Math.max(-1, Math.min(1, (event.clientY - pointerBounds.top) / pointerBounds.height * 2 - 1));
    };
    const reset = () => { pointer.x = 0; pointer.y = 0; pointerBounds = undefined; };
    const lost = (event: Event) => { event.preventDefault(); fail(); };
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", reset); host.addEventListener("focusin", reset);
    window.addEventListener("scroll", reset, { passive: true });
    document.addEventListener("visibilitychange", invalidate);
    reduced.addEventListener("change", invalidate); compact.addEventListener("change", invalidate);
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      disposed = true; stop();
      intersection.disconnect(); resize.disconnect(); mutation.disconnect();
      host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", reset); host.removeEventListener("focusin", reset);
      window.removeEventListener("scroll", reset); document.removeEventListener("visibilitychange", invalidate);
      reduced.removeEventListener("change", invalidate); compact.removeEventListener("change", invalidate);
      canvas.removeEventListener("webglcontextlost", lost);
      controller.current?.dispose(); controller.current = null; invalidateRef.current = null;
      delete host.dataset.workflowReady; delete host.dataset.workflowState;
    };
  }, [sceneRef]);
  return ready;
}
