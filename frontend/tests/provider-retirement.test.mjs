import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("new provider inputs are OpenAI-only while historical records remain representable", async () => {
  const api = await read("../app/lib/api/contracts/agents.ts") + await read("../app/lib/api/http.ts");
  assert.match(api, /export\s*type\s*Provider\s*=\s*"OPENAI";/);
  assert.match(api, /export\s*type\s*RecordedProvider\s*=\s*Provider\s*\|\s*"GEMINI";/);
  assert.match(api, /provider\s*is\s*Provider\s*\{\s*return\s*provider\s*===\s*"OPENAI";\s*\}/);
  assert.match(api, /interface\s*AIConnection\s*\{\s*id:\s*string;\s*provider:\s*RecordedProvider;/);
});

test("selection and configuration cannot reactivate Gemini", async () => {
  for (const path of ["../features/workspace/settings/ai-connection-settings.tsx", "../features/workspace/project/project-workbench.tsx"]) {
    assert.doesNotMatch(await read(path), /<option\s*value="GEMINI"/);
  }
  const constants = await read("../features/workspace/shared/constants.tsx");
  assert.doesNotMatch(constants, /NEXT_PUBLIC_GEMINI_MODELS|configuredModelOptions\.GEMINI/);
  assert.match(constants, /GEMINI:\s*"Gemini"/); // 과거 활동 라벨은 계속 읽을 수 있게 유지한다.
});

test("retired connections stay reviewable but cannot start calls or silently fall back", async () => {
  const workbench = await read("../features/workspace/project/project-workbench.tsx");
  assert.match(workbench, /setConnections\(value\.connections\.filter\(\(item\)\s*=>\s*isSupportedProvider\(item\.provider\)\)\)/);
  assert.match(workbench, /connection\s*&&\s*isSupportedProvider\(connection\.provider\)\s*&&\s*!connectionError/);
  assert.match(workbench, /isSupportedProvider\(run\.metadata\.provider\)[\s\S]*?:\s*null/);
  assert.match(await read("../features/workspace/settings/ai-connection-settings.tsx"), /지원이\s*종료된\s*연결입니다/);
  assert.doesNotMatch(await read("../features/workspace/project/quotation/use-quote-builder.ts"), /suggestQuotationAssumption/); // 예산 통합 전에는 모든 공급자의 단독 생성을 비활성화한다.
});
