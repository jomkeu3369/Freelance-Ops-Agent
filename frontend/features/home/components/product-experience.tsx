import { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { ReferenceStory } from "./reference-story";
import { HeroAtmosphere, MiddleAtmosphere, FooterAtmosphere } from "./scene-atmosphere";
import { ArrowRight, ArrowUpRight, Check, ChatCenteredText, FileText, GitBranch, Pause, ShieldCheck, Sparkle, TreeStructure, WarningCircle } from "@phosphor-icons/react";
import { useT } from "../ui-language";
import { demoEvents, demoProjectSnapshot, demoQuote, demoReducer, demoSteps, initialDemoState } from "../product-demo.mjs";
import { useInquiryTransfer } from "../use-inquiry-transfer";

const stageIcons = [ChatCenteredText, TreeStructure, WarningCircle, GitBranch, FileText];
const money = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
const stageCopy = [
  ["고객의 말에서 시작해요.", "예약 가능한 웹사이트, 얼마면 만들 수 있나요?"],
  ["작업의 경계를 정리해요.", "예약 · 시간 선택 / 관리자 화면 / 모바일 대응"],
  ["모르는 것은 먼저 물어요.", "온라인 결제도 필요한가요?"],
  ["공수와 근거를 연결해요.", "작업별 공수 × 예시 일단가"],
  ["같은 범위로 이야기해요.", "제안서 초안 준비 · 사용자 검토 필요"]
];

/** Original, fictional product scenes. No API requests, client data, or AI runs. */
export function WorkflowSection() {
  const t = useT();
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemoState);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [motionReady, setMotionReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const sceneRef = useRef<HTMLDivElement>(null);
  const paused = state.paused || hovered || focused || reducedMotion || !visible || !pageVisible;
  const finished = state.step === 4 && state.phase === "complete";
  // Reduced motion opens a complete, readable sample. Manual stage selection still works.
  const view = reducedMotion && !state.manual ? { ...state, selected: 4, phase: "complete" } : state;
  const project = demoProjectSnapshot(view, reducedMotion);
  const quote = demoQuote(state.scope);
  useInquiryTransfer(sceneRef, project.column, motionReady && !reducedMotion && visible && pageVisible && (!paused || state.manual), motionReady);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => { setReducedMotion(preference.matches); setMotionReady(true); };
    const syncVisibility = () => setPageVisible(!document.hidden);
    syncMotion(); syncVisibility();
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 });
    if (sceneRef.current) observer.observe(sceneRef.current);
    return () => {
      preference.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => dispatch({ type: finished ? "replay" : "tick" }), finished ? 4200 : state.phase === "running" ? 1600 : 1000);
    return () => window.clearTimeout(timer);
  }, [paused, finished, state.phase, state.step]);

  return <div className="spatial-story-run" data-motion-ready={motionReady} data-motion-paused={state.paused || reducedMotion || !pageVisible}>
    <HeroAtmosphere paused={paused} />
    <MiddleAtmosphere />
    <section id="workflow" tabIndex={-1} className="spatial-chapter spatial-workflow" data-step={view.selected} data-run-step={state.step} data-run={state.run} data-phase={state.phase} data-paused={paused}>
      <div id="product" tabIndex={-1} className="spatial-heading section-heading">
        <p className="spatial-eyebrow spatial-hero-eyebrow"><span /> FREELANCE OPS / AI WORKFLOW</p>
        <h1 className="spatial-hero-title">{t("문의는 한마디,")}<br /><span>{t("제안은 명확하게.")}</span></h1>
        <p>{t("요구사항, 확인 질문, 견적, 제안서.")}<br />{t("흩어진 고객 업무가 하나의 흐름으로 이어집니다.")}</p>
        <div className="hero-actions spatial-hero-actions"><Link href="/workspace" className="primary-button">{t("요구사항 정리 시작하기")}<ArrowUpRight size={16} /></Link><a href="#review" className="secondary-button">{t("완성될 초안 살펴보기")}<ArrowRight size={15} /></a></div>
        <p className="spatial-hero-note"><ShieldCheck size={12} />{t("AI 초안은 사용자가 검토하고 확정합니다.")}</p>
      </div>
      <div className="pointer-depth-anchor pointer-depth-hero">
      <div ref={sceneRef} className="spatial-flow" data-column={project.column} data-playing={!paused} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <span className="scene-panel-reflection" aria-hidden="true" />
        <div className="spatial-flow-top"><span><Sparkle size={15} /> {t("제품 예시")}</span><span className="spatial-auto"><i />{reducedMotion ? t("동작 줄이기 적용") : t("자동 진행 예시")}</span></div>
        <div className="spatial-stages" role="group" aria-label={t("제품 예시 단계 선택")}>
          <svg className="spatial-graph-wires" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true"><path d="M40 100 C170 100 168 44 280 44 S440 44 520 44" /><path d="M40 100 C170 100 168 156 280 156 S440 156 520 156" /><path d="M310 44 C410 44 416 156 520 156" /><path className="spatial-graph-pulse" data-active={view.selected === 1 || view.selected === 3} d="M40 100 C170 100 168 44 280 44 S440 44 520 44" pathLength="1000" /><path className="spatial-graph-pulse" data-active={view.selected === 2 || view.selected === 4} d="M40 100 C170 100 168 156 280 156 S440 156 520 156" pathLength="1000" /></svg>
          {demoSteps.map((label, index) => { const Icon = stageIcons[index]; const name = t(label); return <button key={label} type="button" className={`spatial-stage${view.selected === index ? " is-current" : ""}${view.selected > index ? " is-past" : ""}`} aria-label={name} aria-pressed={view.selected === index} aria-controls="workflow-example" onClick={() => dispatch({ type: "select", step: index })}><span className="spatial-stage-icon"><Icon size={20} /></span><span>{name === "Requirements" ? "Require\u00adments" : name}</span><small>0{index + 1}</small></button>; })}
        </div>
        <div className="spatial-connection" aria-hidden="true"><span /><i /></div>
        <div className="spatial-board" role="group" aria-label={t("같은 문의의 프로젝트 상태 변화")}>
          <div className="spatial-lane"><span><i />{t("진행 중")}</span><small>{t("요구사항 · 견적 검토")}</small></div>
          <div className="spatial-lane"><span><i />{t("협상 중")}</span><small>{t("제안서 · 범위 협의")}</small></div>
          <article id="workflow-example" className="spatial-project-card" data-project-id={project.id} aria-label={t("{v0} 예시 결과", { v0: t(demoSteps[view.selected]) })}>
            <span className="inquiry-liquid-shell" aria-hidden="true" />
            <div className="inquiry-card-content">
            <div className="spatial-card-meta"><span>{project.id}</span><span className="spatial-status">{t(project.status)}</span></div>
            <span className="spatial-project-icon"><TreeStructure size={22} /></span>
            <h3>{t("예약 웹사이트")}</h3>
            <p className="spatial-card-caption">{t(stageCopy[view.selected][0])}</p>
            <div className="spatial-card-detail" key={view.selected}><span>{t(demoSteps[view.selected])} / 0{view.selected + 1}</span><p>{t(stageCopy[view.selected][1])}</p>{view.selected >= 3 && <strong>{money(quote.total)}<small>{t("원")}</small></strong>}{view.selected === 1 && quote.extra && <small>{t("고객 예약 변경")}</small>}</div>
            <div className="spatial-card-footer"><span className="spatial-avatar">fo</span><span>{t("가상의 프로젝트")}</span><span>{view.selected + 1} / 5</span></div>
            </div>
          </article>
        </div>
        <div className="spatial-flow-bottom"><span><Check size={13} />{t(demoEvents[view.selected])}</span><button type="button" className="spatial-motion-toggle" disabled={reducedMotion} aria-pressed={state.paused} aria-label={reducedMotion ? t("동작 줄이기 적용 중") : state.paused ? t("예시 자동 진행 재개") : t("자동 진행 일시 정지")} onClick={() => dispatch({ type: "pause" })}>{state.paused ? <ArrowRight size={15} /> : <Pause size={15} />}<span>{state.paused ? t("동작 계속") : t("동작 멈추기")}</span></button></div>
        <p className="spatial-demo-disclaimer">{t("가상의 문의로 보여드리는 제품 예시입니다. 실제 분석·저장·발송은 실행되지 않습니다.")}</p>
      </div>
      </div>
      <p className="sr-only" role="status">{state.manual ? t("{v0} 예시 결과. {v1}, {v2}일, {v3}원.", { v0: t(demoSteps[view.selected]), v1: t(quote.label), v2: quote.days, v3: money(quote.total) }) : ""}</p>
    </section>

    <div className="spatial-capability-strip" aria-label={t("문의에서 제안까지")}><span>{t("하나의 문의, 이어지는 다섯 단계")}</span><div>{demoSteps.map((label,index)=>{const Icon=stageIcons[index]; return <span key={label}><Icon size={18} /><span className="spatial-capability-name">{t(label)}</span></span>;})}</div></div>
    <ReferenceStory state={state} quote={quote} onScopeChange={(scope) => dispatch({ type: "scope", scope })} />
    <section id="scope-comparison" className="spatial-chapter spatial-comparison" aria-labelledby="comparison-title">
      <FooterAtmosphere />
      <div className="spatial-comparison-heading section-heading"><p className="spatial-eyebrow"><span /> ONE PROJECT / YOUR SCOPE</p><h2 id="comparison-title">{t("범위가 달라지면,")}<br /><span>{t("숫자도 명확하게.")}</span></h2><p>{t("같은 예시 문의에 예약 변경 기능을 더해 비교해 보세요.")}</p></div>
      <div className="spatial-scope-estimator"><div className="spatial-scope-slider"><label htmlFor="scope-slider">{t("예시 프로젝트 범위")}</label><input id="scope-slider" type="range" min="0" max="1" step="1" value={quote.extra ? 1 : 0} aria-valuetext={t(quote.label)} onChange={(event) => dispatch({ type: "scope", scope: event.target.value === "1" ? "extended" : "essential" })} /><div><span>{t("핵심 범위")}</span><span>{t("예약 변경 추가")}</span></div></div><aside><span>{t("예시 견적")}</span><strong>{money(quote.total)}<small>KRW</small></strong><p>{t("부가세 별도 · 실제 견적 아님")}</p><Link href="/workspace">{t("업무 공간 열기")}<ArrowUpRight size={15} /></Link></aside></div>
      <div className="spatial-comparison-grid">
        <article><p className="spatial-comparison-label">01 / SCOPE</p><h3>{t("작업 범위")}</h3><strong>{String(quote.rows.length).padStart(2, "0")}<span>{t("개 항목")}</span></strong><p>{t("원문에서 정리한 작업 단위")}</p><ul>{quote.rows.map((row: { title: string; days: number }) => <li key={row.title}><Check size={13} />{t(row.title)}</li>)}</ul><a href="#workflow">{t("문의 흐름 보기")}<ArrowUpRight size={15} /></a></article>
        <article className="is-featured"><p className="spatial-comparison-label">02 / EFFORT</p><h3>{t("예상 공수")}</h3><strong>{quote.days}<span>{t("일")}</span></strong><p>{t("항목별 공수를 더한 예시")}</p><div className="spatial-comparison-meter" aria-hidden="true">{Array.from({length:13},(_,i)=><span className={i < quote.days ? "is-filled" : ""} key={i} />)}</div><p className="spatial-comparison-footnote">{t("일정은 자료 제공과 범위 확인 후 협의합니다.")}</p><a href="#evidence">{t("공수의 근거 보기")}<ArrowUpRight size={15} /></a></article>
        <article><p className="spatial-comparison-label">03 / ESTIMATE</p><h3>{t("예시 견적")}</h3><strong className="spatial-comparison-price">{money(quote.total)}<span>KRW</span></strong><p>{t("부가세 별도 · 실제 견적 아님")}</p><div className="spatial-comparison-formula"><span>{quote.days}{t("일")}</span><span>×</span><span>{money(quote.dailyRate)}{t("원")}</span></div><p className="spatial-comparison-footnote">{t("확정 전 사용자 검토가 필요합니다.")}</p><a href="#review">{t("완성될 초안 살펴보기")}<ArrowUpRight size={15} /></a></article>
      </div><p className="spatial-comparison-disclaimer">{t("제품 설명을 위한 가상 프로젝트입니다. 서비스 이용 요금이 아닙니다.")}</p>
    </section>
  </div>;
}
