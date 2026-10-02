import { useEffect, useReducer, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChatCenteredText, FileText, GitBranch, Pause, ShieldCheck, Sparkle, TreeStructure, WarningCircle } from "@phosphor-icons/react";
import { useT } from "../../../app/lib/ui-language";
import { demoEvents, demoProjectSnapshot, demoQuote, demoReducer, demoScopes, demoSteps, initialDemoState } from "../product-demo.mjs";

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
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const sceneRef = useRef<HTMLDivElement>(null);
  const paused = state.paused || hovered || focused || reducedMotion || !visible || !pageVisible;
  const finished = state.step === 4 && state.phase === "complete";
  // Reduced motion opens a complete, readable sample. Manual stage selection still works.
  const view = reducedMotion && !state.manual ? { ...state, selected: 4, phase: "complete" } : state;
  const project = demoProjectSnapshot(view, reducedMotion);
  const quote = demoQuote(state.scope);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(preference.matches);
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

  return <>
    <div className="spatial-atmosphere" aria-hidden="true"><svg viewBox="0 0 1440 2300" preserveAspectRatio="none"><defs><linearGradient id="spatial-ribbon" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#705699" stopOpacity="0" /><stop offset=".45" stopColor="#b5a0e7" stopOpacity=".5" /><stop offset="1" stopColor="#76599d" stopOpacity="0" /></linearGradient></defs><path d="M-240 260 C 220 900 1400 -120 1630 430 S -130 1010 470 1550 S 1470 1650 1550 2260" /><path d="M-240 300 C 220 940 1400 -80 1630 470 S -130 1050 470 1590 S 1470 1690 1550 2300" /></svg></div>
    <section id="workflow" tabIndex={-1} className="spatial-chapter spatial-workflow" data-step={view.selected} data-run-step={state.step} data-run={state.run} data-phase={state.phase} data-paused={paused}>
      <div id="product" tabIndex={-1} className="spatial-heading section-heading">
        <p className="spatial-eyebrow"><span /> 01 / ONE CONNECTED FLOW</p>
        <h2>{t("흩어진 업무를,")}<br /><span>{t("하나의 흐름으로.")}</span></h2>
        <p>{t("고객의 한마디에서 제안서까지.")}<br />{t("맥락은 이어지고, 다음 할 일은 선명해집니다.")}</p>
        <a href="#review" className="spatial-text-link">{t("완성될 초안 살펴보기")}<ArrowDown size={16} /></a>
        <div className="spatial-editorial-note"><span>FREELANCE OPS / WORKFLOW</span><p>{t("AI는 준비하고,")}<br />{t("당신은 중요한 결정에 집중하세요.")}</p></div>
      </div>
      <div ref={sceneRef} className="spatial-flow" data-column={project.column} data-playing={!paused} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <div className="spatial-flow-top"><span><Sparkle size={15} /> {t("제품 예시")}</span><span className="spatial-auto"><i />{reducedMotion ? t("동작 줄이기 적용") : t("자동 진행 예시")}</span></div>
        <div className="spatial-stages" role="group" aria-label={t("제품 예시 단계 선택")}>
          {demoSteps.map((label, index) => { const Icon = stageIcons[index]; return <button key={label} type="button" className={`spatial-stage${view.selected === index ? " is-current" : ""}${view.selected > index ? " is-past" : ""}`} aria-pressed={view.selected === index} aria-controls="workflow-example" onClick={() => dispatch({ type: "select", step: index })}><span className="spatial-stage-icon"><Icon size={20} /></span><span>{t(label)}</span><small>0{index + 1}</small></button>; })}
        </div>
        <div className="spatial-connection" aria-hidden="true"><span /><i /></div>
        <div className="spatial-board" role="group" aria-label={t("같은 문의의 프로젝트 상태 변화")}>
          <div className="spatial-lane"><span><i />{t("진행 중")}</span><small>{t("요구사항 · 견적 검토")}</small></div>
          <div className="spatial-lane"><span><i />{t("협상 중")}</span><small>{t("제안서 · 범위 협의")}</small></div>
          <article id="workflow-example" className="spatial-project-card" data-project-id={project.id} aria-label={t("{v0} 예시 결과", { v0: t(demoSteps[view.selected]) })}>
            <div className="spatial-card-meta"><span>{project.id}</span><span className="spatial-status">{t(project.status)}</span></div>
            <span className="spatial-project-icon"><TreeStructure size={22} /></span>
            <h3>{t("예약 웹사이트")}</h3>
            <p className="spatial-card-caption">{t(stageCopy[view.selected][0])}</p>
            <div className="spatial-card-detail" key={view.selected}><span>{t(demoSteps[view.selected])} / 0{view.selected + 1}</span><p>{t(stageCopy[view.selected][1])}</p>{view.selected >= 3 && <strong>{money(quote.total)}<small>{t("원")}</small></strong>}{view.selected === 1 && quote.extra && <small>{t("고객 예약 변경")}</small>}</div>
            <div className="spatial-card-footer"><span className="spatial-avatar">fo</span><span>{t("가상의 프로젝트")}</span><span>{view.selected + 1} / 5</span></div>
          </article>
        </div>
        <div className="spatial-flow-bottom"><span><Check size={13} />{t(demoEvents[view.selected])}</span><button type="button" className="spatial-motion-toggle" disabled={reducedMotion} aria-pressed={state.paused} aria-label={reducedMotion ? t("동작 줄이기 적용 중") : state.paused ? t("예시 자동 진행 재개") : t("자동 진행 일시 정지")} onClick={() => dispatch({ type: "pause" })}>{state.paused ? <span className="spatial-resume-icon" aria-hidden="true">↻</span> : <Pause size={15} />}<span>{state.paused ? t("동작 계속") : t("동작 멈추기")}</span></button></div>
      </div>
      <p className="spatial-demo-disclaimer">{t("가상의 문의로 보여드리는 제품 예시입니다. 실제 분석·저장·발송은 실행되지 않습니다.")}</p>
      <p className="sr-only" role="status">{state.manual ? t("{v0} 예시 결과. {v1}, {v2}일, {v3}원.", { v0: t(demoSteps[view.selected]), v1: t(quote.label), v2: quote.days, v3: money(quote.total) }) : ""}</p>
    </section>

    <section id="review" tabIndex={-1} className="spatial-chapter spatial-review" aria-labelledby="review-title">
      <div className="spatial-review-intro section-heading"><p className="spatial-eyebrow"><span /> 02 / YOUR CALL, ALWAYS</p><h2 id="review-title">{t("AI가 정리하고,")}<br /><span>{t("결정은 당신이.")}</span></h2><p>{t("감춰진 가정 없이, 설명할 수 있는 견적.")}<br />{t("범위와 근거를 확인한 뒤 고객과 공유하세요.")}</p></div>
      <div className="spatial-review-stage">
        <aside className="spatial-review-panel" aria-label={t("초안 검토 예시")}>
          <div className="spatial-panel-label"><ShieldCheck size={18} /><span>{t("초안 검토")}</span><span>01</span></div>
          <h3>{t("공유하기 전,")}<br />{t("한 번 더 명확하게.")}</h3>
          <ul className="spatial-checklist"><li><Check size={15} /><span>{t("원문과 작업 범위 연결")}</span></li><li><Check size={15} /><span>{t("항목별 공수와 금액 확인")}</span></li><li><WarningCircle size={15} /><span>{t("예약 변경 정책 확인 필요")}</span></li></ul>
          <div className="spatial-scope-switch" role="group" aria-label={t("견적 범위 선택")}><p>{t("범위를 바꿔 비교해 보세요")}</p>{Object.entries(demoScopes).map(([key, option]) => <button type="button" key={key} aria-pressed={state.scope === key} onClick={() => dispatch({ type: "scope", scope: key })}><span className="spatial-radio">{state.scope === key && <span />}</span>{t(option.label)}<span>{option.days}{t("일")}</span></button>)}</div>
          <p className="spatial-review-note"><ShieldCheck size={16} />{t("확정은 사용자의 몫")}</p>
        </aside>
        <article className="spatial-proposal" aria-label={t("예약 웹사이트 개발 제안")}>
          <div className="spatial-document-header"><span className="spatial-document-brand">Freelance Ops<span>.</span></span><span>{t("검토 전 예시")}</span></div>
          <p className="spatial-document-eyebrow">PROJECT PROPOSAL / FO-024</p>
          <h3>{t("예약 웹사이트")}<br /><span>{t("개발 제안서")}</span></h3>
          <p className="spatial-document-description">{t("예약 · 관리자 화면 · 반응형")}{quote.extra ? t(" · 고객 예약 변경") : ""}</p>
          <div className="spatial-quote-table" role="table" aria-label={t("작업별 예시 공수와 금액")}><div role="row" className="spatial-quote-head"><span role="columnheader">{t("작업")}</span><span role="columnheader">{t("공수")}</span><span role="columnheader">{t("금액")}</span></div>{quote.rows.map((row: { title: string; days: number }) => <div role="row" key={row.title}><span role="rowheader">{t(row.title)}</span><span role="cell">{row.days}{t("일")}</span><span role="cell">{money(row.days * quote.dailyRate)}</span></div>)}</div>
          <div className="spatial-quote-total"><div><span>{t("예시 금액")}</span><strong>{money(quote.total)}<small>{t("원")}</small></strong></div><span>{quote.days}{t("일")}<br />{t("부가세 별도")}</span></div>
          <details className="spatial-assumptions"><summary>{t("계산 가정과 제외 범위")}<ArrowDown size={14} /></summary><p>{t("관리자 1명, 현장 결제, 고객의 디자인 자료 제공. 견적 전에 가정을 확인합니다.")}</p><p>{t("제외 범위 · 온라인 결제, 별도 모바일 앱")}</p><p>{t("예시 일단가")} {money(quote.dailyRate)}{t("원")}</p></details>
          <div className="spatial-document-footer"><span><i />{t("사용자 검토 필요")}</span><span>{t("실제 견적 아님")}</span></div>
        </article>
        <span className="spatial-paper-shadow" aria-hidden="true" />
      </div>
    </section>

    <section id="evidence" tabIndex={-1} className="spatial-chapter spatial-evidence" aria-labelledby="evidence-title">
      <div className="spatial-evidence-intro section-heading"><p className="spatial-eyebrow"><span /> 03 / EVERY NUMBER, A REASON</p><h2 id="evidence-title">{t("숫자 뒤의 근거까지,")}<br /><span>{t("놓치지 않도록.")}</span></h2><p>{t("어디서 나온 범위인지, 왜 이만큼 필요한지.")}<br />{t("질문과 가정을 함께 남겨 다음 대화를 준비합니다.")}</p></div>
      <div className="spatial-evidence-stage">
        <div className="spatial-effort" role="img" aria-label={`${t("예시 공수 구성: 예약 5일, 관리자 3.5일, 반응형과 검수 1.5일.")} ${quote.extra ? t("예약 변경 3일 추가. 총 13일.") : t("총 10일.")}`}><div className="spatial-effort-heading"><span>{t("예상 공수")}</span><span>{t("예시")}</span></div><div className="spatial-effort-number">{quote.days}<span>{t("일")}</span><ArrowUpRight size={24} /></div><div className="spatial-bars" aria-hidden="true">{quote.rows.map((row: { title: string; days: number }, index: number) => <div key={row.title}><span className="spatial-bar-label">{row.days}{t("일")}</span><span className="spatial-bar" style={{ height: `${row.days * 28}px` }} /><small>0{index + 1}</small></div>)}</div><p>{t("작업별 공수의 합 · 성과 지표가 아닌 예시 계산")}</p></div>
        <div className="spatial-source-trace"><div className="spatial-trace-line" aria-hidden="true" /><div><span className="spatial-trace-dot"><ChatCenteredText size={16} /></span><span className="spatial-eyebrow">SOURCE</span><p>{t("“모바일에서도 쓸 수 있어야 해요.”")}</p></div><div><span className="spatial-trace-dot"><GitBranch size={16} /></span><span className="spatial-eyebrow">REQUIREMENT</span><p>{t("반응형 화면")}</p><small>{t("휴대폰에서도 예약을 등록하고 확인할 수 있습니다.")}</small></div><div><span className="spatial-trace-dot"><ShieldCheck size={16} /></span><span className="spatial-eyebrow">ASSUMPTION</span><p>{t("디자인 자료는 고객이 제공합니다.")}</p><small>{t("견적 전에 가정을 확인합니다.")}</small></div></div>
      </div>
      <div className="spatial-principles"><div><span>01</span><strong>{t("원문은 그대로")}</strong><p>{t("고객의 요청을 다시 확인할 수 있게.")}</p></div><div><span>02</span><strong>{t("가정은 드러나게")}</strong><p>{t("불확실한 내용은 확인할 질문으로.")}</p></div><div><span>03</span><strong>{t("확정은 직접")}</strong><p>{t("검토한 범위와 금액만 고객에게.")}</p></div></div>
      <a className="spatial-text-link" href="#review">{t("견적 근거 보기")}<ArrowRight size={16} /></a>
    </section>
  </>;
}
