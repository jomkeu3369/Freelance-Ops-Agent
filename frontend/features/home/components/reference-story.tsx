import type { CSSProperties } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChatCenteredText, FileText, GitBranch, ShieldCheck, TreeStructure, WarningCircle } from "@phosphor-icons/react";
import { useT } from "../../../app/lib/ui-language";
import { demoQuote, demoScopes, initialDemoState } from "../product-demo.mjs";
import { StoryCount, useStoryMetricEntry } from "./story-metric-entry";
import { EvidenceAtmosphere } from "./scene-atmosphere";

type Quote = {
  label: string;
  days: number;
  extra: boolean;
  dailyRate: number;
  total: number;
  rows: { title: string; days: number }[];
};
type StoryProps = {
  state: ReturnType<typeof initialDemoState>;
  quote: Quote;
  onScopeChange: (scope: string) => void;
};
type Translate = ReturnType<typeof useT>;
const money = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
const extendedQuote: Quote = demoQuote("extended");

/** The existing Freelance Ops F mark, recolored with the scene foreground. */
export function StoryMark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M24.064 1.664C23.84 1.632 23.584 1.6 23.328 1.6H23.264H19.968H5.696C4.992 1.6 4.352 1.792 3.776 2.08C3.616 2.176 3.424 2.272 3.296 2.4C2.304 3.136 1.664 4.32 1.664 5.664V20V23.296C1.664 23.552 1.696 23.808 1.728 24.064C1.728 26.304 6.528 30.432 8.768 30.432H26.336C28.576 30.432 30.4 28.608 30.4 26.368V8.704C30.368 6.496 26.336 1.76 24.064 1.664ZM9.728 7.52H19.296V9.888H12V13.312H19.296V15.648H12.064V21.44H9.696V7.52H9.728ZM29.728 26.336C29.728 28.224 28.192 29.728 26.336 29.728H8.736C7.872 29.728 6.272 28.832 4.8 27.552C4.64 27.392 4.448 27.232 4.288 27.072C4.704 27.232 5.184 27.296 5.664 27.296H23.232H23.296C25.536 27.296 27.36 25.472 27.36 23.232V5.664C27.36 5.216 27.296 4.8 27.168 4.384C27.296 4.512 27.424 4.64 27.552 4.8C28.832 6.24 29.728 7.872 29.728 8.736V26.336Z" fill="currentColor" /></svg>;
}

function SectionTitle({ eyebrow, title, accent, description, id }: { eyebrow: string; title: string; accent: string; description: string; id: string }) {
  const t = useT();
  return <header className="story-section-heading" data-story-reveal="heading"><div><p className="story-eyebrow"><i />{t(eyebrow)}</p><h2 id={id}>{t(title)} <span>{t(accent)}</span></h2></div><p>{t(description)}</p></header>;
}

function ExecutionTimeline({ quote, t }: { quote: Quote; t: Translate }) {
  return <div className="story-panel story-execution" aria-label={t("작업별 예시 공수 흐름")} data-story-reveal="visual"><div className="story-panel-top"><span>FO-024 / {t("작업 범위")}</span><span className="story-muted">{t("가상의 프로젝트")}</span></div><div className="story-timeline">
    {quote.rows.map((row, index) => {
      const start = quote.rows.slice(0, index).reduce((sum, item) => sum + item.days, 0);
      return <div className="story-timeline-row" key={row.title}><span><Check size={14} />{t(row.title)}</span><div className="story-timeline-track" aria-hidden="true"><i data-story-meter style={{ width: `${row.days / quote.days * 100}%`, marginLeft: `${start / quote.days * 100}%` }} /></div><span>{row.days}{t("일")}</span></div>;
    })}
    <div className="story-timeline-axis" aria-hidden="true"><span>{t("공수 합계")}</span><div><span>0</span><span>{quote.days / 2}</span><span>{quote.days}{t("일")}</span></div><span /></div>
  </div><p className="story-panel-footnote">{t("작업별 공수의 합 · 성과 지표가 아닌 예시 계산")}</p></div>;
}

