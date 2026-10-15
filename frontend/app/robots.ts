import type { MetadataRoute } from "next";
import { getSiteOrigin, isPreviewDeployment } from "./lib/site-config.mjs";

export default function robots(): MetadataRoute.Robots {
  return {
    // 검색 로봇이 페이지의 noindex 지시를 읽을 수 있도록 접근은 허용한다.
    // 검색 등록 정책이며 접근 권한을 제어하는 수단은 아니다.
    rules: { userAgent: "*", allow: "/" },
    ...(!isPreviewDeployment() ? { sitemap: new URL("/sitemap.xml", getSiteOrigin()).href } : {})
  };
}
