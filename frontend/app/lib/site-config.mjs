// 임시 배포 주소와 관계없이 하나의 공개 기준 주소를 사용한다.
export const defaultSiteOrigin = "https://www.freelance-ops.site";
export const publicPagePaths = ["/", "/notices"];
export const nonIndexableRoutePrefixes = ["/workspace", "/admin", "/verify-email", "/proposal"];

export function getSiteOrigin(environment = process.env) {
  const value = environment.NEXT_PUBLIC_SITE_URL?.trim() || defaultSiteOrigin;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.origin !== value ||
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL must be a public HTTPS origin without credentials, a path, query, hash, or trailing slash."
    );
  }
  return url.origin;
}

export function isPreviewDeployment(environment = process.env) {
  return environment.VERCEL_ENV === "preview" || environment.VERCEL_ENV === "development";
}

export function searchHeaders(environment = process.env) {
  const sources = isPreviewDeployment(environment)
    ? ["/:path*"]
    : nonIndexableRoutePrefixes.map((path) => `${path}/:path*`);
  return sources.map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }));
}