function ReviewConversation({ state, quote, onScopeChange, t }: StoryProps & { t: Translate }) {
  return <aside className="story-panel spatial-review-panel story-review-chat" aria-label={t("초안 검토 예시")} data-story-reveal="visual"><div className="story-panel-top"><span><ShieldCheck size={16} />{t("초안 검토")}</span><span className="story-muted">{t("검토 전 예시")}</span></div><div className="story-chat-message" data-story-chat><span className="story-chat-avatar"><ChatCenteredText size={17} /></span><div><span>{t("확인 질문")}</span><p>{t("온라인 결제도 필요한가요?")}</p></div></div><div className="story-chat-reply" data-story-chat><p>{t("현장 결제를 가정하고, 온라인 결제는 제외했어요.")}</p><span><WarningCircle size={13} />{t("견적 전에 가정을 확인합니다.")}</span></div><div className="spatial-scope-switch story-scope-switch" role="group" aria-label={t("견적 범위 선택")}><p>{t("범위를 바꿔 비교해 보세요")}</p><div>{Object.entries(demoScopes).map(([key, option]) => <button type="button" key={key} aria-pressed={state.scope === key} onClick={() => onScopeChange(key)}><span className="spatial-radio">{state.scope === key && <span />}</span><span>{t(option.label)}</span><span>{option.days}{t("일")}</span></button>)}</div></div><p className="story-chat-result"><Check size={14} />{t(quote.label)}<span>{t("확정은 사용자의 몫")}</span></p></aside>;
}

function EffortPrisms({ quote, t }: { quote: Quote; t: Translate }) {
  return <div className="story-panel spatial-effort story-effort-prisms" data-ambient data-ambient-visible="false" role="img" aria-label={`${t("예시 공수 구성: 예약 5일, 관리자 3.5일, 반응형과 검수 1.5일.")} ${quote.extra ? t("예약 변경 3일 추가. 총 13일.") : t("총 10일.")}`} data-story-reveal="visual"><div className="story-panel-top"><span>{t("예상 공수")} · {t("예시")}</span><span className="spatial-effort-number">{quote.days}<span>{t("일")}</span></span></div><div className="spatial-bars story-prism-chart" data-count={quote.rows.length} aria-hidden="true">{quote.rows.map((row, index) => <div className="story-prism-column" key={row.title} data-story-prism style={{ "--chart-column": index + 1 } as CSSProperties}><div className="story-prism-stack"><span className="spatial-bar-label">{row.days}{t("일")}</span><span className="spatial-bar" style={{ "--prism-height": `${row.days * 29}px` } as CSSProperties}><i className="story-prism-front" /><i className="story-prism-side" /><i className="story-prism-top" /></span></div><small>{t(row.title)}</small></div>)}</div><p>{t("작업별 공수의 합 · 성과 지표가 아닌 예시 계산")}</p></div>;
}

function BenefitCards({ quote, t }: { quote: Quote; t: Translate }) {
  const connections = [{ label: "문의", Icon: ChatCenteredText }, { label: "요구사항", Icon: TreeStructure }, { label: "견적", Icon: GitBranch }, { label: "제안", Icon: FileText }];
  return <div className="story-benefit-grid"><article className="story-panel story-benefit-card" data-story-merge-card><h3>{t("하나의 문의, 이어지는 맥락.")}</h3><p>{t("고객의 말에서 작업 범위와 제안까지. 같은 프로젝트의 맥락을 함께 살펴보세요.")}</p><div className="story-radial" aria-hidden="true"><svg viewBox="0 0 600 270" preserveAspectRatio="none"><path d="M300 145 100 145M300 145 185 60M300 145 415 60M300 145 500 145" /><circle cx="300" cy="145" r="103" /><circle className="story-radial-dot" cx="186" cy="145" r="3" /><circle className="story-radial-dot" cx="359" cy="101" r="3" /></svg><div className="story-radial-core" data-story-brand-target><StoryMark /></div>{connections.map(({ label, Icon }, index) => <div className={`story-radial-node story-radial-node-${index + 1}`} key={label}><span><Icon size={19} /></span><small>{t(label)}</small></div>)}</div><p className="story-panel-footnote">{t("원문 · 범위 · 견적 · 제안서")}</p></article><article className="story-panel story-benefit-card" data-story-reveal="card"><h3>{t("숫자마다, 설명할 수 있는 이유.")}</h3><p>{t("항목별 공수를 더하고 예시 일단가를 곱합니다. 범위를 바꾸면 근거와 금액도 함께 바뀝니다.")}</p><div className="story-evidence-meters">{quote.rows.map((row, index) => <div key={row.title}><div><span>{t(row.title)}</span><small>{String(index + 1).padStart(2, "0")} / {t("작업별 공수")}</small></div><span className="story-evidence-meter" aria-hidden="true"><i data-story-meter style={{ width: `${row.days / quote.days * 100}%` }} /></span><span>{row.days}{t("일")}</span></div>)}</div><p className="story-panel-footnote"><ShieldCheck size={14} />{t("감춰진 가정 없이, 설명할 수 있는 견적.")}</p></article></div>;
}

