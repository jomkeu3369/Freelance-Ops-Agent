import { useEffect, type RefObject } from "react";
import gsap from "gsap";
import { pointerDepth } from "./pointer-depth.mjs";

/** 내용과 표면이 같은 회전 중심을 사용하도록 고정 기준점 하나로 패널 전체를 제어한다. */
export function usePointerDepth(pageRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const media = window.matchMedia(
      "(min-width: 821px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)"
    );
    const hosts = Array.from(
      root.querySelectorAll<HTMLElement>(".spatial-flow, .story-execution, .story-effort-prisms, .story-dashboard-ring")
    );
    const visible = new Set<Element>();
    const motionRoot = root.querySelector<HTMLElement>("[data-motion-paused]");
    const enabled = () => media.matches && !document.hidden && motionRoot?.dataset.motionPaused !== "true";
    const neutral = { rx: 0, ry: 0, x: 50, y: 50, strength: 0 };
    const cssProperties = {
      rx: ["--pointer-rx", "deg"],
      ry: ["--pointer-ry", "deg"],
      x: ["--pointer-x", "%"],
      y: ["--pointer-y", "%"],
      strength: ["--pointer-strength", ""]
    } as const;
    type Values = typeof neutral;
    const controls = new Map<HTMLElement, { reset: (immediate?: boolean) => void; invalidate: () => void }>();
    const cleanups = hosts.map((host) => {
      host.dataset.pointerDepth = "true";
      const anchor = host.closest<HTMLElement>(".pointer-depth-anchor") ?? host;
      let bounds: DOMRect | undefined;
      let frame = 0;
      let clientX = 0;
      let clientY = 0;
      // 조작한 영역에만 한 번 할당한다. quickTo가 기존 tween을 재사용하므로
      // 매 프레임마다 레이어별 tween을 만들지 않는다.
      const channels = new Map<keyof Values, ReturnType<typeof gsap.quickTo>>();
      const values: Values = { ...neutral };
      const render = (property: keyof Values) => {
        const [name, unit] = cssProperties[property];
        host.style.setProperty(name, `${values[property]}${unit}`);
      };
      const steer = (target: Values, options = { duration: 0.24 }, immediate = false) => {
        for (const property of Object.keys(target) as (keyof Values)[]) {
          const value = target[property];
          let channel = channels.get(property);
          if (!channel) {
            // quickTo 중단 시 CSS 단위 문자열은 NaN이 될 수 있으므로
            // 숫자만 보간하고 렌더링할 때 단위를 붙인다.
            channel = gsap.quickTo(values, property, {
              duration: 0.24,
              ease: "power2.out",
              onUpdate: () => render(property)
            });
            channels.set(property, channel);
          }
          if (immediate) {
            channel.tween.pause();
            values[property] = value;
            render(property);
          } else {
            channel.tween.duration(options.duration);
            channel(value);
          }
        }
      };
      const reset = (immediate = false) => {
        cancelAnimationFrame(frame);
        frame = 0;
        bounds = undefined;
        host.dataset.pointerActive = "false";
        // 조작하지 않은 화면 밖 영역이나 비활성 영역에는 tween이 필요 없다.
        if (channels.size) steer(neutral, { duration: immediate ? 0 : 0.5 }, immediate);
      };
      const invalidate = () => {
        bounds = undefined;
      };
      controls.set(host, { reset, invalidate });
      const enter = () => {
        if (enabled() && visible.has(host)) bounds = anchor.getBoundingClientRect();
      };
      const move = (event: PointerEvent) => {
        if (event.pointerType === "touch" || !enabled() || !visible.has(host) || host.matches(":focus-within")) return;
        clientX = event.clientX;
        clientY = event.clientY;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          // 이벤트와 프레임 실행 사이에 설정이나 포커스가 바뀔 수 있다.
          if (!enabled() || !visible.has(host) || host.matches(":focus-within")) {
            reset(true);
            return;
          }
          bounds ??= anchor.getBoundingClientRect();
          const point = pointerDepth(clientX, clientY, bounds);
          host.dataset.pointerActive = "true";
          steer({ rx: point.rx, ry: point.ry, x: point.x, y: point.y, strength: 1 });
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
        channels.forEach((channel) => channel.tween.kill());
        Object.values(cssProperties).forEach(([property]) => host.style.removeProperty(property));
        delete host.dataset.pointerDepth;
        delete host.dataset.pointerActive;
      };
    });
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else {
            visible.delete(entry.target);
            controls.get(entry.target as HTMLElement)?.reset(true);
          }
        }
      },
      { threshold: 0.08 }
    );
    hosts.forEach((host) => observer.observe(host));
    const invalidateBounds = () => controls.forEach((control) => control.invalidate());
    const sizeObserver = new ResizeObserver(invalidateBounds);
    // 크기가 같아도 형제 요소 때문에 위치가 바뀔 수 있어 페이지 영역도 관찰한다.
    sizeObserver.observe(root);
    hosts.forEach((host) => sizeObserver.observe(host));
    window.addEventListener("resize", invalidateBounds, { passive: true });
    // 포인터가 멈춰 있어도 스크롤하면 아래 패널이 바뀐다.
    // 이전 기울기를 남기거나 스크롤마다 배치를 측정하지 않고 한 번 초기화한다.
    const resetOnScroll = () =>
      controls.forEach((control, host) => {
        control.invalidate();
        if (host.dataset.pointerActive === "true") control.reset();
      });
    window.addEventListener("scroll", resetOnScroll, { passive: true, capture: true });
    const sync = () => {
      if (!enabled()) controls.forEach((control) => control.reset(true));
    };
    const pauseObserver = new MutationObserver(sync);
    if (motionRoot) pauseObserver.observe(motionRoot, { attributes: true, attributeFilter: ["data-motion-paused"] });
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      pauseObserver.disconnect();
      sizeObserver.disconnect();
      window.removeEventListener("resize", invalidateBounds);
      window.removeEventListener("scroll", resetOnScroll, true);
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [pageRef]);
}
