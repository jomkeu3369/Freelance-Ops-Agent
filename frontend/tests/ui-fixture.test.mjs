import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { allowUIFixture, fixtureBranch } from "../features/ui-preview/fixture-guard.mjs";

test("UI fixture is allowed only in local development or its exact preview branch", () => {
  assert.equal(allowUIFixture({ NODE_ENV: "development" }), true);
  assert.equal(allowUIFixture({ NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: fixtureBranch }), true);
  assert.equal(allowUIFixture({ NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: fixtureBranch }), false);
  assert.equal(allowUIFixture({ NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" }), false);
  assert.equal(allowUIFixture({ NODE_ENV: "production" }), false);
  assert.equal(allowUIFixture({}), false);
});

test("story uses the actual presentation components without credentials, session injection or API calls", async () => {
  const source = await readFile(new URL("../features/ui-preview/fullscreen-chat-fixture.tsx", import.meta.url), "utf8");
  for (const component of ["AgentChatSurface", "WorkspaceChrome", "ProjectStepNavigation"]) assert.match(source, new RegExp(`<${component}\\b`));
  assert.doesNotMatch(source, /\b(fetch|loadSession|saveSession|startAgentRun|AgentChat)\s*\(|accessToken|refreshToken|sessionStorage/);
  assert.match(source, /data-ui-fixture="synthetic-only"/);
  assert.match(source, /sample data · no API connection/);
  assert.match(source, /event.preventDefault\(\); setNotice\(explanation\)/);
});

test("route refuses non-fixture environments and asks search engines not to index it", async () => {
  const source = await readFile(new URL("../app/ui-preview/fullscreen-chat/page.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!allowUIFixture\(process.env\)\) notFound\(\)/);
  assert.match(source, /robots: \{ index: false, follow: false \}/);
});
