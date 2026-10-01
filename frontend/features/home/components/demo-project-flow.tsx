import { useT } from "../../../app/lib/ui-language";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { demoProject, demoProjectSnapshot, initialDemoState } from "../product-demo.mjs";

type DemoState = ReturnType<typeof initialDemoState>;

/** One persistent fictional project, never an API request or a real input form. */
export function DemoProjectFlow({ state, paused, reducedMotion }: { state: DemoState; paused: boolean; reducedMotion: boolean }) {
  const t = useT();
  const snapshot = demoProjectSnapshot(state, reducedMotion);
  const board = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const second = useRef<HTMLDivElement>(null);
  const movement = useRef<gsap.core.Tween | null>(null);
  const typing = useRef<gsap.core.Tween | null>(null);
  const initialized = useRef(false);
  const pausedRef = useRef(paused);
  const [characters, setCharacters] = useState(0);
  const typingActive = state.selected === 0 && state.phase === "running" && !state.manual && !reducedMotion;
  const projectTitle = t(demoProject.title);
  const requestText = t(demoProject.request);
  const fullText = projectTitle + requestText;

  useLayoutEffect(() => {
    pausedRef.current = paused;
    movement.current?.paused(paused);
    typing.current?.paused(paused);
  }, [paused]);

  useLayoutEffect(() => {
    const element = card.current;
    const container = board.current;
    const target = snapshot.column === 0 ? first.current : second.current;
    if (!element || !container || !target) return;
    const place = (animate: boolean) => {
      const parentRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const position = { x: targetRect.left - parentRect.left, y: targetRect.top - parentRect.top + 34, width: targetRect.width, opacity: snapshot.ready ? 1 : 0 };
      movement.current?.kill();
      if (animate) movement.current = gsap.to(element, { ...position, duration: .85, ease: "power2.inOut", paused: pausedRef.current });
      else gsap.set(element, position);
    };
    place(initialized.current && !state.manual && !reducedMotion);
    initialized.current = true;
    let previousWidth = container.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = container.getBoundingClientRect().width;
      if (Math.abs(width - previousWidth) < .5) return;
      previousWidth = width;
      place(false);
    });
    observer.observe(container);
    return () => { observer.disconnect(); movement.current?.kill(); };
  }, [snapshot.column, snapshot.ready, state.manual, reducedMotion, state.run]);

  useEffect(() => {
    typing.current?.kill();
    if (!typingActive) return;
    const cursor = { count: 0 };
    typing.current = gsap.to(cursor, { count: fullText.length, duration: 1.4, ease: "none", paused: pausedRef.current, onUpdate: () => setCharacters(Math.floor(cursor.count)) });
    return () => { typing.current?.kill(); };
  }, [typingActive, fullText.length, state.run]);

  const count = typingActive ? characters : fullText.length;
  return <div className="demo-project-flow" data-project-id={snapshot.id} data-column={snapshot.column}>
    {state.selected === 0 && <div className="demo-inquiry-composer">
      <span className="demo-label">{t("문의 등록 예시")}</span>
      <div aria-hidden="true"><label>{t("프로젝트 이름")}<input readOnly tabIndex={-1} value={projectTitle.slice(0, count)} /></label><label>{t("고객 문의")}<textarea readOnly tabIndex={-1} rows={3} value={requestText.slice(0, Math.max(0, count - projectTitle.length))} /></label></div>
      <p className="sr-only">{t("가상의 고객 문의:")}{t(demoProject.request)}</p>
      <span className="demo-input-status">{snapshot.ready ? t("문의가 보드에 정리되었습니다.") : t("문의 내용을 입력하는 예시입니다.")}</span>
    </div>}
    <div ref={board} className="demo-project-board" role="group" aria-label={t("같은 문의의 프로젝트 상태 변화")} data-ready={snapshot.ready}>
      <div ref={first} className="demo-board-lane"><strong>{t("진행 중")}</strong><span>{t("요구사항 · 견적 검토")}</span></div>
      <div ref={second} className="demo-board-lane"><strong>{t("협상 중")}</strong><span>{t("제안서 · 범위 협의")}</span></div>
      <article ref={card} className="demo-moving-card" aria-hidden={!snapshot.ready} data-project-id={snapshot.id}>
        <span className="demo-card-id">{snapshot.id} · {t(snapshot.status)}</span><h4>{t(demoProject.title)}</h4>
        <p>{t(snapshot.detail)}</p>
        {state.selected >= 3 && <strong className="demo-card-price">{new Intl.NumberFormat("ko-KR").format(snapshot.quote.total)}{t("원")}</strong>}
      </article>
    </div>
    <p className="demo-board-note">{snapshot.column ? t("같은 프로젝트가 협상 중으로 이동했습니다. 범위와 금액을 검토하세요.") : t("등록한 문의가 같은 프로젝트로 이어집니다.")}</p>
  </div>;
}
