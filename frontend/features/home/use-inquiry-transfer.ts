import { useLayoutEffect, useRef, type RefObject } from "react";
import gsap from "gsap";

/** 전송 중에도 같은 의미의 카드를 유지하고 장식 표면만 변형한다. */
export function useInquiryTransfer(sceneRef: RefObject<HTMLDivElement | null>, column: number, enabled: boolean, ready = true, webglOwned = false) {
  const previous = useRef<{ scene: HTMLDivElement; column: number } | null>(null);
  const position = useRef(0);
  useLayoutEffect(() => {
    if (webglOwned) return;
    const scene = sceneRef.current;
    const card = scene?.querySelector<HTMLElement>(".spatial-project-card");
    const shell = card?.querySelector<HTMLElement>(".inquiry-liquid-shell");
    const content = card?.querySelector<HTMLElement>(".inquiry-card-content");
    const board = scene?.querySelector<HTMLElement>(".spatial-board");
    if (!scene || !card || !shell || !content || !board) return;
    const lanes = board.querySelectorAll<HTMLElement>(".spatial-lane");
    if (lanes.length < 2) return;
    const destination = () =>
      column === 0
        ? 0
        : window.matchMedia("(max-width: 580px)").matches
          ? 30
          : lanes[1].offsetLeft - lanes[0].offsetLeft;
    let timeline: gsap.core.Timeline | undefined;
    const finish = () => {
      timeline?.kill();
      position.current = destination();
      card.style.removeProperty("transform");
      gsap.set(shell, { clearProps: "transform,borderRadius" });
      gsap.set(content, { clearProps: "opacity" });
      card.dataset.transferState = "settled";
    };
    // 사용자의 실제 동작 설정을 확인한 뒤 시작 단계를 기억한다.
    // 서버의 정적 예시를 사용자가 요청한 전송으로 해석하지 않는다.
    const changed = ready && previous.current?.scene === scene && previous.current.column !== column;
    previous.current = ready ? { scene, column } : null;
    if (!enabled || !changed || card.offsetWidth <= 0 || card.offsetHeight <= 0) finish();
    else {
      const end = destination();
      const diameter = Math.min(60, card.offsetWidth * 0.32);
      const sx = diameter / card.offsetWidth;
      const sy = diameter / card.offsetHeight;
      gsap.set(card, { x: position.current });
      card.dataset.transferState = "condensing";
      timeline = gsap.timeline({
        onComplete: finish,
        onUpdate: () => {
          position.current = Number(gsap.getProperty(card, "x"));
        }
      });
      timeline
        .to(content, { opacity: 0, duration: 0.12, ease: "power1.out" }, 0)
        .to(shell, { scaleX: sx, scaleY: sy, borderRadius: "50%", duration: 0.24, ease: "power2.inOut" }, 0)
        .set(card, { attr: { "data-transfer-state": "droplet" } }, 0.24)
        .set(card, { attr: { "data-transfer-state": "travelling" } }, 0.28)
        .to(card, { x: end, duration: 0.42, ease: "power3.inOut" }, 0.28)
        .to(shell, { scaleX: sx * 2.15, scaleY: sy * 0.65, duration: 0.15, ease: "power2.out" }, 0.28)
        .to(shell, { scaleX: sx * 0.9, scaleY: sy * 1.12, duration: 0.22, ease: "power2.inOut" }, 0.43)
        .set(card, { attr: { "data-transfer-state": "unfolding" } }, 0.7)
        .to(shell, { scaleX: 1, scaleY: 1, borderRadius: "12px", duration: 0.38, ease: "power3.out" }, 0.7)
        .to(content, { opacity: 1, duration: 0.22, ease: "power2.out" }, 0.86);
    }
    // 폰트·언어·화면 크기가 바뀌면 목적지 위치를 다시 측정한다.
    // 이전 좌표에 카드를 남기거나 늘리지 않고 새 위치에서 완료한다.
    let dimensions = `${board.clientWidth}:${card.offsetWidth}:${card.offsetHeight}`;
    const observer = new ResizeObserver(() => {
      const next = `${board.clientWidth}:${card.offsetWidth}:${card.offsetHeight}`;
      if (next !== dimensions) {
        dimensions = next;
        finish();
      }
    });
    observer.observe(board);
    observer.observe(card);
    return () => {
      observer.disconnect();
      timeline?.kill();
    };
  }, [sceneRef, column, enabled, ready, webglOwned]);
}
