import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("new provider inputs are OpenAI-only while historical records remain representable", async () => {
  const api = await read("../app/lib/api.ts");
  assert.match(api, /export type Provider = "OPENAI";/);
  assert.match(api, /export type RecordedProvider = Provider \| "GEMINI";/);
  assert.match(api, /provider is Provider \{ return provider === "OPENAI"; \}/);
  assert.match(api, /interface AIConnection \{ id: string; provider: RecordedProvider;/);
});

test("selection and configuration cannot reactivate Gemini", async () => {
  for (const path of ["../features/workspace/settings/ai-connection-settings.tsx", "../features/workspace/settings/model-pricing-form.tsx", "../features/workspace/project/project-workbench.tsx"]) {
    assert.doesNotMatch(await read(path), /<option value="GEMINI"/);
  }
  const constants = await read("../features/workspace/shared/constants.tsx");
  assert.doesNotMatch(constants, /NEXT_PUBLIC_GEMINI_MODELS|configuredModelOptions\.GEMINI/);
  assert.match(constants, /GEMINI: "Gemini"/); // Historical activity labels remain readable.
});

test("retired connections stay reviewable but cannot start calls or silently fall back", async () => {
  const workbench = await read("../features/workspace/project/project-workbench.tsx");
  assert.match(workbench, /setConnections\(value\.connections\.filter\(\(item\) => isSupportedProvider\(item\.provider\)\)\)/);
  assert.match(workbench, /connection && isSupportedProvider\(connection\.provider\) && !connectionError/);
  assert.match(workbench, /isSupportedProvider\(run\.metadata\.provider\)[\s\S]*?: null/);
  assert.match(await read("../features/workspace/settings/ai-connection-settings.tsx"), /지원이 종료된 연결입니다/);
  assert.match(await read("../features/workspace/project/quotation/use-quote-builder.ts"), /!modelSelection\?\.model\.trim\(\)/);
});
