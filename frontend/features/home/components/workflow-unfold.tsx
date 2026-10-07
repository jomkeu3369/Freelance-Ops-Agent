import { useLayoutEffect, useRef } from "react";
import { ArrowDown, ChatCenteredText, FileText, GitBranch, TreeStructure, WarningCircle } from "@phosphor-icons/react";
import { useT } from "../ui-language";

const stages = [
  { label: "문의", detail: "고객의 한마디", Icon: ChatCenteredText },
  { label: "요구사항", detail: "작업 범위 정리", Icon: TreeStructure },
  { label: "리스크", detail: "확인할 질문", Icon: WarningCircle },
  { label: "견적", detail: "공수와 근거", Icon: GitBranch },
  { label: "제안", detail: "검토 가능한 초안", Icon: FileText }
];
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => 1 - (1 - clamp(value)) ** 3;

/** The native layout is the final pose. Scroll only projects each card out of one origin. */
export function WorkflowUnfold() {
  const t = useT();
  const sectionRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const deck = section.querySelector<HTMLOListElement>(".workflow-unfold-deck")!;
    const cards = [...deck.querySelectorAll<HTMLLIElement>(".workflow-unfold-card")];
    const beams = [...section.querySelectorAll<SVGPathElement>(".workflow-unfold-beam")];
    const glows = [...section.querySelectorAll<SVGPathElement>(".workflow-unfold-glow")];
    const counter = section.querySelector<HTMLElement>("[data-unfold-count]")!;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let geometry: { x: number; y: number; width: number; height: number }[] = [];
    let frame = 0;
    let visible = true;
    let disposed = false;
    let origin = { x: 0, y: 0 };
    let compact = false;
    let previousProgress = -1;

    const paint = () => {
      frame = 0;
      if (disposed || !geometry.length) return;
      const originTop = deck.getBoundingClientRect().top + origin.y;
      const distance = Math.min(340, window.innerHeight * (compact ? .4 : .36));
      const progress = preference.matches ? 1 : clamp((window.innerHeight * .72 - originTop) / distance);
      if (progress === previousProgress) return;
      previousProgress = progress;
      section.dataset.unfoldProgress = progress.toFixed(3);
      section.style.setProperty("--unfold-hint-opacity", String(1 - clamp((progress - .15) / .55)));
      section.dataset.unfoldState = progress === 0 ? "folded" : progress === 1 ? "open" : "unfolding";
      const positions = geometry.map((box, index) => {
        const local = index === 0 ? 1 : ease((progress - .04 - (index - 1) * .085) / .66);
        const x = (origin.x - box.x) * (1 - local);
        const y = (origin.y - box.y) * (1 - local) - Math.sin(local * Math.PI) * (compact ? 14 : 28);
        const tilt = index === 0 ? 0 : (1 - local) * (index % 2 ? -8 : 8);
        const depth = index === 0 ? 0 : Math.sin(local * Math.PI) * 30;
        cards[index].style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,${depth.toFixed(2)}px) rotateY(${tilt.toFixed(2)}deg) scale(${(.9 + local * .1).toFixed(3)})`;
        cards[index].style.opacity = String(index === 0 ? 1 : clamp(local * 3));
        // All five semantic steps remain available to screen readers even when folded.
        cards[index].style.zIndex = String(6 - index);
        return { x: box.x + x, y: box.y + y, width: box.width, height: box.height * (.9 + local * .1), local };
      });
      positions.forEach((position, index) => {
        // Faces may overlap while unfolding, but their labels wait for clear space.
        // Unscaled bounds deliberately reserve a small margin around the live glyphs.
        const clearance = Math.min(...positions.filter((_, otherIndex) => otherIndex !== index).map(other => Math.max(
          Math.abs(position.x - other.x) - (position.width + other.width) / 2,
          Math.abs(position.y - other.y) - (position.height + other.height) / 2
        )));
        const contentOpacity = index === 0 ? 1 : clamp((clearance - 4) / 10) * ease((position.local - .35) / .5);
        cards[index].style.setProperty("--unfold-content-opacity", contentOpacity.toFixed(3));
      });
      positions.slice(1).forEach((position, index) => {
        // Every branch starts at the inquiry, including the second mobile row.
        const source = positions[0];
        const from = { x: source.x, y: source.y + source.height / 2 };
        const to = { x: position.x, y: position.y - position.height / 2 };
        const middleY = (from.y + to.y) / 2;
        let path = `M${from.x},${from.y} C${from.x},${middleY} ${to.x},${middleY} ${to.x},${to.y}`;
        if (compact && index > 1) {
          // Route through the gap between the first pair, never through their text.
          const upperBottom = Math.max(...geometry.slice(1, 3).map(box => box.y + box.height / 2));
          const lowerTop = geometry[index + 1].y - geometry[index + 1].height / 2;
          const turnY = from.y + ((upperBottom + lowerTop) / 2 - from.y) * position.local;
          const laneX = from.x + (index === 2 ? -5 : 5) * position.local;
          const launchY = from.y + Math.max(0, turnY - from.y) * .2;
          path = `M${from.x},${from.y} C${from.x},${launchY} ${laneX},${launchY} ${laneX},${launchY} L${laneX},${turnY} C${laneX},${turnY + 12} ${to.x},${turnY} ${to.x},${to.y}`;
        }
        [beams[index], glows[index]].forEach(beam => {
          beam.setAttribute("d", path);
          beam.style.opacity = String(clamp((position.local - .2) / .8));
          beam.style.strokeDashoffset = String(1 - position.local);
        });
      });
      counter.textContent = String(1 + positions.slice(1).filter(position => position.local > .1).length).padStart(2, "0");
    };

    const requestPaint = () => {
      if (!frame && visible && !disposed) frame = requestAnimationFrame(paint);
    };
    const measure = () => {
      compact = window.matchMedia("(max-width: 700px)").matches;
      geometry = cards.map(card => ({ x: card.offsetLeft + card.offsetWidth / 2, y: card.offsetTop + card.offsetHeight / 2, width: card.offsetWidth, height: card.offsetHeight }));
      origin = { x: deck.offsetWidth / 2, y: geometry[0].y };
      previousProgress = -1;
      // A layout change must replace the old transforms even below the viewport.
      // Keeping a desktop folded pose on mobile can widen the entire document.
      if (!frame && !disposed) frame = requestAnimationFrame(paint);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(deck);
    cards.forEach(card => observer.observe(card));
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      section.dataset.unfoldVisible = String(visible);
      if (visible) { previousProgress = -1; requestPaint(); }
    }, { rootMargin: "80px" });
    intersection.observe(section);
    window.addEventListener("scroll", requestPaint, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    preference.addEventListener("change", measure);
    document.fonts.ready.then(() => { if (!disposed) measure(); });
    measure();
    // Paint before the first browser frame; a no-JS page keeps the full readable list.
    cancelAnimationFrame(frame);
    paint();
    section.dataset.unfoldReady = "true";
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      window.removeEventListener("scroll", requestPaint);
      window.removeEventListener("resize", measure);
      preference.removeEventListener("change", measure);
      cards.forEach(card => { card.style.removeProperty("transform"); card.style.removeProperty("opacity"); card.style.removeProperty("z-index"); card.style.removeProperty("--unfold-content-opacity"); });
      delete section.dataset.unfoldReady;
      section.style.removeProperty("--unfold-hint-opacity");
    };
  }, [t]);

  return <section ref={sectionRef} className="workflow-unfold" data-unfold-layout="branch" aria-labelledby="workflow-unfold-title">
    <div className="workflow-unfold-heading">
      <div><p className="workflow-unfold-eyebrow">ONE INQUIRY / FIVE STEPS</p><h2 id="workflow-unfold-title">{t("하나의 문의, 이어지는 다섯 단계")}</h2></div>
      <span className="workflow-unfold-count" aria-hidden="true"><span data-unfold-count>05</span><span> / 05</span></span>
    </div>
    <div className="workflow-unfold-stage">
      <ol className="workflow-unfold-deck">
        {stages.map(({ label, detail, Icon }, index) => <li key={label} className="workflow-unfold-card">
          <span className="workflow-unfold-card-top"><Icon size={25} weight="light" /><span>0{index + 1}</span></span>
          <h3>{t(label)}</h3><p>{t(detail)}</p>
          <span className="workflow-unfold-edge" aria-hidden="true" />
        </li>)}
      </ol>
      <svg className="workflow-unfold-wires" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <g key={index}><path className="workflow-unfold-glow" pathLength="1" /><path className="workflow-unfold-beam" pathLength="1" /></g>)}
      </svg>
      <svg className="workflow-unfold-static-wires" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        <g className="workflow-unfold-static-wide">{[125, 375, 625, 875].map(x => <path key={x} d={`M500 250 C500 510 ${x} 510 ${x} 810`} />)}</g>
        <g className="workflow-unfold-static-compact"><path d="M500 180 C500 330 250 330 250 515" /><path d="M500 180 C500 330 750 330 750 515" /><path d="M500 180 C500 270 485 270 485 310 L485 650 C485 720 250 700 250 835" /><path d="M500 180 C500 270 515 270 515 310 L515 650 C515 720 750 700 750 835" /></g>
      </svg>
      <span className="workflow-unfold-floor" aria-hidden="true" />
    </div>
    <p className="workflow-unfold-hint"><ArrowDown size={16} aria-hidden="true" />{t("스크롤하며 흐름을 펼쳐보세요.")}</p>
  </section>;
}
