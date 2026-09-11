"use client";

import { HomeHeader } from "./components/home-header";
import { HeroSection, ProductSection, DeliverablesSection, AudienceSection, CallToActionSection, HomeFooter } from "./components/home-sections";
import { WorkflowSection } from "./components/workflow-section";
import { EvidenceSection } from "./components/evidence-section";
import { OutcomeSection } from "./components/outcome-section";
import { useHomeAnimation } from "./use-home-animation";

// 페이지 구성 순서입니다. 각 영역의 문구와 상호작용은 components에서 수정합니다.
export default function HomePage() {
  const pageRef = useHomeAnimation();

  return (
    <main id="main-content" ref={pageRef} className="site-shell figma-home overflow-x-hidden w-full max-w-full">
      <HomeHeader />
      <HeroSection />
      <ProductSection />
      <WorkflowSection />
      <DeliverablesSection />
      <EvidenceSection />
      <OutcomeSection />
      <AudienceSection />
      <CallToActionSection />
      <HomeFooter />
    </main>
  );
}