function ProposalDashboard({ quote, t }: { quote: Quote; t: Translate }) {
  return <div className="story-dashboard-grid">
    <article className="story-panel spatial-proposal story-dashboard-tasks" aria-label={t("예약 웹사이트 개발 제안")} data-story-reveal="card"><div className="story-panel-top"><span>{t("예약 웹사이트")} / FO-024</span><span className="story-outline-badge"><FileText size={13} />{t("검토 전 예시")}</span></div><div className="story-quote-caption"><h3>{t("개발 제안서")}</h3><span>{t("작업별 공수 × 예시 일단가")}</span></div><div className="spatial-quote-table story-task-grid" role="table" aria-label={t("작업별 예시 공수와 금액")}><div role="row" className="spatial-quote-head"><span role="columnheader">{t("작업")}</span><span role="columnheader" className="story-grid-effort">{t("공수 구성")}</span><span role="columnheader">{t("공수")}</span><span role="columnheader">{t("금액")}</span></div>{quote.rows.map((row, index) => <div role="row" key={row.title}><span role="rowheader"><i className={`story-task-dot story-task-dot-${index}`} />{t(row.title)}</span><span role="cell" className="story-grid-effort"><span className="story-day-cells" aria-hidden="true">{Array.from({ length: extendedQuote.rows[0].days * 2 }, (_, cell) => <i key={cell} className={cell < row.days * 2 ? "is-active" : ""} />)}</span><span className="sr-only">{row.days}{t("일")}</span></span><span role="cell">{row.days}{t("일")}</span><span role="cell">{money(row.days * quote.dailyRate)}</span></div>)}</div><div className="spatial-quote-total"><div><span>{t("예시 금액")}</span><strong>{money(quote.total)}<small>{t("원")}</small></strong></div><span>{quote.days}{t("일")} × {money(quote.dailyRate)}{t("원")}<br />{t("부가세 별도 · 실제 견적 아님")}</span></div></article>
    <article className="story-panel story-dashboard-ring" data-story-reveal="card" data-story-metric-scene><p className="story-mono-label">{t("선택한 범위의 공수")}</p><div className="story-ring-figure"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="63" /><circle className="story-ring-fill" data-story-ring cx="80" cy="80" r="63" pathLength="100" strokeDasharray={`${quote.days / extendedQuote.days * 100} 100`} /></svg><div><strong><StoryCount value={quote.days} /><small>{t("일")}</small></strong><span>/ {extendedQuote.days}{t("일")}</span></div></div><p>{t(quote.label)}</p><small>{t("확장 범위와 비교한 공수 예시")}</small></article>
    <article className="story-panel story-dashboard-small" data-story-reveal="card"><p className="story-mono-label">{t("작업 범위")}</p><div className="story-scope-chips" aria-hidden="true">{quote.rows.map((row, index) => <span key={row.title}>{String(index + 1).padStart(2, "0")}</span>)}</div><h3>{quote.rows.length}<span>{t("개 항목")}</span></h3><p>{t("원문에서 정리한 작업 단위")}</p><div className="story-card-baseline"><Check size={14} />{t(quote.label)}</div></article>
    <article className="story-panel story-dashboard-small story-assumptions-card" data-story-reveal="card"><p className="story-mono-label">{t("가정은 드러나게")}</p><div className="story-assumption-symbol" aria-hidden="true"><WarningCircle size={33} /><span /><i /></div><h3>{t("확인할 질문")}</h3><p>{t("불확실한 내용은 확인할 질문으로.")}</p><details className="spatial-assumptions"><summary>{t("계산 가정과 제외 범위")}<ArrowDown size={14} /></summary><p>{t("관리자 1명, 현장 결제, 고객의 디자인 자료 제공. 견적 전에 가정을 확인합니다.")}</p><p>{t("제외 범위 · 온라인 결제, 별도 모바일 앱")}</p><p>{t("예시 일단가")} {money(quote.dailyRate)}{t("원")}</p></details></article>
    <article className="story-panel story-dashboard-small story-proposal-card" data-story-reveal="card"><p className="story-mono-label">{t("제안서 초안")}</p><div className="story-document-symbol" aria-hidden="true"><FileText size={29} /><div><i /><i /><i /></div><span><Check size={14} /></span></div><h3>{t("확정은 직접")}</h3><p>{t("검토한 범위와 금액만 고객에게.")}</p><div className="story-card-baseline"><ShieldCheck size={14} />{t("사용자 검토 필요")}</div></article>
  </div>;
}

