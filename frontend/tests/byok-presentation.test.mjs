import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {byokFailureMessage, byokFailureMessages} from '../app/lib/byok-presentation.mjs';
import {creditEnglish} from '../app/lib/ui-credit-english.mjs';

test('BYOK denials are stable, localizable and do not interpolate credential data', () => {
  assert.equal(Object.keys(byokFailureMessages).length, 8);
  for (const [code, message] of Object.entries(byokFailureMessages)) {
    assert.equal(byokFailureMessage(code), message);
    assert.ok(creditEnglish[message]);
    assert.doesNotMatch(message, /sk-secret|https:|credential_id|provider\s*payload/);
  }
  for (const unknown of [null, undefined, '', 'PLATFORM_SPEND_DISABLED', 'toString', '__proto__', 'sk-secret-value', {}]) assert.equal(byokFailureMessage(unknown), null);
});

test('model controls describe the true personal-key cost boundary and unsupported extras', async () => {
  const controls=await readFile(new URL('../features/workspace/project/analysis/chat-model-controls.tsx',import.meta.url),'utf8');
  const settings=await readFile(new URL('../features/workspace/settings/ai-connection-settings.tsx',import.meta.url),'utf8');
  assert.match(controls,/선택한\s*OpenAI\s*키로만/);
  assert.match(controls,/플랫폼\s*AI를\s*사용하지\s*않습니다/);
  assert.match(controls,/실패·재시도도\s*실행\s*한도에\s*포함/);
  assert.match(settings,/텍스트와\s*프로젝트를\s*분석/);
  for (const source of [controls,settings]) {
    assert.match(source,/유료\s*웹\s*검색·임베딩·별도\s*AI\s*생성은\s*지원하지\s*않습니다/);
    assert.doesNotMatch(source,/플랫폼이\s*처리하는\s*라우팅\s*비용은\s*주간\s*예산에\s*포함|분석과\s*견적\s*가정\s*제안을\s*실행하세요/);
  }
});

test('typed BYOK admission errors reach the preserved-draft chat and terminal presentation', async () => {
  const shell=await readFile(new URL('../features/workspace/workspace-shell.tsx',import.meta.url),'utf8');
  const workbench=await readFile(new URL('../features/workspace/project/project-workbench.tsx',import.meta.url),'utf8');
  const activity=await readFile(new URL('../features/workspace/shared/activity-presentation.tsx',import.meta.url),'utf8');
  assert.match(shell,/cause\s*instanceof\s*ApiError\s*&&\s*byokFailureMessage\(cause.code\)\s*\)?\s*\)\s*throw\s*cause/);
  assert.match(workbench,/if\s*\(byokMessage\)\s*throw\s*new\s*Error\(t\(byokMessage\)\)/);
  assert.match(activity,/byokFailureMessage\(errorCode\)\s*\?\?/);
  assert.match(workbench,/<div\s*className="agent-chat-credit-note">\s*<ByokCostNotice/);
  assert.match(workbench,/chatModel.credentialId\s*\?\s*personalCostKnown\s*:\s*!ledgerBlocker\s*&&\s*!ledger.loading/);
});

test('per-run personal cost estimates use exact conservative Standard arithmetic, never free unknown prices', async () => {
  const {byokCostEstimate}=await import('../app/lib/byok-presentation.mjs');
  const now=Date.parse('2026-10-05T13:00:00Z');
  const expected={'gpt-6-luna':'0.04275','gpt-6-sol':'0.855','gpt-6.1-sol':'0.855','gpt-6-astra':'4.275','gpt-5.6-luna':'0.0951','gpt-5.6-terra':'0.951','gpt-5.6-sol':'1.71'};
  for(const [model,maxUsd] of Object.entries(expected)){
    const estimate=byokCostEstimate('OPENAI',model,now);
    assert.equal(estimate.maxUsd,maxUsd);
    assert.equal(estimate.inputTokens,150000);
    assert.equal(estimate.outputTokens,48000);
    assert.equal(estimate.maxAttempts,50);
    assert.equal(estimate.durationSeconds,180);
    assert.equal(estimate.sourceUrl,`https://developers.openai.com/api/docs/models/${model}`);
  }
  for(const model of ['unknown','gpt-6-luna-extended','gpt-6.1-sol:fast','__proto__','toString',''])assert.equal(byokCostEstimate('OPENAI',model,now),null);
  assert.equal(byokCostEstimate('GEMINI','gpt-6-luna',now),null);
  assert.equal(byokCostEstimate('OPENAI','gpt-6-luna',NaN),null);
  assert.equal(byokCostEstimate('OPENAI','gpt-5.6-sol',Date.parse('2026-11-22T00:00:00Z')),null);
});

test('actual START caps differ only for explicitly selected personal credentials', async () => {
  const contract=JSON.parse(await readFile(new URL('../../contracts/fixtures/workspace-credit-contract.json',import.meta.url),'utf8'));
  assert.equal(contract.start.budget.maxInputTokens,50000);
  assert.equal(contract.byokStart.budget.maxInputTokens,150000);
  assert.deepEqual({...contract.start.budget,maxInputTokens:150000},contract.byokStart.budget);
  const source=await readFile(new URL('../app/lib/api/agent-runs.ts',import.meta.url),'utf8');
  assert.match(source,/maxInputTokens:\s*input.credentialId\s*\?\s*150000\s*:\s*50000/);
  const block=source.match(/budget:\s*\{\s*maxDurationSeconds:\s*180,(.*?)\n\s*\},/s)?.[0];
  assert.ok(block);
  const values=Object.fromEntries([...block.matchAll(/(max\w+):\s*(\d+)/g)].map(([,key,value])=>[key,Number(value)]));
  for(const [personal,key] of [[false,'start'],[true,'byokStart']]){
    assert.deepEqual({...values,maxInputTokens:personal?150000:50000},contract[key].budget);
  }
  assert.match(source,/input.credentialId\s*&&\s*!byokCostEstimate\(input.provider,\s*input.model\)/);
  assert.match(source,/input.credentialId\s*\?\s*\{\s*byokCostNoticeVersion\s*\}\s*:\s*\{\}/);
});
