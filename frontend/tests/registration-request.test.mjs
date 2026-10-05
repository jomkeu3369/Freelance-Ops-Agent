import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const originalOrigin = process.env.NEXT_PUBLIC_API_BASE_URL;
const originalFetch = globalThis.fetch;
let temporaryRoot;
let api;

before(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "registration-request-test-"));
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
  // A stale JavaScript caller is not silently opted in by the client.
  await api.register(input);
  assert.deepEqual(await requests.at(-1).json(), input);
});

test("login retains its request body without an age field", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.invalid";
  let request;
  globalThis.fetch = async (url, init) => {
    request = new Request(url, init);
    return Response.json({});
  };
  await api.login("fixture@example.invalid", "local-fixture-only");
  assert.equal(request.url, "https://api.example.invalid/api/v2/auth/login");
  assert.deepEqual(await request.json(), { email: "fixture@example.invalid", password: "local-fixture-only" });
});
