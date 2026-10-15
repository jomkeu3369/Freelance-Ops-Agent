import type { MetadataRoute } from "next";
import { getSiteOrigin, isPreviewDeployment, publicPagePaths } from "./lib/site-config.mjs";

export default function sitemap(): MetadataRoute.Sitemap {
  // 공개 정적 주소만 등록하며 프로젝트·사용자·제안서 토큰·API 데이터는 열거하지 않는다.
  if (isPreviewDeployment()) return [];
  const origin = getSiteOrigin();
  return publicPagePaths.map((path) => ({ url: path === "/" ? origin : new URL(path, origin).href }));
}
