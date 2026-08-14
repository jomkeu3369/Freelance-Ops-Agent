import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function publicHttpsOrigin(name, rawValue, required) {
  const value = rawValue?.trim();
  if (!value) {
    if (required) throw new Error(`${name} must be configured for a Vercel deployment.`);
    return null;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }

  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  if (url.username || url.password) throw new Error(`${name} must not contain credentials.`);
  if (url.origin !== value) throw new Error(`${name} must be an origin without a path, query, hash, or trailing slash.`);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error(`${name} must be publicly reachable and cannot use a loopback host.`);
  }
  return value;
}

export function validateVercelEnvironment(environment = process.env) {
  if (environment.VERCEL !== "1") return { apiOrigin: null, siteOrigin: null };

  const apiOrigin = publicHttpsOrigin("NEXT_PUBLIC_API_BASE_URL", environment.NEXT_PUBLIC_API_BASE_URL, true);
  const siteOrigin = publicHttpsOrigin("NEXT_PUBLIC_SITE_URL", environment.NEXT_PUBLIC_SITE_URL, false);
  if (!siteOrigin && !environment.VERCEL_URL?.trim()) {
    throw new Error("VERCEL_URL is required when NEXT_PUBLIC_SITE_URL is not configured.");
  }
  return { apiOrigin, siteOrigin };
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  try {
    validateVercelEnvironment();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Vercel public environment configuration.";
    console.error(`[vercel-env] ${message}`);
    process.exitCode = 1;
  }
}
