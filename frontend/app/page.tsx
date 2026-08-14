"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Calculator,
  Check,
  ChatCenteredText,
  FileText,
  Moon,
  Question,
  ShieldCheck,
  Sun,
  TreeStructure,
} from "@phosphor-icons/react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useTheme } from "next-themes";
import { LiveWorkflow, snapshotFromEvents } from "./components/live-workflow";
import type { WorkflowEvent } from "./lib/api";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const workflowSteps = [
  ["문의 등록", "고객의 메시지와 문서를 하나의 프로젝트에 모읍니다."],
  ["요구사항 정리", "목표, 기능, 일정, 예산, 제약과 빠진 정보를 구분합니다."],
  ["확인 질문", "견적 전에 반드시 확인해야 할 질문을 우선순위로 제안합니다."],
  ["WBS·견적 작성", "작업별 공수와 금액을 계산하고 세 가지 범위를 비교합니다."],
  ["검토·제안", "프리랜서가 초안을 확정한 뒤 고객에게 전달합니다."],
] as const;

const workflowVisuals = [
  { inputs: ["고객 메시지", "참고 문서"], process: "프로젝트", outputs: ["원문 보존", "자료 연결"], icon: ChatCenteredText },
  { inputs: ["목표·기능", "일정·제약"], process: "구조화", outputs: ["확정 정보", "빠진 정보"], icon: TreeStructure },
  { inputs: ["누락 정보", "조건 충돌"], process: "사용자 확인", outputs: ["답변 반영", "범위 확정"], icon: Question },
  { inputs: ["작업 항목", "단가·가정"], process: "결정적 계산", outputs: ["핵심안", "권장안", "확장안"], icon: Calculator },
  { inputs: ["범위·금액", "근거·가정"], process: "최종 검토", outputs: ["승인", "수정 요청", "거절"], icon: Check },
] as const;

function WorkflowStepVisual({ index }: { index: number }) {
  const visual = workflowVisuals[index];
  const Icon = visual.icon;
  return (
    <span className={`step-visual step-visual-${index + 1}`} aria-hidden="true">
      <span className="step-visual-nodes inputs">{visual.inputs.map((label) => <span key={label}>{label}</span>)}</span>
      <span className="step-visual-core"><i /><Icon size={28} weight="duotone" /><b>{visual.process}</b></span>
      <span className="step-visual-nodes outputs">{visual.outputs.map((label) => <span key={label}>{label}</span>)}</span>
      <i className="step-visual-packet packet-one" /><i className="step-visual-packet packet-two" />
    </span>
  );
}

const previewEvents: WorkflowEvent[] = [
  { eventId: 1, runId: "preview", type: "run.started", occurredAt: "", data: {} },
  { eventId: 2, runId: "preview", type: "tool.started", occurredAt: "", data: {} },
  { eventId: 3, runId: "preview", type: "requirement.updated", occurredAt: "", data: {} },
  { eventId: 4, runId: "preview", type: "evidence.added", occurredAt: "", data: {} },
  { eventId: 5, runId: "preview", type: "quotation.draft.created", occurredAt: "", data: {} },
  { eventId: 6, runId: "preview", type: "approval.requested", occurredAt: "", data: {} },
] as const;

const outcomes = [
  {
    title: "견적 확정",
    metric: "예상 18일",
    body: "사용자가 승인한 작업 범위와 공수만 기준선으로 보존합니다.",
  },
  {
    title: "실제 결과 기록",
    metric: "실제 21일",
    body: "범위 변경, 실제 공수와 원가를 프로젝트 종료 후 기록합니다.",
  },
  {
    title: "다음 견적 참고",
    metric: "+3일 차이",
    body: "승인된 과거 사례를 검색 근거로 사용하되 자동 학습으로 과장하지 않습니다.",
  },
] as const;