function SampleFigures({ quote, t }: { quote: Quote; t: Translate }) {
  return <div className="story-sample-columns"><article data-story-reveal="figure" data-story-metric-scene><p className="story-mono-label">{t("예시 작업 항목")}</p><strong><StoryCount value={quote.rows.length} digits={2} /></strong><p className="story-figure-caption">{t("원문에서 정리한 작업 단위")}</p><ul className="story-task-markers" aria-label={t("작업 범위")}>{quote.rows.map((row, index) => <li key={row.title} data-story-task-marker><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span>{t(row.title)}</span></li>)}</ul><div className="story-figure-explanation"><p>{t("예약, 관리자, 반응형과 검수. 선택한 범위의 작업만 견적에 포함합니다.")}</p><span>{t("원문은 그대로")}</span><small>{t("고객의 요청을 다시 확인할 수 있게.")}</small></div></article><article data-story-reveal="figure" data-story-metric-scene><p className="story-mono-label">{t("예상 공수")}</p><strong><StoryCount value={quote.days} /><small>{t("일")}</small></strong><p className="story-figure-caption">{t("항목별 공수를 더한 예시")}</p><div className="story-mini-segments" aria-hidden="true">{Array.from({ length: extendedQuote.days }, (_, index) => <i key={index} data-story-segment className={index < quote.days ? "is-active" : ""} />)}</div><div className="story-figure-explanation"><p>{t("공수는 작업에 필요한 노력의 합입니다. 실제 일정은 자료와 범위를 확인한 뒤 협의합니다.")}</p><span>{t("가정은 드러나게")}</span><small>{t("일정은 자료 제공과 범위 확인 후 협의합니다.")}</small></div></article><article data-story-reveal="figure" data-story-metric-scene><p className="story-mono-label">{t("예시 금액")}</p><strong><StoryCount value={quote.total / 1000000} decimals={1} /><small>M KRW</small></strong><p className="story-figure-caption">{t("부가세 별도 · 실제 견적 아님")}</p><div className="story-mini-rule" aria-hidden="true"><i data-story-meter style={{ width: `${quote.total / extendedQuote.total * 100}%` }} /></div><div className="story-figure-explanation"><p>{t("예상 공수에 예시 일단가를 곱한 금액입니다. 서비스 이용 요금이나 실제 성과가 아닙니다.")}</p><span>{quote.days}{t("일")} × {money(quote.dailyRate)}{t("원")}</span><small>{t("확정 전 사용자 검토가 필요합니다.")}</small></div></article></div>;
}

