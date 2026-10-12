import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as config from "../app/lib/site-config.mjs";
import * as copy from "../app/lib/site-copy.mjs";
import { translateUi as translateHome } from "../features/home/ui-locale.mjs";
import { translateUi as translateApp } from "../app/lib/ui-locale.mjs";
import { validateVercelEnvironment } from "../scripts/validate-vercel-env.mjs";

async function loadModule(path, dependencies) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  new Function("require", "exports", outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const configured = environment => ({ ...config, getSiteOrigin: () => config.getSiteOrigin(environment), isPreviewDeployment: () => config.isPreviewDeployment(environment) });

test("canonical origin never comes from deployment host and validates explicit overrides", () => {
  assert.equal(config.getSiteOrigin({}), "https://www.freelance-ops.site");
  assert.equal(config.getSiteOrigin({ VERCEL_URL: "ephemeral.vercel.app", VERCEL_ENV: "preview" }), config.defaultSiteOrigin);
  assert.equal(config.getSiteOrigin({ NEXT_PUBLIC_SITE_URL: "  https://canonical.example.invalid  " }), "https://canonical.example.invalid");
  for (const value of ["http://example.com", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://user:secret@example.com", "https://example.com/", "https://example.com/path", "https://example.com?token=secret", "https://example.com#fragment", "not-a-url"]) {
    assert.throws(() => config.getSiteOrigin({ NEXT_PUBLIC_SITE_URL: value }), /NEXT_PUBLIC_SITE_URL must/);
  }
  assert.deepEqual(validateVercelEnvironment({ VERCEL: "1", NEXT_PUBLIC_API_BASE_URL: "https://api.example.invalid" }), { apiOrigin: "https://api.example.invalid", siteOrigin: config.defaultSiteOrigin });
});

for (const environment of [{}, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
  const name = environment.VERCEL_ENV ?? "local";
  test(`${name}: public route metadata, sitemap, crawl rules and headers agree`, async () => {
    const moduleConfig = configured(environment);
    const preview = config.isPreviewDeployment(environment);
    const { rootMetadata, privateMetadata, publicPageMetadata } = await loadModule("app/lib/site-metadata.ts", { "./site-config.mjs": moduleConfig, "./site-copy.mjs": copy });
    const { default: robots } = await loadModule("app/robots.ts", { "./lib/site-config.mjs": moduleConfig });
    const { default: sitemap } = await loadModule("app/sitemap.ts", { "./lib/site-config.mjs": moduleConfig });
    assert.equal(rootMetadata.alternates, undefined, "Root cannot give private pages the home canonical");
    assert.equal(rootMetadata.openGraph.url, undefined);
    assert.equal(rootMetadata.metadataBase.href, `${config.defaultSiteOrigin}/`);
    assert.equal(rootMetadata.robots?.index === false, preview);
    assert.deepEqual(privateMetadata.robots, { index: false, follow: false });
    for (const [path, title, description] of [["/", copy.homeTitle, copy.homeDescription], ["/notices", copy.noticesTitle, copy.noticesDescription]]) {
      const metadata = publicPageMetadata(path, title, description);
      const expected = path === "/" ? config.defaultSiteOrigin : new URL(path, config.defaultSiteOrigin).href;
      assert.equal(metadata.alternates.canonical, expected);
      assert.equal(metadata.openGraph.url, expected);
      assert.equal(metadata.title, title);
      assert.equal(metadata.openGraph.description, description);
      assert.equal(metadata.twitter.title, title);
      assert.equal(metadata.robots, undefined, "Public route cannot overwrite inherited preview noindex");
    }
    assert.deepEqual(sitemap(), preview ? [] : [{ url: config.defaultSiteOrigin }, { url: `${config.defaultSiteOrigin}/notices` }]);
    assert.deepEqual(robots().rules, { userAgent: "*", allow: "/" });
    assert.equal(robots().sitemap, preview ? undefined : `${config.defaultSiteOrigin}/sitemap.xml`);
    const headers = config.searchHeaders(environment);
    assert.deepEqual(headers.map(header => header.source), preview ? ["/:path*"] : ["/workspace/:path*", "/admin/:path*", "/verify-email/:path*", "/proposal/:path*"]);
    assert.ok(headers.every(header => header.headers[0].value === "noindex, nofollow"));
  });
}

test("private subtrees export server noindex and verification keeps no-referrer", async () => {
  for (const route of ["workspace", "admin", "verify-email", "proposal"]) {
    const source = await readFile(new URL(`../app/${route}/layout.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /["']use client["']/);
    assert.match(source, /export const metadata = privateMetadata/);
  }
  const verify = await readFile(new URL("../app/verify-email/page.tsx", import.meta.url), "utf8");
  assert.match(verify, /referrer: "no-referrer"/);
});

test("home and notices title pairs translate while workspace title remains distinct", () => {
  assert.equal(translateHome(copy.homeTitle, "en"), "AI quote drafting for freelancers | Freelance Ops");
  assert.equal(translateHome(copy.homeTitle, "ko"), copy.homeTitle);
  assert.equal(translateApp(copy.noticesTitle, "en"), "Service notices | Freelance Ops");
  assert.equal(translateApp(copy.defaultSiteTitle, "en"), "Freelance Ops | Evidence-based estimates");
  for (const text of ["프리랜서를 위한 AI 견적서 작성.", "고객 문의부터 요구사항 분석, 견적과 제안서 초안까지.", "AI 요구사항 분석으로 작업 범위를 정리합니다.", "고객 문의에서 작업 항목과 확인할 질문을 찾고, 원문과 함께 검토하세요.", "외주 개발 견적 산정의 근거를 확인하세요.", "AI가 제안한 공수를 검토하고, 등록한 단가와 계산 규칙으로 금액을 산정합니다."]) {
    assert.equal(translateHome(text, "ko"), text);
    assert.doesNotMatch(translateHome(text, "en"), /[가-힣]/);
  }
});
