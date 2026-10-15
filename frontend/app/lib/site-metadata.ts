import type { Metadata } from "next";
import { getSiteOrigin, isPreviewDeployment } from "./site-config.mjs";
import { defaultSiteTitle } from "./site-copy.mjs";

export const siteOrigin = getSiteOrigin();
export const privateMetadata: Metadata = { robots: { index: false, follow: false } };
const socialImage = { url: "/og.png", width: 1731, height: 909, alt: "Freelance Ops 견적 업무 화면" };

// canonical과 og:url은 루트 레이아웃이 아닌 각 공개 페이지에서 지정한다.
export const rootMetadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: defaultSiteTitle,
  description: "모호한 고객 문의를 검증 가능한 요구사항과 근거 있는 견적으로 전환하는 프리랜서 업무 도구입니다.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  ...(isPreviewDeployment() ? privateMetadata : {}),
  openGraph: {
    title: defaultSiteTitle,
    type: "website",
    locale: "ko_KR",
    siteName: "Freelance Ops",
    images: [socialImage]
  },
  twitter: { card: "summary_large_image", title: defaultSiteTitle, images: ["/og.png"] }
};

export function publicPageMetadata(path: "/" | "/notices", title: string, description: string): Metadata {
  const url = path === "/" ? siteOrigin : new URL(path, siteOrigin).href;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      locale: "ko_KR",
      siteName: "Freelance Ops",
      images: [socialImage]
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] }
  };
}
