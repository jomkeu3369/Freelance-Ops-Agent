import { useLayoutEffect, useRef, type RefObject } from "react";
import gsap from "gsap";

/** One semantic card. Only its decorative surface changes shape during transfer. */
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
    const destination = () => column === 0 ? 0 : window.matchMedia("(max-width: 580px)").matches ? 30 : lanes[1].offsetLeft - lanes[0].offsetLeft;
    let timeline: gsap.core.Timeline | undefined;
    const finish = () => {
      timeline?.kill();
      position.current = destination();
      card.style.removeProperty("transform");
      gsap.set(shell, { clearProps: "transform,borderRadius" });
      gsap.set(content, { clearProps: "opacity" });
      card.dataset.transferState = "settled";
    };
    // Wait for the real motion preference before remembering a starting lane.
    // The server's accessible static preview is not a user-requested transfer.
    const changed = ready && previous.current?.scene === scene && previous.current.column !== column;
    previous.current = ready ? { scene, column } : null;
    if (!enabled || !changed || card.offsetWidth <= 0 || card.offsetHeight <= 0) finish();
    else {
      const end = destination();
      const diameter = Math.min(60, card.offsetWidth * .32);
      const sx = diameter / card.offsetWidth;
      const sy = diameter / card.offsetHeight;
      gsap.set(card, { x: position.current });
      card.dataset.transferState = "condensing";
      timeline = gsap.timeline({ onComplete: finish, onUpdate: () => { position.current = Number(gsap.getProperty(card, "x")); } });
      timeline.to(content, { opacity: 0, duration: .12, ease: "power1.out" }, 0)
        .to(shell, { scaleX: sx, scaleY: sy, borderRadius: "50%", duration: .24, ease: "power2.inOut" }, 0)
        .set(card, { attr: { "data-transfer-state": "droplet" } }, .24)
        .set(card, { attr: { "data-transfer-state": "travelling" } }, .28)
        .to(card, { x: end, duration: .42, ease: "power3.inOut" }, .28)
        .to(shell, { scaleX: sx * 2.15, scaleY: sy * .65, duration: .15, ease: "power2.out" }, .28)
        .to(shell, { scaleX: sx * .9, scaleY: sy * 1.12, duration: .22, ease: "power2.inOut" }, .43)
        .set(card, { attr: { "data-transfer-state": "unfolding" } }, .7)
        .to(shell, { scaleX: 1, scaleY: 1, borderRadius: "12px", duration: .38, ease: "power3.out" }, .7)
        .to(content, { opacity: 1, duration: .22, ease: "power2.out" }, .86);
    }
    // A font/locale/viewport reflow changes the landing point. Complete at the
    // newly measured position rather than leaving a stale or stretched card.
    let dimensions = `${board.clientWidth}:${card.offsetWidth}:${card.offsetHeight}`;
    const observer = new ResizeObserver(() => {
      const next = `${board.clientWidth}:${card.offsetWidth}:${card.offsetHeight}`;
      if (next !== dimensions) { dimensions = next; finish(); }
    });
    observer.observe(board); observer.observe(card);
    return () => { observer.disconnect(); timeline?.kill(); };
  }, [sceneRef, column, enabled, ready, webglOwned]);
}
