export function captureOrigin(raw = "http://127.0.0.1:3217") {
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Capture frontend must be an explicit 127.0.0.1 HTTP origin and port.");
  }
  return url.origin;
}

export function requestDestination(raw, frontendOrigin) {
  let url;
  try { url = new URL(raw); } catch { return "blocked"; }
  if (url.origin === captureOrigin(frontendOrigin)) return "frontend";
  // These requests are fulfilled by the existing synthetic fixture, never forwarded to a backend.
  if (url.origin === "http://localhost:8080" && url.pathname.startsWith("/api/v2/")) return "fixture";
  return "blocked";
}

export async function installNetworkGuard(page, frontendOrigin) {
  const evidence = { blocked: [], frontend: 0, fixture: 0, websocketAttempts: 0 };
  // Install LAST: this handler runs before the existing fixture handlers.
  await page.route("**/*", async route => {
    const raw = route.request().url();
    const destination = requestDestination(raw, frontendOrigin);
    if (destination === "blocked") {
      const url = new URL(raw);
      evidence.blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    evidence[destination]++;
    return route.fallback();
  });
  await page.routeWebSocket("**/*", socket => {
    evidence.websocketAttempts++;
    socket.close({ code: 1000, reason: "Synthetic capture context blocks all WebSockets" });
  });
  return evidence;
}
