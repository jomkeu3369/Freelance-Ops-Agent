"use client";

import "@/app/product-demo.css";
import "@/app/reference-story.css";
import "@/app/scene-motion.css";
import "@fontsource-variable/noto-sans-kr";
import "@/app/landing-readability.css";
import "@/app/pointer-depth.css";
import "@/app/inquiry-motion.css";
import "@/app/webgl-scene.css";
import "@/app/workflow-depth.css";
import "@/app/workflow-unfold.css";

import { LocaleProvider } from "./ui-language";

import { HomeHeader } from "./components/home-header";
import { CallToActionSection, HomeFooter } from "./components/home-sections";
import { WorkflowSection } from "./components/product-experience";
import { StoryMark } from "./components/reference-story";
import { useHomeAnimation } from "./use-home-animation";
import { usePointerDepth } from "./use-pointer-depth";

// 페이지 구성 순서입니다. 각 영역의 문구와 상호작용은 components에서 수정합니다.
export default function HomePage() {
  return <LocaleProvider><LandingPage /></LocaleProvider>;
}

function LandingPage() {
  const pageRef = useHomeAnimation();
  usePointerDepth(pageRef);

  return (
    <div ref={pageRef} className="site-shell figma-home spatial-site w-full max-w-full">
      <div className="spatial-intro" data-story-intro aria-hidden="true"><span className="spatial-intro-shell" /><span className="spatial-intro-mark"><StoryMark /></span></div>
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