const evidenceExamples = [
  {
    title: "포트폴리오 관리 기능",
    effort: "5–7일",
    rate: "Backend 단가표",
    calculation: "6일 × 일 단가 + 위험 buffer",
    assumption: "이미지 최적화는 기본 수준",
    sources: [["유사 완료 프로젝트", "승인된 프로젝트 2건의 실제 공수 범위"], ["사용자 단가표", "Backend 작업 · 현재 적용 중"], ["명시된 가정", "고객 확인 전에는 사실로 확정하지 않습니다."]],
  },
  {
    title: "관리자 콘텐츠 편집",
    effort: "3–4일",
    rate: "Full-stack 단가표",
    calculation: "3.5일 × 일 단가",
    assumption: "역할은 관리자 1종으로 제한",
    sources: [["요구사항 원문", "관리자가 프로젝트를 직접 수정해야 함"], ["사용자 단가표", "Full-stack 작업 · 현재 적용 중"], ["확인 질문", "세부 권한 분리가 필요한지 고객 확인 필요"]],
  },
  {
    title: "반응형 화면 검수",
    effort: "1–2일",
    rate: "Frontend 단가표",
    calculation: "1.5일 × 일 단가",
    assumption: "지원 범위는 390px 이상",
    sources: [["완료 기준", "모바일·태블릿·데스크톱 주요 화면 검수"], ["사용자 단가표", "Frontend 작업 · 현재 적용 중"], ["명시된 가정", "별도 네이티브 앱 검수는 제외"]],
  },
] as const;

const subscribeToHydration = () => () => undefined;

