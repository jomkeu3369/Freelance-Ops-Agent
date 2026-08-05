"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  FileText,
  Moon,
  Plus,
  ShieldCheck,
  Sparkle,
  Sun,
} from "@phosphor-icons/react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useTheme } from "next-themes";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const confirmedItems = [
  "직원 로그인과 계정 관리",
  "공지사항 작성·수정·검색",
  "파일 첨부와 PostgreSQL 연동",
  "관리자·일반 직원 권한 분리",
];

const requirementGroups = [
  {
    title: "접근과 권한",
    caption: "RBAC와 감사 기록",
    image: "https://picsum.photos/seed/access-workflow/1200/900",
    detail: "관리자와 일반 직원의 행동 범위를 구분하고 민감한 변경에는 감사 기록을 남깁니다.",
  },
  {
    title: "콘텐츠 운영",
    caption: "공지·검색·첨부",
    image: "https://picsum.photos/seed/editorial-system/1200/900",
    detail: "공지사항 CRUD, 검색, 첨부 파일 정책을 하나의 운영 흐름으로 정리합니다.",
  },
  {
    title: "기존 시스템",
    caption: "PostgreSQL 데이터 연동",
    image: "https://picsum.photos/seed/data-architecture/1200/900",
    detail: "기존 데이터 구조를 보존하면서 신규 서비스가 필요한 범위만 계약으로 분리합니다.",
  },
];

const reviews = [
  {
    quote: "고객의 한 문장을 바로 금액으로 바꾸지 않고, 먼저 빠진 조건을 보여줘서 협상이 훨씬 쉬워졌습니다.",
    name: "김도윤",
    role: "제품 개발 프리랜서",
    image: "https://picsum.photos/seed/freelancer-portrait-one/240/240",
  },
  {
    quote: "왜 이 공수가 필요한지 근거가 함께 보여서 견적서를 설명하는 시간이 크게 줄었습니다.",
    name: "박서연",
    role: "웹 서비스 컨설턴트",
    image: "https://picsum.photos/seed/freelancer-portrait-two/240/240",
  },
  {
    quote: "확정된 요구와 AI의 가정을 분리해 보여주는 방식이 실제 계약 전 검토에 특히 유용했습니다.",
    name: "이준호",
    role: "독립 소프트웨어 엔지니어",
    image: "https://picsum.photos/seed/freelancer-portrait-three/240/240",
  },
];

const subscribeToHydration = () => () => undefined;

