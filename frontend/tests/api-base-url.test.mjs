import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { validateVercelEnvironment } from "../scripts/validate-vercel-env.mjs";

const originalOrigin = process.env.NEXT_PUBLIC_API_BASE_URL;
const originalFetch = globalThis.fetch;
let temporaryRoot;
let api;

before(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "freelance-ops-api-url-test-"));
  // Exercise the real TypeScript API client without loading Next or contacting a server.
  for (const name of ["api", "query-cache"]) {
    const source = await readFile(new URL(`../app/lib/${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 },
    });
    await writeFile(join(temporaryRoot, `${name}.mjs`), outputText.replace('"./query-cache"', '"./query-cache.mjs"'));
  }
  api = await import(pathToFileURL(join(temporaryRoot, "api.mjs")));
});

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
  else process.env.NEXT_PUBLIC_API_BASE_URL = originalOrigin;
  globalThis.fetch = originalFetch;
});

after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test("API origins use the same outer-whitespace normalization as Vercel validation", () => {
  for (const raw of [" https://api.example.invalid", "https://api.example.invalid ", "\t\nhttps://api.example.invalid\r\n "]) {
    process.env.NEXT_PUBLIC_API_BASE_URL = raw;
    const validated = validateVercelEnvironment({ VERCEL: "1", VERCEL_URL: "preview.example.invalid", NEXT_PUBLIC_API_BASE_URL: raw });
    assert.equal(api.apiBaseUrl(), validated.apiOrigin);
  }
});

test("normalization preserves existing origins, local fallback and trailing-slash behavior", () => {
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  assert.equal(api.apiBaseUrl(), "http://localhost:8080");
  for (const [raw, expected] of [
    ["https://api.example.invalid", "https://api.example.invalid"],
    ["http://localhost:8080", "http://localhost:8080"],
    ["https://api.example.invalid/", "https://api.example.invalid"],
    [" https://api.example.invalid/ \n", "https://api.example.invalid"],
    ["", ""],
  ]) {
    process.env.NEXT_PUBLIC_API_BASE_URL = raw;
    assert.equal(api.apiBaseUrl(), expected);
  }
});

test("a whitespace-padded origin produces a valid request URL without external network", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = " \thttps://api.example.invalid \r\n";
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(new Request(url, init));
    return new Response(JSON.stringify({ projectTitle: "Local fixture" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  const result = await api.getSharedProposal("fixture / share");
  assert.equal(result.projectTitle, "Local fixture");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.example.invalid/api/v2/proposals/fixture%20%2F%20share");
  assert.equal(requests[0].method, "GET");
});

test("registration sends the age attestation as a JSON boolean and never assumes consent", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.invalid";
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(new Request(url, init));
    return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } });
  };
  const input = { email: "fixture@example.invalid", password: "local-fixture-only", displayName: "Fixture", workspaceName: "Fixture workspace" };
  for (const ageAtLeast14 of [true, false]) {
    await api.register({ ...input, ageAtLeast14 });
    const request = requests.at(-1);
    assert.equal(request.url, "https://api.example.invalid/api/v2/auth/register");
    assert.equal(request.method, "POST");
    assert.deepEqual(await request.json(), { ...input, ageAtLeast14 });
  }
  // A stale JavaScript caller is not silently opted in; the server rejects the missing field.
  await api.register(input);
  assert.deepEqual(await requests.at(-1).json(), input);
});
