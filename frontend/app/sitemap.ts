import type { MetadataRoute } from "next";
import { getSiteOrigin, isPreviewDeployment, publicPagePaths } from "./lib/site-config.mjs";

export default function sitemap(): MetadataRoute.Sitemap {
  // Deliberately static: never enumerate projects, users, proposal tokens, or API data.
  if (isPreviewDeployment()) return [];
  const origin = getSiteOrigin();
  return publicPagePaths.map(path => ({ url: path === "/" ? origin : new URL(path, origin).href }));
}
