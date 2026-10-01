import { useT } from "../../../app/lib/ui-language";
import { useEffect, useReducer, useRef, useState } from "react";
import { ArrowRight, Calculator, Check, ChatCenteredText, FileText, Pause, Play, ShieldCheck, TreeStructure, WarningCircle } from "@phosphor-icons/react";
import { demoEvents, demoQuote, demoReducer, demoScopes, demoSteps, initialDemoState } from "../product-demo.mjs";
import { DemoProjectFlow } from "./demo-project-flow";

const icons = [ChatCenteredText, TreeStructure, WarningCircle, Calculator, FileText];
const money = (value: number) => new Intl.NumberFormat("ko-KR").format(value);

export function WorkflowSection() {
  const t = useT();
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemoState);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const windowRef = useRef<HTMLDivElement>(null);
  const quote = demoQuote(state.scope);
  const finished = state.step === 4 && state.phase === "complete";
  const paused = state.paused || hovered || focused || reducedMotion || !visible || !pageVisible;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(preference.matches);
    const syncVisibility = () => setPageVisible(!document.hidden);
    syncMotion(); syncVisibility();
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    if (windowRef.current) observer.observe(windowRef.current);
    return () => {
      preference.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => dispatch({ type: finished ? "replay" : "tick" }), finished ? 4200 : state.phase === "running" ? 1800 : 1500);
    return () => window.clearTimeout(timer);
  }, [paused, finished, state.phase, state.step]);

  return (
    <section id="workflow" tabIndex={-1} className="chapter product-experience" data-step={state.selected} data-run-step={state.step} data-run={state.run} data-phase={state.phase} data-paused={paused}>
      <div id="product" tabIndex={-1} className="section-heading demo-heading">
        <p className="section-context">{t("문의에서 제안까지")}</p>
        <h2>{t("한 번의 문의가,")}<br />{t("검토 가능한 제안서가 됩니다.")}</h2>
        <p>{t("원문에서 빠진 정보를 찾고, 작업의 근거를 연결합니다.")}<br />{t("같은 문의가 제안서가 되는 과정을 직접 살펴보세요.")}</p>
      </div>
      <p className="sr-only" role="status">{state.paused ? t("{v0} 예시 결과. {v1}, {v2}일, {v3}원.", { v0: t(demoSteps[state.selected]), v1: t(quote.label), v2: quote.days, v3: money(quote.total) }) : ""}</p>
      <div ref={windowRef} className="demo-scene" data-playing={!paused && !finished} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <div className="demo-route" aria-hidden="true">
          {demoSteps.map((label, index) => { const Icon = icons[index]; const completed = state.history.includes(index); const running = state.step === index && state.phase === "running";
            return <div key={label} className={`demo-route-node${completed ? " is-complete" : ""}${running ? " is-running" : ""}`}><span>{completed ? <Check size={12} /> : running ? <span className="demo-route-spinner" /> : null}{completed ? t("완료") : running ? t("정리 중") : t("대기")}</span><div><Icon size={18} /><strong>{label === "문의" ? t("원문 보관") : label === "제안" ? t("제안서 초안") : t(label)}</strong></div></div>;
          })}
        </div>
        <div className="demo-source-layer" aria-hidden="true"><ChatCenteredText size={17} /><span>{t("고객의 한마디")}</span><strong>{t("예약 가능한 웹사이트,")}<br />{t("얼마면 만들 수 있나요?")}</strong><span>{t("원문을 보관했습니다.")}</span></div>
        <div className="product-demo">
        <div className="demo-topbar">
          <div className="demo-project"><span className="demo-project-icon"><TreeStructure size={22} /></span><div><strong>{t("예약 웹사이트")}</strong><span>{t("제품 체험 · 가상의 문의와 결과")}</span></div></div>
          <div className="demo-controls">
            <span>{reducedMotion ? t("동작 줄이기 적용") : t("자동 진행 예시")}</span>
            <button type="button" className="demo-pause" disabled={reducedMotion} aria-label={reducedMotion ? t("동작 줄이기 적용 중") : state.paused ? t("예시 자동 진행 재개") : t("자동 진행 일시 정지")} title={reducedMotion ? t("동작 줄이기 적용 중") : state.paused ? t("예시 자동 진행 재개") : t("자동 진행 일시 정지")} aria-pressed={state.paused} onClick={() => dispatch({ type: "pause" })}>
              {state.paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
          </div>
        </div>
        <div className="demo-layout">
          <div className="demo-navigation" role="group" aria-label={t("제품 예시 단계 선택")}>
            <span className="demo-nav-label">{t("이 문의의 흐름")}</span>
            {demoSteps.map((label, index) => {
              const Icon = icons[index];
              const complete = state.history.includes(index);
              return <button key={label} type="button" className={`demo-step${state.selected === index ? " is-selected" : ""}`} aria-pressed={state.selected === index} aria-controls="workflow-example" onClick={() => dispatch({ type: "select", step: index })}>
                <Icon size={19} /><span>{t(label)}</span><span className="demo-step-status" aria-label={complete ? t("자동 예시 완료") : t("예시 결과 보기")}>{complete ? <Check size={15} /> : String(index + 1).padStart(2, "0")}</span>
              </button>;
            })}
            <p className="demo-nav-note"><ShieldCheck size={17} />{t("확정은 사용자의 몫")}</p>
          </div>
          <div id="workflow-example" className="demo-view" role="region" aria-label={t("{v0} 예시 결과", { v0: t(demoSteps[state.selected]) })}>
            <div className="demo-view-heading"><span>0{state.selected + 1} / 05</span><span className="demo-draft-label">{t("검토 전 예시")}</span></div>
            <DemoProjectFlow state={state} paused={paused} reducedMotion={reducedMotion} />
            {state.selected === 0 && <>
              <h3>{t("견적은 이 한마디에서 시작합니다.")}</h3><p className="demo-subtitle">{t("메시지는 그대로 보관하고, 확인할 정보를 따로 정리합니다.")}</p>
              <div className="demo-extraction"><span className="demo-label">{t("이 메시지에서 찾은 것")}</span><div><span>{t("예약 · 시간 선택")}</span><span>{t("관리자 화면")}</span><span>{t("모바일 대응")}</span></div><p>{t("결제 방식과 예약 변경 정책은 아직 확인이 필요합니다.")}</p></div>
              <button type="button" className="demo-text-action" onClick={() => dispatch({ type: "select", step: 1 })}>{t("정리된 요구사항 보기")}<ArrowRight size={17} /></button>
            </>}
            {state.selected === 1 && <>
              <h3>{t("말로 들어온 문의를, 작업 단위로.")}</h3><p className="demo-subtitle">{t("기능과 완료 조건을 함께 적어 범위의 해석을 맞춥니다.")}</p>
              <div className="demo-requirements">
                {[ ["예약 · 시간 선택", "고객이 가능한 시간을 고르고 예약을 등록합니다."], ["관리자 예약 관리", "관리자 1명이 예약 목록과 상세 내용을 확인합니다."], ["반응형 화면", "휴대폰에서도 예약을 등록하고 확인할 수 있습니다."] ].map(([title, body], index) => <div key={t(title)}><span>R0{index + 1}</span><div><strong>{t(title)}</strong><p>{t(body)}</p></div><span className="demo-tag">{t("포함")}</span></div>)}
                {quote.extra && <div><span>R04</span><div><strong>{t("고객 예약 변경")}</strong><p>{t("고객이 정해진 정책 안에서 예약 시간을 변경합니다.")}</p></div><span className="demo-tag">{t("추가")}</span></div>}
              </div>
              <div className="demo-source-note"><ChatCenteredText size={18} /><p><strong>{t("원문과 연결")}</strong> {t("“모바일에서도 쓸 수 있어야 해요.” → 반응형 화면")}</p></div>
            </>}
            {state.selected === 2 && <>
              <h3>{t("모르는 것은, 견적에 숨기지 않습니다.")}</h3><p className="demo-subtitle">{t("빠진 정보를 질문으로 바꾸고, 포함하지 않을 범위도 명시합니다.")}</p>
              <div className="demo-question"><span className="demo-label">{t("확인 질문 01")}</span><strong>{t("온라인 결제도 필요한가요?")}</strong><p>{t("예시 답변 · 결제는 현장에서 해요. 온라인 결제는 필요 없어요.")}</p><span className="demo-tag">{t("예시 답변 반영")}</span></div>
              <div className="demo-risk"><WarningCircle size={20} /><div><strong>{t("예약 변경 정책은 확인이 필요합니다.")}</strong><p>{t("취소 가능 시간과 변경 횟수에 따라 작업 범위가 달라집니다.")}</p></div></div>
              <div className="demo-scope-choice" role="group" aria-label={t("예약 변경 범위 선택")}><span className="demo-label">{t("범위를 바꿔 비교해 보세요")}</span>{Object.entries(demoScopes).map(([key, option]) => <button type="button" key={key} aria-pressed={state.scope === key} onClick={() => dispatch({ type: "scope", scope: key })}><span>{t(option.label)}</span><strong>{option.days}{t("일")}</strong>{state.scope === key && <Check size={17} />}</button>)}</div>
              <p className="demo-excluded">{t("제외 범위 · 온라인 결제, 별도 모바일 앱")}</p>
            </>}
            {state.selected === 3 && <>
              <h3>{t("숫자마다, 설명할 수 있는 근거를.")}</h3><p className="demo-subtitle">{t("작업별 공수 × 예시 일단가. 범위를 바꾸며 차이를 확인하세요.")}</p>
              <div className="demo-quote-scopes" role="group" aria-label={t("견적 범위 선택")}>{Object.entries(demoScopes).map(([key, option]) => <button type="button" key={key} aria-pressed={state.scope === key} onClick={() => dispatch({ type: "scope", scope: key })}>{t(option.label)}</button>)}</div>
              <div className="demo-quote-table" role="table" aria-label={t("작업별 예시 공수와 금액")}><div className="demo-quote-row demo-table-head" role="row"><span role="columnheader">{t("작업")}</span><span role="columnheader">{t("공수")}</span><span role="columnheader">{t("금액")}</span></div>{quote.rows.map((row: { title: string; days: number }) => <div className="demo-quote-row" role="row" key={t(row.title)}><div role="rowheader"><strong>{t(row.title)}</strong></div><span role="cell">{row.days}{t("일")}</span><span role="cell">{money(row.days * quote.dailyRate)}{t("원")}</span></div>)}</div>
              <div className="demo-total"><div><span>{t(quote.label)} · {quote.days}{t("일")}</span><strong>{money(quote.total)}<small>{t("원")}</small></strong></div><p>{t("예시 일단가")}{money(quote.dailyRate)}{t("원")}<br />{t("부가세 별도 · 실제 견적 아님")}</p></div>
              <div className="demo-source-note"><ShieldCheck size={18} /><p><strong>{t("계산 가정")}</strong> {t("관리자 1명, 현장 결제, 고객의 디자인 자료 제공. 견적 전에 가정을 확인합니다.")}</p></div>
            </>}
            {state.selected === 4 && <>
              <h3>{t("이제 고객과 같은 범위를 봅니다.")}</h3><p className="demo-subtitle">{t("합의할 범위, 금액, 일정이 한 문서에 모입니다.")}</p>
              <article className="demo-proposal"><div><FileText size={22} /><span>{t("제안서 예시 · 검토 전 초안")}</span></div><h4>{t("예약 웹사이트 개발 제안")}</h4><dl><div><dt>{t("포함 범위")}</dt><dd>{t("예약 · 관리자 화면 · 반응형")}{quote.extra ? t(" · 고객 예약 변경") : ""}</dd></div><div><dt>{t("제외 범위")}</dt><dd>{t("온라인 결제 · 별도 모바일 앱")}</dd></div><div><dt>{t("예상 공수")}</dt><dd>{quote.days}{t("일 · 일정은 자료 수령 후 협의")}</dd></div><div><dt>{t("예시 금액")}</dt><dd>{money(quote.total)}{t("원 · 부가세 별도")}</dd></div></dl><p>{t("예약 변경 정책과 자료 제공 일정을 확인한 뒤 확정합니다.")}</p><span className="demo-tag">{t("사용자 검토 필요")}</span></article>
              <button type="button" className="demo-text-action" onClick={() => dispatch({ type: "select", step: 3 })}>{t("금액의 근거 다시 보기")}<ArrowRight size={17} /></button>
            </>}
            <div className="demo-view-footer"><span>{t("모든 화면은 같은 문의의 예시입니다.")}</span><button type="button" onClick={() => dispatch({ type: "next" })}>{t("다음 단계")}<ArrowRight size={15} /></button></div>
          </div>
          <aside className="demo-activity" aria-label={t("자동 예시 진행 기록")}>
            <div className="demo-activity-heading"><span className={`demo-status-dot${!paused && !finished ? " is-running" : ""}`} aria-hidden="true" /><strong>{finished ? t("예시 완료") : paused ? t("예시 일시 정지") : t("예시 진행 중")}</strong></div>
            <p>{finished ? t("초안을 준비했습니다. 확정 전에 검토하세요.") : t("{v0} {v1}", { v0: t(demoSteps[state.step]), v1: state.phase === "complete" ? t("완료") : t("정리 중") })}</p>
            <div className="demo-progress" role="progressbar" aria-label={t("자동 예시 완료 단계")} aria-valuemin={0} aria-valuemax={5} aria-valuenow={state.history.length}><span style={{ width: `${state.history.length * 20}%` }} /></div>
            <div className="demo-history-label"><span>{t("예시 진행 기록")}</span><span>{state.history.length} / 5</span></div>
            <ol className="demo-history">{state.history.map((step: number) => <li key={step}><Check size={16} /><span>{t(demoEvents[step])}</span></li>)}</ol>
            {!state.history.length && <p className="demo-history-empty">{t("자동 재생하면 완료한 단계가 여기에 쌓입니다.")}</p>}
            <p className="demo-activity-note">{t("단계 선택은 결과 미리보기입니다. 실제 분석이나 저장은 실행되지 않습니다. 마우스나 키보드 포커스가 화면 안에 있으면 자동 재생을 멈춥니다.")}</p>
          </aside>
        </div>
        </div>
        <div className={`demo-result-layer${state.history.includes(4) ? " is-ready" : ""}`} aria-hidden="true"><div><FileText size={18} /><span>{t("고객에게 전달할 초안")}</span><span>{state.history.includes(4) ? t("준비 완료") : t("예시")}</span></div><strong>{t("예약 웹사이트 개발 제안")}</strong><span>{t("포함 범위 · 예약 / 관리자 / 반응형")}{quote.extra ? t(" / 예약 변경") : ""}</span><div><b>{money(quote.total)}<small>{t("원")}</small></b><span>{quote.days}{t("일 · 부가세 별도")}</span></div><p>{t("확정 전 사용자 검토가 필요합니다.")}</p></div>
      </div>
      <div id="evidence" tabIndex={-1} className="demo-principles"><ShieldCheck size={22} /><div><strong>{t("원문은 보관하고, 가정은 드러내고, 확정은 직접.")}</strong><p>{t("예시 금액과 공수는 제품 설명용입니다. 실제 작업 공간에서는 내 단가와 근거를 검토한 뒤 확정합니다.")}</p></div><button type="button" className="demo-text-action" onClick={() => { dispatch({ type: "select", step: 3 }); document.getElementById("workflow")?.scrollIntoView({ block: "start", behavior: reducedMotion ? "instant" : "smooth" }); }}>{t("견적 근거 보기")}<ArrowRight size={16} /></button></div>
    </section>
  );
}
