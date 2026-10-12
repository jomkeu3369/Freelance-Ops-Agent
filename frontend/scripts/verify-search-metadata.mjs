// Raw HTTP assertions: no browser, user accounts, backend, or provider calls.
import assert from "node:assert/strict";
import { homeTitle, homeDescription, noticesTitle } from "../app/lib/site-copy.mjs";
import { getSiteOrigin } from "../app/lib/site-config.mjs";

const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname), "Verification is restricted to an ephemeral local app");
const origin = getSiteOrigin();
const preview = process.env.SEO_EXPECT_PREVIEW === "true";
const agents = ["Mozilla/5.0", "Googlebot", "Twitterbot"];
const privatePaths = ["/workspace", "/workspace/projects", "/workspace/projects/synthetic-project", "/workspace/projects/synthetic-project/analysis", "/workspace/settings", "/workspace/clients", "/workspace/knowledge", "/admin", "/admin/members", "/admin/notices", "/verify-email?token=synthetic-token", "/proposal/synthetic-proposal-token"];
function tags(html, tag, attribute, value) {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].map(match => match[0]).filter(text => text.includes(`${attribute}="${value}"`));
}
const content = tag => tag?.match(/content="([^"]*)"/)?.[1];
async function request(path, agent = agents[0]) {
  const response = await fetch(new URL(path, base), { headers: { "user-agent": agent }, redirect: "manual" });
  if ([307, 308].includes(response.status) && privatePaths.includes(path)) {
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    const target = new URL(response.headers.get("location"), base);
    assert.equal(target.origin, new URL(base).origin);
    assert.ok(target.pathname.startsWith("/workspace/"));
    const final = await fetch(target, { headers: { "user-agent": agent }, redirect: "manual" });
    assert.equal(final.status, 200);
    assert.match(final.headers.get("x-robots-tag") ?? "", /noindex/);
    return { response, html: await final.text() };
  }
  assert.equal(response.status, 200, `${agent} ${path}: ${response.status}`);
  return { response, html: await response.text() };
}
for (const agent of agents) {
  for (const [path, title] of [["/", homeTitle], ["/notices", noticesTitle]]) {
    const { response, html } = await request(path, agent);
    assert.ok(html.includes(`<title>${title}</title>`), `${agent} ${path} title`);
    const expectedUrl = path === "/" ? origin : new URL(path, origin).href;
    const canonical = tags(html, "link", "rel", "canonical");
    assert.equal(canonical.length, 1, `${path} canonical count`);
    assert.ok(canonical[0].includes(`href="${expectedUrl}"`));
    assert.equal(content(tags(html, "meta", "property", "og:url")[0]), expectedUrl);
    assert.equal(content(tags(html, "meta", "property", "og:image")[0]), `${origin}/og.png`);
    assert.equal(content(tags(html, "meta", "name", "twitter:image")[0]), `${origin}/og.png`);
    assert.equal(/noindex/.test(tags(html, "meta", "name", "robots").join(" ")), preview);
    assert.equal(/noindex/.test(response.headers.get("x-robots-tag") ?? ""), preview);
    if (path === "/") {
      assert.equal(content(tags(html, "meta", "name", "description")[0]), homeDescription);
      assert.match(html, /프리랜서를 위한 AI 견적서 작성\./);
      assert.match(html, /AI 요구사항 분석으로 작업 범위를 정리합니다\./);
      assert.match(html, /등록한 단가와 계산 규칙으로 금액을 산정합니다\./);
      assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    }
  }
  for (const path of privatePaths) {
    const { response, html } = await request(path, agent);
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.match(tags(html, "meta", "name", "robots").join(" "), /noindex/);
    assert.equal(tags(html, "link", "rel", "canonical").length, 0, `${path} must not inherit home canonical`);
    assert.equal(tags(html, "meta", "property", "og:url").length, 0);
    if (path.startsWith("/verify-email")) assert.equal(content(tags(html, "meta", "name", "referrer")[0]), "no-referrer");
  }
}
const robots = (await request("/robots.txt")).html;
assert.match(robots, /User-Agent: \*/i);
assert.match(robots, /Allow: \/\s/);
assert.doesNotMatch(robots, /Disallow:\s*\//);
assert.equal(robots.includes(`Sitemap: ${origin}/sitemap.xml`), !preview);
const sitemap = (await request("/sitemap.xml")).html;
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.deepEqual(urls, preview ? [] : [origin, `${origin}/notices`]);
assert.doesNotMatch(sitemap, /token|workspace|admin|verify-email|proposal|lastmod/);
const image = await fetch(new URL("/og.png", base));
assert.equal(image.status, 200);
assert.match(image.headers.get("content-type"), /image\/png/);
const bytes = Buffer.from(await image.arrayBuffer());
assert.equal(bytes.readUInt32BE(16), 1731);
assert.equal(bytes.readUInt32BE(20), 909);
console.log(`PASS: ${preview ? "preview" : "production"} raw HTML for ${agents.length} user agents, ${privatePaths.length} private paths, canonical/OG, robots, exact sitemap and OG image.`);
