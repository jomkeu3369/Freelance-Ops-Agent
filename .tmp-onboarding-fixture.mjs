import http from "node:http";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const session = {
  userId,
  workspaceId,
  accessToken: "fixture-access-token",
  accessTokenExpiresAt: "2026-08-15T00:00:00.000Z",
  refreshToken: "fixture-refresh-token",
  refreshTokenExpiresAt: "2026-09-15T00:00:00.000Z",
  tokenType: "Bearer",
};
const profile = {
  id: userId,
  email: "owner@example.com",
  displayName: "김프리",
  status: "ACTIVE",
  workspaces: [{
    workspaceId,
    name: "김프리 스튜디오",
    slug: "kim-studio",
    effectivePermissions: ["project.read", "project.write", "client.read", "client.write", "client.delete", "document.read", "document.write", "document.delete", "quotation.read", "quotation.write", "quotation.publish", "workspace.update", "agent.run", "agent.respond", "agent.cancel"],
  }],
};
const rateCards = [{ id: "33333333-3333-4333-8333-333333333333", workspaceId, name: "개발 작업", unit: "HOUR", rate: 100000, minimumAmount: 500000, currency: "KRW", active: true, version: 1 }];
const policy = { workspaceId, defaultTaxRate: 0.1, defaultRiskBufferRate: 0.15, maximumDiscountRate: 0.1, version: 1 };

http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost:3103");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  let body;
  if (request.method === "POST" && path === "/api/v2/auth/register") body = session;
  else if (request.method === "GET" && path === "/api/v2/me") body = profile;
  else if (request.method === "GET" && path === `/api/v2/workspaces/${workspaceId}/projects`) body = [];
  else if (request.method === "GET" && path === `/api/v2/workspaces/${workspaceId}/clients`) body = [];
  else if (request.method === "GET" && path === `/api/v2/workspaces/${workspaceId}/rate-cards`) body = rateCards;
  else if (request.method === "GET" && path === `/api/v2/workspaces/${workspaceId}/estimation-policy`) body = policy;
  else { response.writeHead(404, { "Content-Type": "application/problem+json" }); response.end(JSON.stringify({ detail: `fixture route missing: ${request.method} ${path}` })); return; }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}).listen(8080, "127.0.0.1");
