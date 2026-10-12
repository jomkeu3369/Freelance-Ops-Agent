import type { MetadataRoute } from "next";
import { getSiteOrigin, isPreviewDeployment } from "./lib/site-config.mjs";

export default function robots(): MetadataRoute.Robots {
  return {
    // Crawlers must reach excluded pages to read their server noindex directive.
    // This is an indexing policy, not an authorization boundary.
    rules: { userAgent: "*", allow: "/" },
    ...(!isPreviewDeployment() ? { sitemap: new URL("/sitemap.xml", getSiteOrigin()).href } : {}),
  };
}
