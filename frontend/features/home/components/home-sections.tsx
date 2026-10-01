import { useT } from "../../../app/lib/ui-language";
import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowRight, Check } from "@phosphor-icons/react";

export function HeroSection() {
  const t = useT();
  return (
    <section id="top" className="hero-section">
      <div className="hero-copy">
        <div className="hero-eyebrow hero-reveal"><span /> FROM INQUIRY TO PROPOSAL</div>
        <p className="hero-context hero-reveal">{t("모호한 고객 문의를, 근거 있는 견적으로.")}</p>
        <h1 className="hero-title hero-reveal">
          Freelance <span>Ops</span><span className="hero-title-period">.</span>
        </h1>
        <p className="hero-description hero-reveal">
          {t("고객 문의에서 요구사항과 불확실성을 정리하고,")}<br />{t("확인 질문·WBS·견적·제안서로 연결합니다.")}</p>
        <div className="hero-actions hero-reveal">
          <Link className="primary-button" href="/workspace">
            {t("요구사항 정리 시작하기")}<ArrowRight size={18} weight="bold" />
          </Link>
          <a className="secondary-button" href="#workflow">
            {t("작동 방식 보기")}<ArrowDown size={17} />
          </a>
        </div>
        <p className="hero-note hero-reveal">{t("AI 초안은 사용자가 검토하고 확정합니다.")}</p>
      </div>
      <div className="hero-stage">
        <div className="hero-window-bar"><span className="window-dots" aria-hidden="true"><i /><i /><i /></span><span>{t("Freelance Ops · 프로젝트 한눈에 보기")}</span><span className="preview-badge">{t("제품 예시")}</span></div>
        <Image src="/figma/dashboard-preview.png" alt={t("프로젝트 현황 예시: 신규 문의부터 결과 회고까지 여섯 단계로 관리하는 대시보드")} width={1250} height={725} priority sizes="(max-width: 820px) 100vw, 1200px" />
        <div className="hero-float hero-inquiry"><span className="float-label">{t("01 / 고객의 한마디")}</span><p>{t("“예약 가능한 웹사이트,")}<br />{t("얼마면 만들 수 있나요?”")}</p><span className="float-tag">{t("아직 모호한 범위")}</span></div>
        <div className="hero-float hero-result"><span className="float-label">{t("02 / 검토할 수 있는 초안")}</span><strong><Check size={18} /> {t("요구사항과 근거 연결")}</strong><div className="result-lines" aria-hidden="true"><i /><i /><i /></div><span className="float-tag">{t("최종 결정은 사용자에게")}</span></div>
      </div>
      <div className="hero-bottom-note"><span>{t("문의")}</span><ArrowRight size={14} /><span>{t("요구사항")}</span><ArrowRight size={14} /><span>{t("견적")}</span><ArrowRight size={14} /><span>{t("제안")}</span></div>
    </section>
  );
}

export function CallToActionSection() {
  const t = useT();
  return (
    <section id="audience" tabIndex={-1} className="final-cta chapter">
      <p className="section-context">{t("한국 소프트웨어 개발 프리랜서를 위한 첫 시작")}</p>
      <h2>{t("다음 고객 문의부터,")}<br />{t("더 명확하게 시작하세요.")}</h2>
      <p>{t("요구사항을 정리하고, 확인할 질문을 찾고, 근거 있는 견적의 첫 초안을 만들어 보세요.")}</p>
      <p className="cta-audience">{t("웹·앱·업무 자동화 프로젝트의 견적부터 시작합니다.")}</p>
      <Link className="primary-button inverted" href="/workspace">
        {t("요구사항 정리 시작하기")}<ArrowRight size={18} />
      </Link>
      <small>{t("초안은 언제든 수정할 수 있으며, 사용자의 확인 없이 확정되지 않습니다.")}</small>
    </section>
  );
}

export function HomeFooter() {
  const t = useT();
  return (
    <footer>
      <div>
        <strong>Freelance Ops</strong>
        <p>{t("고객 문의를 검토 가능한 요구사항과 근거 있는 견적으로 연결하는 프리랜서 운영 도구")}</p>
      </div>
      <nav>
        <a href="#product">{t("제품 소개")}</a>
        <a href="#workflow">{t("작동 방식")}</a>
        <a href="#evidence">{t("검증 원칙")}</a>
        <Link href="/workspace">{t("로그인")}</Link>
      </nav>
      <span>© 2026 Freelance Ops Agent</span>
    </footer>
  );
}
