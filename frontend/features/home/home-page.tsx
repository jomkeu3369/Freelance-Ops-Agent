"use client";

import "@/app/product-demo.css";
import "@/app/reference-story.css";

import { HomeHeader } from "./components/home-header";
import { CallToActionSection, HomeFooter } from "./components/home-sections";
import { WorkflowSection } from "./components/product-experience";
import { useHomeAnimation } from "./use-home-animation";

// 페이지 구성 순서입니다. 각 영역의 문구와 상호작용은 components에서 수정합니다.
export default function HomePage() {
  const pageRef = useHomeAnimation();

  return (
    <div ref={pageRef} className="site-shell figma-home spatial-site overflow-x-hidden w-full max-w-full">
      <HomeHeader />
      <main id="main-content" tabIndex={-1}>
        <span id="top" className="spatial-top-anchor" tabIndex={-1} />
        <div className="spatial-world">
          <WorkflowSection />
          <CallToActionSection />
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
