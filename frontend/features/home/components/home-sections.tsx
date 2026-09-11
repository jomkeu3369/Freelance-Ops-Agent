import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowRight, Check, FileText } from "@phosphor-icons/react";

export function HeroSection() {
  return (
    <section id="top" className="hero-section">
      <div className="hero-copy">
        <p className="hero-context hero-reveal">모호한 고객 문의를, 근거 있는 견적으로.</p>
        <h1 className="hero-title hero-reveal">
          Freelance Ops
        </h1>
        <p className="hero-description hero-reveal">
          고객 문의에서 요구사항과 불확실성을 정리하고,<br />확인 질문·WBS·견적·제안서로 연결합니다.
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
        <Image src="/figma/dashboard-preview.png" alt="프로젝트 현황 예시: 신규 문의부터 결과 회고까지 여섯 단계로 관리하는 대시보드" width={1250} height={725} priority sizes="(max-width: 820px) 100vw, 1200px" />
      </div>
    </section>
  );
}

export function ProductSection() {
  return (
    <>
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
            ["AI 답변도 그대로 믿을 수 없습니다", "출처, 계산식과 가정이 보이지 않으면 빠른 답변도 실제 거래에는 사용하기 어렵습니다."]
          ].map(([title, body]) => (
            <article className="problem-card card-lift" key={title}>
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
            .map((word, index) => (
              <span className="scrub-word" key={`${word}-${index}`}>{word} </span>
            ))}
        </p>
      </section>
    </>
  );
}

export function DeliverablesSection() {
  return (
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
          <ul>
            <li>확정된 요구사항</li>
            <li>확인 필요</li>
            <li>제외 범위</li>
          </ul>
        </article>
        <article className="deliverable-card featured card-lift">
          <span className="scenario recommended">추천안</span>
          <h3>범위별 견적안</h3>
          <p>필수, 권장, 확장 범위의 공수·금액·가정을 한 화면에서 비교합니다.</p>
          <div className="scenario-row">
            <span>필수</span>
            <span>권장</span>
            <span>확장</span>
          </div>
        </article>
        <article className="deliverable-card card-lift">
          <Check size={27} />
          <h3>고객 전달용 제안서</h3>
          <p>범위, 금액, 일정, 지급 조건, 가정과 제외 사항을 한 문서로 정리합니다.</p>
          <ul>
            <li>미리보기</li>
            <li>승인 요청</li>
            <li>결정 기록</li>
          </ul>
        </article>
      </div>
    </section>
  );
}

export function AudienceSection() {
  return (
    <section id="audience" className="audience-section chapter">
      <div className="section-heading wide-heading">
        <p className="section-context">첫 번째 실제 업무 범위</p>
        <h2>먼저, 한국 소프트웨어 개발<br />프리랜서의 견적 업무부터.</h2>
        <p>웹·앱·자동화 프로젝트의 요구사항 정리, 작업 범위 산정과 고객 제안 흐름을 우선 검증합니다.</p>
      </div>
      <div className="role-marquee" aria-label="우선 지원 직무">
        <div>
          {["프론트엔드", "백엔드", "풀스택", "모바일", "업무 자동화"].map((role) => (
            <span key={role}>{role}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CallToActionSection() {
  return (
    <section className="final-cta chapter">
      <h2>다음 고객 문의부터,<br />더 명확하게 시작하세요.</h2>
      <p>요구사항을 정리하고, 확인할 질문을 찾고, 근거 있는 견적의 첫 초안을 만들어 보세요.</p>
      <Link className="primary-button inverted" href="/workspace">
        요구사항 정리 시작하기 <ArrowRight size={18} />
      </Link>
      <small>초안은 언제든 수정할 수 있으며, 사용자의 확인 없이 확정되지 않습니다.</small>
    </section>
  );
}

export function HomeFooter() {
  return (
    <footer>
      <div>
        <strong>Freelance Ops</strong>
        <p>고객 문의를 검토 가능한 요구사항과 근거 있는 견적으로 연결하는 프리랜서 운영 도구</p>
      </div>
      <nav>
        <a href="#product">제품 소개</a>
        <a href="#workflow">작동 방식</a>
        <a href="#evidence">검증 원칙</a>
        <Link href="/workspace">로그인</Link>
      </nav>
      <span>© 2026 Freelance Ops Agent</span>
    </footer>
  );
}