/** Original, locally calculated product examples. No network calls or persistence. */
export function ReferenceStory({ state, quote, onScopeChange }: StoryProps) {
  const t = useT();
  const metricRef = useStoryMetricEntry(`${quote.rows.length}:${quote.days}:${quote.total}`);
  return <div ref={metricRef} className="reference-story">
    <section id="evidence" tabIndex={-1} className="story-shell story-features" aria-labelledby="evidence-title">
      <SectionTitle id="evidence-title" eyebrow="이어지는 업무" title="고객의 말에서," accent="설명 가능한 제안까지." description="어디서 나온 범위인지, 왜 이만큼 필요한지. 질문과 가정을 함께 남겨 다음 대화를 준비합니다." />
      <div className="story-feature-row" data-story-scene="execution"><div className="story-feature-copy" data-story-reveal="copy"><span className="story-row-number">01</span><h3>{t("작업의 경계를 정리해요.")}</h3><p>{t("고객의 한마디에서 제안서까지.")}<br />{t("원문과 작업 범위를 연결하고, 필요한 공수를 항목별로 살펴봅니다.")}</p></div><ExecutionTimeline quote={quote} t={t} /></div>
      <div className="story-feature-row story-feature-reverse" data-story-scene="review"><ReviewConversation state={state} quote={quote} onScopeChange={onScopeChange} t={t} /><div className="story-feature-copy" data-story-reveal="copy"><span className="story-row-number">02</span><h3>{t("AI가 정리하고,")}<br />{t("결정은 당신이.")}</h3><p>{t("모르는 것은 먼저 물어요.")}<br />{t("범위와 근거를 확인한 뒤 고객과 공유하세요.")}</p></div></div>
      <div className="story-feature-row" data-story-scene="effort"><div className="story-feature-copy" data-story-reveal="copy"><span className="story-row-number">03</span><h3>{t("숫자 뒤의 근거까지,")}<br />{t("놓치지 않도록.")}</h3><p>{t("공수와 근거를 연결해요.")}<br />{t("범위를 바꾸면 작업, 공수, 제안서가 함께 바뀝니다.")}</p><a className="story-text-link" href="#review">{t("견적 근거 보기")}<ArrowUpRight size={16} /></a></div><EffortPrisms quote={quote} t={t} /></div>
    </section>
    <div className="story-brand-scene" data-story-brand-scene><div className="story-brand-stage"><div className="story-brand-plate" data-story-brand-plate><div className="story-brand-plate-copy" data-story-brand-copy><p>FREELANCE OPS</p><p>{t("맥락은 이어지고,")}<br />{t("결정은 선명해집니다.")}</p></div></div><span className="story-brand-mark" data-story-brand-mark aria-hidden="true"><StoryMark /></span></div></div>
    <section className="story-shell story-benefits" aria-labelledby="story-benefits-title"><SectionTitle id="story-benefits-title" eyebrow="근거 있는 결정" title="함께 보이면," accent="더 명확해지니까." description="요구사항과 숫자, 확인할 질문을 한곳에서. 다음 대화에 필요한 근거를 놓치지 않도록." /><BenefitCards quote={quote} t={t} /></section>
    <section id="review" tabIndex={-1} className="story-shell story-dashboard" aria-labelledby="review-title"><SectionTitle id="review-title" eyebrow="프로젝트 한눈에" title="같은 범위로," accent="다음 대화를 준비하세요." description="예약 웹사이트라는 가상의 프로젝트입니다. 위에서 선택한 범위가 아래의 작업과 계산에 그대로 반영됩니다." /><ProposalDashboard quote={quote} t={t} /><p className="story-disclaimer">{t("가상의 문의로 보여드리는 제품 예시입니다. 실제 분석·저장·발송은 실행되지 않습니다.")}</p></section>
    <section className="story-shell story-samples" aria-labelledby="story-samples-title"><EvidenceAtmosphere /><SectionTitle id="story-samples-title" eyebrow="숫자로 보는 예시" title="한 프로젝트의 숫자," accent="숨김없는 계산." description="선택한 작업 범위로 계산한 예시입니다. 고객 수, 매출, 처리 성과를 나타내는 지표가 아닙니다." /><SampleFigures quote={quote} t={t} /><a className="story-text-link" href="#scope-comparison">{t("범위를 바꿔 비교해 보세요")}<ArrowRight size={16} /></a></section>
  </div>;
}
