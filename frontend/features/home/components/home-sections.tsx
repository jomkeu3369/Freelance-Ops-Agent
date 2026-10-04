import { useT } from "../ui-language";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "@phosphor-icons/react";

export function CallToActionSection() {
  const t = useT();
  return (
    <section id="audience" tabIndex={-1} className="final-cta chapter spatial-closing">
      <div className="spatial-closing-brand"><div><Image src="/figma/logo.svg" alt="" width={28} height={28} /><strong>Freelance Ops</strong></div><ArrowRight className="spatial-closing-arrow" aria-hidden="true" weight="bold" /><p>{t("고객 문의를 검토 가능한 요구사항과 근거 있는 견적으로 연결하는 프리랜서 운영 도구")}</p><span>INQUIRY → PROPOSAL</span></div>
      <div className="spatial-closing-action"><p className="section-context">WHAT COMES NEXT</p><h2>{t("다음 고객 문의부터,")}<br />{t("더 명확하게 시작하세요.")}</h2><p>{t("요구사항을 정리하고, 확인할 질문을 찾고, 근거 있는 견적의 첫 초안을 만들어 보세요.")}</p><Link className="primary-button spatial-closing-link" href="/workspace"><span>{t("요구사항 정리 시작하기")}</span><span>{t("업무 공간 열기")}<ArrowRight size={17} /></span></Link><small>{t("초안은 언제든 수정할 수 있으며, 사용자의 확인 없이 확정되지 않습니다.")}</small></div>
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