export default function Home() {
  const pageRef = useRef<HTMLElement>(null);
  const [activeRequirement, setActiveRequirement] = useState(0);
  const [reviewIndex, setReviewIndex] = useState(0);
  const themeMounted = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = themeMounted && resolvedTheme === "dark";

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.from(".nav-shell", { y: -30, opacity: 0, duration: 0.8, ease: "power3.out" });
      gsap.from(".hero-reveal", {
        y: 54,
        opacity: 0,
        duration: 1.05,
        stagger: 0.12,
        ease: "power3.out",
      });

      gsap.to(".scrub-word", {
        opacity: 1,
        stagger: 0.12,
        scrollTrigger: {
          trigger: ".manifesto-copy",
          start: "top 78%",
          end: "bottom 48%",
          scrub: 1,
        },
      });

      gsap.utils.toArray<HTMLElement>(".stack-card").forEach((card, index) => {
        gsap.fromTo(
          card,
          { scale: 0.9, opacity: 0.35, y: 70 },
          {
            scale: 1,
            opacity: 1,
            y: 0,
            ease: "none",
            scrollTrigger: {
              trigger: card,
              start: "top 88%",
              end: "top 42%",
              scrub: true,
            },
          },
        );
        card.style.zIndex = String(index + 1);
      });

      ScrollTrigger.create({
        trigger: ".workflow-section",
        start: "top 110px",
        end: "bottom bottom-=80",
        pin: ".workflow-copy",
        pinSpacing: false,
      });
    },
    { scope: pageRef },
  );

  const nextReview = () => setReviewIndex((current) => (current + 1) % reviews.length);
  const previousReview = () =>
    setReviewIndex((current) => (current - 1 + reviews.length) % reviews.length);

  return (
    <main ref={pageRef} className="site-shell overflow-x-hidden w-full max-w-full">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="nav-shell" aria-label="주요 탐색">
        <a className="brand" href="#top" aria-label="Freelance Ops 홈">
          <span className="brand-mark">FO</span>
          <span>Freelance Ops</span>
        </a>
        <nav className="nav-links" aria-label="페이지 이동">
          <a href="#intake">문의 정리</a>
          <a href="#workflow">진행 방식</a>
          <a href="#stories">사용 경험</a>
        </nav>
        <div className="nav-actions">
          <button
            className="icon-button"
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={isDark ? "화이트 모드로 전환" : "다크 모드로 전환"}
          >
            {isDark ? <Sun size={19} weight="bold" /> : <Moon size={19} weight="bold" />}
          </button>
          <button className="primary-button compact" type="button">
            <Plus size={17} weight="bold" /> 새 문의
          </button>
        </div>
      </header>

      <section id="top" className="hero-section">
        <div className="hero-copy">
          <p className="eyebrow hero-reveal">Freelance operations, clarified</p>
          <h1 className="hero-title hero-reveal max-w-6xl">
            흩어진 문의를,
            <span className="hero-title-line">
              <span className="hero-inline-image" aria-hidden="true" /> 근거 있는 견적으로.
            </span>
          </h1>
          <p className="hero-description hero-reveal">
            고객의 모호한 요청을 검증 가능한 요구사항, 현실적인 공수와 설명할 수 있는 견적으로 바꿉니다.
          </p>
          <div className="hero-actions hero-reveal">
            <a className="primary-button" href="#intake">
              문의 정리 시작하기 <ArrowDown size={18} weight="bold" />
            </a>
            <a className="secondary-button" href="#workflow">
              작업 방식 살펴보기
            </a>
          </div>
        </div>
        <aside className="hero-visual hero-reveal" aria-label="견적 검토 미리보기">
          <div className="hero-visual-image" />
          <div className="floating-sheet">
            <div>
              <span>Recommended</span>
              <strong>8–10주</strong>
            </div>
            <p>근거 12개와 확인 질문 5개를 기반으로 구성된 권장 시나리오</p>
          </div>
        </aside>
      </section>

      <section id="intake" className="intake-section chapter">
        <div className="section-heading">
          <p className="eyebrow">Project Intake</p>
          <h2>고객의 말과 확정된 범위를 한 화면에서 구분합니다.</h2>
          <p>AI가 만든 초안은 그대로 확정되지 않습니다. 근거, 가정과 미해결 질문을 확인한 뒤 다음 단계로 이동합니다.</p>
        </div>

        <div className="intake-grid grid-flow-dense">
          <article className="panel brief-panel card-lift">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">고객 문의 원문</span>
                <h3>사내 직원용 웹 시스템</h3>
              </div>
              <span className="source-label"><FileText size={15} /> brief_0821.pdf</span>
            </div>
            <blockquote>
              “직원 로그인, 관리자 계정 관리와 공지사항이 필요합니다. 기존 PostgreSQL 데이터와 연결하고 파일 첨부와 검색도 가능해야 합니다. 목표 오픈은 10주 후입니다.”
            </blockquote>
            <div className="brief-footer">
              <span><Clock size={16} /> 오늘 10:24에 등록</span>
              <button type="button">원문과 비교</button>
            </div>
          </article>

          <article className="panel analysis-panel card-lift">
            <div className="panel-header">
              <div>
                <span className="panel-kicker ai-label"><Sparkle size={14} weight="fill" /> AI 초안</span>
                <h3>분석 준비 완료</h3>
              </div>
              <span className="confidence">높은 신뢰도</span>
            </div>
            <ul className="confirmed-list">
              {confirmedItems.map((item) => (
                <li key={item}><Check size={16} weight="bold" /> {item}</li>
              ))}
            </ul>
            <button className="full-button" type="button">요구사항 검토하기 <ArrowRight size={17} /></button>
          </article>

          <article className="panel mini-panel card-lift">
            <span className="panel-kicker">확정됨</span>
            <strong className="large-value">4</strong>
            <p>사용자 입력으로 확인된 핵심 기능</p>
          </article>
          <article className="panel mini-panel warning-panel card-lift">
            <span className="panel-kicker">확인 필요</span>
            <strong className="large-value">5</strong>
            <p>권한, 첨부 정책과 기존 DB 범위</p>
          </article>
          <article className="panel mini-panel evidence-panel card-lift">
            <span className="panel-kicker"><ShieldCheck size={15} /> 근거</span>
            <strong className="large-value">12</strong>
            <p>원문, 업무 규칙과 유사 프로젝트</p>
          </article>
        </div>
      </section>

      <section className="manifesto chapter">
        <p className="manifesto-copy" aria-label="감이 아니라 확인된 정보로 범위를 합의하고 근거로 가격을 설명합니다.">
          {"감이 아니라 확인된 정보로 범위를 합의하고 근거로 가격을 설명합니다."
            .split(" ")
            .map((word) => <span className="scrub-word" key={word}>{word} </span>)}
        </p>
      </section>

      <section className="requirements chapter" aria-labelledby="requirements-title">
        <div className="section-heading compact-heading">
          <p className="eyebrow">Requirement map</p>
          <h2 id="requirements-title">요구사항을 업무 언어로 다시 묶습니다.</h2>
        </div>
        <div className="horizontal-accordion">
          {requirementGroups.map((group, index) => (
            <button
              type="button"
              key={group.title}
              className={`accordion-slice ${activeRequirement === index ? "active" : ""}`}
              onMouseEnter={() => setActiveRequirement(index)}
              onFocus={() => setActiveRequirement(index)}
              onClick={() => setActiveRequirement(index)}
              style={{ backgroundImage: `linear-gradient(180deg, transparent, rgba(5, 9, 14, .88)), url(${group.image})` }}
              aria-expanded={activeRequirement === index}
            >
              <span className="accordion-index">0{index + 1}</span>
              <span className="accordion-content">
                <strong>{group.title}</strong>
                <small>{group.caption}</small>
                <p>{group.detail}</p>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section id="workflow" className="workflow-section chapter">
        <div className="workflow-copy">
          <p className="eyebrow">Guided workflow</p>
          <h2>질문에서 제안서까지, 상태를 잃지 않고 이어집니다.</h2>
          <p>각 단계의 결과는 근거와 함께 저장됩니다. 사용자가 확정하지 않은 AI의 판단은 다음 단계의 사실로 취급되지 않습니다.</p>
        </div>
        <div className="workflow-cards">
          {[
            ["요구사항 정리", "문의 원문에서 기능, 제약, 일정과 예산 신호를 분리합니다.", "확인 질문 5개"],
            ["근거 수집", "내부 프로젝트와 허용된 공식 자료를 찾아 주장별 출처를 연결합니다.", "Evidence 12개"],
            ["견적 설계", "Lean, Recommended, Expanded 세 가지 범위와 공수 시나리오를 만듭니다.", "3개 시나리오"],
            ["검증과 승인", "계산, 가정, 충돌과 누락을 확인한 후 사용자 승인 단계로 이동합니다.", "검증 통과"],
          ].map(([title, body, result], index) => (
            <article className="stack-card" key={title}>
              <span className="stack-number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
              <strong>{result}</strong>
            </article>
          ))}
        </div>
      </section>

      <section id="stories" className="stories chapter">
        <div className="story-card">
          <div
            className="story-portrait"
            style={{ backgroundImage: `url(${reviews[reviewIndex].image})` }}
            aria-hidden="true"
          />
          <div className="story-copy">
            <blockquote>“{reviews[reviewIndex].quote}”</blockquote>
            <div>
              <strong>{reviews[reviewIndex].name}</strong>
              <span>{reviews[reviewIndex].role}</span>
            </div>
          </div>
          <div className="story-controls">
            <button type="button" onClick={previousReview} aria-label="이전 사용 경험"><ArrowLeft size={20} /></button>
            <span>{reviewIndex + 1} / {reviews.length}</span>
            <button type="button" onClick={nextReview} aria-label="다음 사용 경험"><ArrowRight size={20} /></button>
          </div>
        </div>
      </section>

      <section className="final-cta chapter">
        <p className="eyebrow">A clearer next project</p>
        <h2>다음 견적은 감이 아니라,<br />확인된 근거에서 시작하세요.</h2>
        <div className="hero-actions">
          <button className="primary-button inverted" type="button">첫 문의 정리하기 <ArrowRight size={18} /></button>
          <button className="secondary-button inverted-secondary" type="button">데모 다시 보기</button>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark">FO</span><span>Freelance Ops</span></div>
        <p>근거 있는 프리랜서 견적 운영 시스템</p>
        <div><a href="#intake">문의 정리</a><a href="#workflow">진행 방식</a><a href="#top">맨 위로</a></div>
      </footer>
    </main>
  );
}
