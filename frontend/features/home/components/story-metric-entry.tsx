import { useEffect, useRef } from "react";
import gsap from "gsap";

const formatCount = (value: number, decimals: number, digits: number) => value.toFixed(decimals).padStart(digits, "0");

/** 스크린 리더에는 증가 중인 장식 숫자 대신 실제 결과를 제공한다. */
export function StoryCount({ value, decimals = 0, digits = 1 }: { value: number; decimals?: number; digits?: number }) {
  const final = formatCount(value, decimals, digits);
  return (
    <>
      <span
        className="story-entry-count"
        aria-hidden="true"
        data-story-count={value}
        data-count-decimals={decimals}
        data-count-digits={digits}
        style={{ minWidth: `${final.length}ch` }}
      >
        {final}
      </span>
      <span className="sr-only">{final}</span>
    </>
  );
}

/** 그래프마다 진입을 한 번만 실행하며 화면 밖에서는 타이머를 시작하지 않는다. */
export function useStoryMetricEntry(revision: string) {
  const rootRef = useRef<HTMLDivElement>(null);
  const entered = useRef(new WeakSet<Element>());

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motionRoot = root.closest<HTMLElement>("[data-motion-paused]");
    // 부모의 서버 렌더링용 동작 축소 기본값을 사용자가 일시정지한 것으로 취급하지 않는다.
    // 자식 효과가 부모의 실제 설정 확인보다 먼저 실행될 수 있다.
    const motionReady = () => motionRoot?.dataset.motionReady !== "false";
    const motionPaused = () => motionRoot?.dataset.motionPaused === "true";
    const scenes = Array.from(root.querySelectorAll<HTMLElement>("[data-story-metric-scene]"));
    const active = new Map<HTMLElement, gsap.core.Timeline>();
    const visible = new Set<HTMLElement>();

    // 범위 변경 뒤에도 현재 DOM 속성을 읽는다.
    // 새 확장 범위에 이전 필수 범위의 수치를 덮어쓰지 않는다.
    const renderCount = (scene: HTMLElement, progress: number) => {
      scene.querySelectorAll<HTMLElement>("[data-story-count]").forEach((element) => {
        const value = Number(element.dataset.storyCount);
        const decimals = Number(element.dataset.countDecimals);
        const digits = Number(element.dataset.countDigits);
        element.textContent = formatCount(value * progress, decimals, digits);
      });
    };
    const prepareWaiting = (scene: HTMLElement) => {
      // 장면이 차트의 진입 기준점보다 먼저 화면에 보일 수 있다.
      // 그동안 장식 숫자는 시작 값에 둔다.
      renderCount(scene, 0);
      scene.dataset.storyEntryState = "waiting";
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
      scene
        .querySelectorAll<
          HTMLElement | SVGElement
        >("[data-story-segment], [data-story-task-marker], [data-story-meter], [data-story-day-cell]")
        .forEach((element) => {
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
      // 근거 열은 왼쪽부터 나타나며 숫자와 그래프에 같은 이동량을 적용한다.
      // 나머지 그래프는 지연 없이 시작한다.
      const entryOffset = Math.min(2, Math.max(0, Number(scene.dataset.storyEntryOrder) || 0)) * 0.12;
      const counter = { progress: 0 };
      const timeline = gsap.timeline({ paused: true, onComplete: () => restore(scene) });
      active.set(scene, timeline);
      if (scene.querySelector("[data-story-count]")) {
        renderCount(scene, 0);
        timeline.to(
          counter,
          { progress: 1, duration: 1.45, ease: "power2.out", onUpdate: () => renderCount(scene, counter.progress) },
          entryOffset
        );
      }

      // 3D 회전 전에 로컬 세로축으로 막대 몸체의 크기를 조정한다.
      // 윗면의 깊이, 라벨 위치, 격자 기준선은 유지한다.
      const prisms = scene.querySelectorAll("[data-story-prism]");
      if (prisms.length)
        timeline.fromTo(
          prisms,
          { "--story-prism-grow": 0.025 },
          { "--story-prism-grow": 1, duration: 0.74, stagger: 0.1, ease: "power3.out" },
          entryOffset + 0.06
        );
      const meters = scene.querySelectorAll("[data-story-meter]");
      if (meters.length)
        timeline.fromTo(
          meters,
          { scaleX: 0, transformOrigin: "left center" },
          { scaleX: 1, duration: 0.68, stagger: 0.1, ease: "power3.out" },
          entryOffset + 0.06
        );
      // 반일 단위 셀의 값은 진입 중에도 유지한다. 행 시작을 맞추고
      // 각 행 안에서는 왼쪽부터 짧은 간격으로 표시한다.
      scene.querySelectorAll<HTMLElement>("[data-story-day-row]").forEach((row, index) => {
        const cells = row.querySelectorAll("[data-story-day-cell].is-active");
        if (cells.length)
          timeline.fromTo(
            cells,
            { scaleX: 0, opacity: 0.3, transformOrigin: "left center" },
            { scaleX: 1, opacity: 1, duration: 0.32, stagger: 0.035, ease: "power2.out" },
            entryOffset + 0.06 + index * 0.1
          );
      });

      const ring = scene.querySelector<SVGCircleElement>("[data-story-ring]");
      if (ring)
        timeline.fromTo(
          ring,
          { strokeDasharray: "0 100", opacity: 0 },
          {
            strokeDasharray: ring.getAttribute("stroke-dasharray") ?? "0 100",
            opacity: 1,
            duration: 1.45,
            ease: "power2.out"
          },
          entryOffset
        );
      const taskMarkers = scene.querySelectorAll("[data-story-task-marker]");
      if (taskMarkers.length)
        timeline.fromTo(
          taskMarkers,
          { opacity: 0.35, y: 4 },
          { opacity: 1, y: 0, duration: 0.45, stagger: 0.1, ease: "power2.out" },
          entryOffset + 0.1
        );
      const segments = scene.querySelectorAll("[data-story-segment]");
      if (segments.length)
        timeline.fromTo(
          segments,
          { scaleY: 0.14, opacity: 0.15, transformOrigin: "center bottom" },
          { scaleY: 1, opacity: 1, duration: 0.5, stagger: 0.055, ease: "power2.out" },
          entryOffset + 0.08
        );
      timeline.play();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const scene = entry.target as HTMLElement;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            visible.add(scene);
            enter(scene);
          } else {
            visible.delete(scene);
            // 카드를 지나치면 진행 중인 진입 효과를 완료한다.
            // 화면 밖에서 재생하거나 되돌아왔을 때 중간 숫자부터 반복하지 않는다.
            if (active.has(scene)) restore(scene);
          }
        }
      },
      { threshold: 0.35, rootMargin: "0px 0px -6% 0px" }
    );
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
        // 진행 중인 진입은 완료하고 아직 방문하지 않은 그래프는 남겨 둔다.
        for (const scene of scenes) restore(scene);
        return;
      }
      for (const scene of scenes) if (!entered.current.has(scene)) prepareWaiting(scene);
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
        prepareWaiting(scene);
      }
      observer.observe(scene);
    }
    const motionObserver = new MutationObserver(syncMotion);
    if (motionRoot)
      motionObserver.observe(motionRoot, {
        attributes: true,
        attributeFilter: ["data-motion-paused", "data-motion-ready"]
      });
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
