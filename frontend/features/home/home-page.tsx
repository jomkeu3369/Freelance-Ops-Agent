"use client";

import "@/app/product-demo.css";

import { HomeHeader } from "./components/home-header";
import { HeroSection, CallToActionSection, HomeFooter } from "./components/home-sections";
import { WorkflowSection } from "./components/product-experience";
import { useHomeAnimation } from "./use-home-animation";

// 페이지 구성 순서입니다. 각 영역의 문구와 상호작용은 components에서 수정합니다.
export default function HomePage() {
  const pageRef = useHomeAnimation();

  return (
    <div ref={pageRef} className="site-shell figma-home overflow-x-hidden w-full max-w-full">
      <HomeHeader />
      <main id="main-content" tabIndex={-1}>
        <HeroSection />
        <WorkflowSection />
        <CallToActionSection />
      </main>
      <HomeFooter />
    </div>
  );
}