export default function Home() {
  const pageRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [outcomeIndex, setOutcomeIndex] = useState(0);
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const themeMounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = themeMounted && resolvedTheme === "dark";

  useEffect(() => {
    const timer = window.setInterval(
      () => setPreviewIndex((current) => (current + 1) % previewEvents.length),
      1500,
    );
    return () => window.clearInterval(timer);
  }, []);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(".nav-shell", { y: -24, opacity: 0, duration: 0.75, ease: "power3.out" });
      gsap.from(".hero-reveal", {
        y: 50,
        opacity: 0,
        duration: 1,
        stagger: 0.11,
        ease: "power3.out",
      });
      gsap.to(".scrub-word", {
        opacity: 1,
        stagger: 0.1,
        scrollTrigger: {
          trigger: ".manifesto-copy",
          start: "top 82%",
          end: "bottom 48%",
          scrub: 1,
        },
      });
      gsap.utils.toArray<HTMLElement>(".scale-fade").forEach((element) => {
        gsap.fromTo(
          element,
          { scale: 0.88, opacity: 0.25 },
          {
            scale: 1,
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: element,
              start: "top 92%",
              end: "top 46%",
              scrub: true,
            },
          },
        );
      });
    },
    { scope: pageRef },
  );

  const previewSnapshot = snapshotFromEvents(previewEvents.slice(0, previewIndex + 1), "PREVIEW");

  return (
    <main id="main-content" ref={pageRef} className="site-shell overflow-x-hidden w-full max-w-full">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="nav-shell" aria-label="주요 탐색">
        <Link className="brand" href="#top" aria-label="Freelance Ops 홈">
          <span className="brand-wordmark">Freelance Ops</span>
        </Link>
        <nav className="nav-links" aria-label="페이지 이동">
          <a href="#product">제품 소개</a>
          <a href="#workflow">작동 방식</a>
          <a href="#evidence">검증 원칙</a>
          <a href="#audience">대상 사용자</a>
        </nav>
        <div className="nav-actions">
          <button
            className="icon-button"
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
          >
            {isDark ? <Sun size={19} weight="bold" /> : <Moon size={19} weight="bold" />}
          </button>
          <Link className="text-link" href="/workspace">로그인</Link>
          <Link className="primary-button compact" href="/workspace">요구사항 정리 시작하기</Link>
        </div>
      </header>

      <section id="top" className="hero-section">
        <div className="hero-copy">
          <p className="hero-context hero-reveal">한국 소프트웨어 개발 프리랜서를 위한 운영 도구</p>
          <h1 className="hero-title hero-reveal">
            모호한 고객 문의를,<br /><span>근거 있는 견적으로.</span>
          </h1>
          <p className="hero-description hero-reveal">
            고객 문의에서 요구사항과 불확실성을 정리하고, 확인 질문·WBS·견적·제안서로 연결합니다.
          </p>
          <div className="hero-actions hero-reveal">
            <Link className="primary-button" href="/workspace">
              요구사항 정리 시작하기 <ArrowRight size={18} weight="bold" />
            </Link>
            <a className="secondary-button" href="#workflow">
              작동 방식 보기 <ArrowDown size={17} />
            </a>
          </div>
          <p className="hero-note hero-reveal">AI 초안은 사용자가 검토하고 확정합니다.</p>
        </div>
        <div className="hero-stage hero-reveal">
          <div className="orbit" aria-hidden="true"><i /><i /></div>
          <LiveWorkflow snapshot={previewSnapshot} preview />
        </div>
      </section>

      <section id="product" className="chapter problem-section">
        <div className="section-heading wide-heading">
          <p className="section-context">견적 전 판단해야 할 것</p>
          <h2>견적이 어려운 이유는<br />가격표가 없어서가 아닙니다.</h2>
          <p>고객의 말 속에서 범위, 일정, 위험과 빠진 정보를 동시에 판단해야 하기 때문입니다.</p>
        </div>
        <div className="bento-grid problem-grid">
          {[
            ["요구사항이 불완전합니다", "‘반응형으로 만들어 주세요’라는 한 문장만으로는 화면 수, 관리자 기능과 운영 범위를 알 수 없습니다."],
            ["견적의 근거가 흩어져 있습니다", "과거 프로젝트, 단가표, 작업 경험과 외부 자료를 매번 따로 찾아야 합니다."],
            ["AI 답변도 그대로 믿을 수 없습니다", "출처, 계산식과 가정이 보이지 않으면 빠른 답변도 실제 거래에는 사용하기 어렵습니다."],
          ].map(([title, body]) => (
            <article className="problem-card card-lift" key={title}>
              <span className="problem-trace" aria-hidden="true" />
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="manifesto chapter">
        <p className="manifesto-copy" aria-label="감이 아니라 확인된 정보로 범위를 합의하고 근거로 가격을 설명합니다.">
          {"감이 아니라 확인된 정보로 범위를 합의하고 근거로 가격을 설명합니다."
            .split(" ")
            .map((word, index) => <span className="scrub-word" key={`${word}-${index}`}>{word} </span>)}
        </p>
      </section>

      <section id="workflow" className="chapter workflow-chapter">
        <div className="section-heading">
          <p className="section-context">문의에서 제안까지</p>
          <h2>한 번의 문의가,<br />검토 가능한 제안서가 됩니다.</h2>
        </div>
        <div className="horizontal-accordion" role="list">
          {workflowSteps.map(([title, body], index) => (
            <button
              type="button"
              key={title}
              className={`accordion-slice ${activeStep === index ? "active" : ""}`}
              onMouseEnter={() => setActiveStep(index)}
              onFocus={() => setActiveStep(index)}
              onClick={() => setActiveStep(index)}
              aria-expanded={activeStep === index}
            >
              <span className="accordion-index">{index + 1}</span>
              {activeStep === index && <WorkflowStepVisual index={index} />}
              <span className="accordion-content">
                <strong>{title}</strong>
                <p>{body}</p>
              </span>
            </button>
          ))}
        </div>
        <p className="workflow-note"><ShieldCheck size={19} /> 중요한 단계마다 사용자의 확인을 기다립니다.</p>
      </section>

      <section className="chapter deliverables-section">
        <div className="section-heading wide-heading">
          <p className="section-context">대화가 아닌 실제 산출물</p>
          <h2>실제 업무에 사용할<br />결과를 만듭니다.</h2>
        </div>
        <div className="bento-grid deliverable-grid">
          <article className="deliverable-card card-lift">
            <FileText size={27} />
            <h3>요구사항 명세</h3>
            <p>기능, 제약, 일정, 예산, 누락 정보와 확인 질문을 구조화합니다.</p>
            <ul><li>확정된 요구사항</li><li>확인 필요</li><li>제외 범위</li></ul>
          </article>
          <article className="deliverable-card featured card-lift">
            <span className="scenario recommended">Recommended</span>
            <h3>범위별 견적안</h3>
            <p>필수, 권장, 확장 범위의 공수·금액·가정을 한 화면에서 비교합니다.</p>
            <div className="scenario-row"><span>Lean</span><span>Recommended</span><span>Expanded</span></div>
          </article>
          <article className="deliverable-card card-lift">
            <Check size={27} />
            <h3>고객 전달용 제안서</h3>
            <p>범위, 금액, 일정, 지급 조건, 가정과 제외 사항을 한 문서로 정리합니다.</p>
            <ul><li>미리보기</li><li>승인 요청</li><li>결정 기록</li></ul>
          </article>
        </div>
      </section>

      <section id="evidence" className="chapter evidence-section">
        <div className="evidence-copy">
          <p className="section-context">근거가 먼저 보이는 화면</p>
          <h2>빠른 답변보다,<br />설명 가능한 결과를 우선합니다.</h2>
          <p>견적에 사용한 자료, 반영한 수치, 계산식과 확인되지 않은 가정을 함께 보여줍니다.</p>
        </div>
        <div className="bento-grid evidence-grid scale-fade">
          <article className="quote-item-preview">
            <div className="preview-toolbar"><span>견적 항목 · 제품 예시</span><strong>사용자 확인 필요</strong></div>
            <div className="evidence-item-list" role="listbox" aria-label="견적 항목 선택">
              {evidenceExamples.map((item, index) => <button type="button" role="option" aria-selected={index === evidenceIndex} key={item.title} onClick={() => setEvidenceIndex(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong><small>{item.effort}</small></button>)}
            </div>
            <dl>
              <div><dt>예상 공수</dt><dd>{evidenceExamples[evidenceIndex].effort}</dd></div>
              <div><dt>적용 단가</dt><dd>{evidenceExamples[evidenceIndex].rate}</dd></div>
              <div><dt>계산</dt><dd>{evidenceExamples[evidenceIndex].calculation}</dd></div>
              <div><dt>가정</dt><dd>{evidenceExamples[evidenceIndex].assumption}</dd></div>
            </dl>
          </article>
          <aside className="evidence-drawer" aria-live="polite">
            <span className="drawer-handle" />
            <h3>{evidenceExamples[evidenceIndex].title}<br />연결 근거</h3>
            {evidenceExamples[evidenceIndex].sources.map(([title, body]) => <div key={title}><strong>{title}</strong><p>{body}</p></div>)}
          </aside>
        </div>
      </section>

      <section className="chapter outcome-section">
        <div className="outcome-orbit scale-fade" aria-hidden="true" />
        <div className="outcome-copy">
          <p className="section-context">완료 결과를 다음 판단으로</p>
          <h2>끝난 프로젝트가,<br />다음 견적의 근거가 됩니다.</h2>
          <p>AI가 스스로 학습한다는 의미가 아니라, 사용자가 승인한 실제 결과를 검색 근거로 재사용합니다.</p>
        </div>
        <div className="outcome-carousel" aria-live="polite">
          <div className="outcome-card">
            <span>예시 기록</span>
            <h3>{outcomes[outcomeIndex].title}</h3>
            <strong>{outcomes[outcomeIndex].metric}</strong>
            <p>{outcomes[outcomeIndex].body}</p>
          </div>
          <div className="outcome-controls">
            {outcomes.map((outcome, index) => (
              <button
                key={outcome.title}
                type="button"
                className={index === outcomeIndex ? "active" : ""}
                onClick={() => setOutcomeIndex(index)}
                aria-label={`${outcome.title} 보기`}
              />
            ))}
          </div>
        </div>
      </section>

      <section id="audience" className="audience-section chapter">
        <div className="section-heading wide-heading">
          <p className="section-context">첫 번째 실제 업무 범위</p>
          <h2>먼저, 한국 소프트웨어 개발<br />프리랜서의 견적 업무부터.</h2>
          <p>웹·앱·자동화 프로젝트의 요구사항 정리, 작업 범위 산정과 고객 제안 흐름을 우선 검증합니다.</p>
        </div>
        <div className="role-marquee" aria-label="우선 지원 직무">
          <div>{["Frontend", "Backend", "Full-stack", "Mobile", "Automation", "Frontend", "Backend", "Full-stack", "Mobile", "Automation"].map((role, index) => <span key={`${role}-${index}`}>{role}</span>)}</div>
        </div>
      </section>

      <section className="final-cta chapter">
        <div className="cta-light" aria-hidden="true" />
        <h2>다음 고객 문의부터,<br />더 명확하게 시작하세요.</h2>
        <p>요구사항을 정리하고, 확인할 질문을 찾고, 근거 있는 견적의 첫 초안을 만들어 보세요.</p>
        <Link className="primary-button inverted" href="/workspace">요구사항 정리 시작하기 <ArrowRight size={18} /></Link>
        <small>초안은 언제든 수정할 수 있으며, 사용자의 확인 없이 확정되지 않습니다.</small>
      </section>

      <footer>
        <div><strong>Freelance Ops</strong><p>고객 문의를 검토 가능한 요구사항과 근거 있는 견적으로 연결하는 프리랜서 운영 도구</p></div>
        <nav><a href="#product">제품 소개</a><a href="#workflow">작동 방식</a><a href="#evidence">검증 원칙</a><Link href="/workspace">로그인</Link></nav>
        <span>© 2026 Freelance Ops Agent</span>
      </footer>
    </main>
  );
}
