import {test, expect} from '@playwright/test';
import {fixture} from './helpers/chat-fixture.mjs';
import {byokFailureMessages} from '../../app/lib/byok-presentation.mjs';
import {creditEnglish} from '../../app/lib/ui-credit-english.mjs';

const path='/workspace/projects/project-one/agent';
const draft='  Preserve this personal-key request\nNo automatic retry  ';
const labels={ko:{connection:'AI 연결',model:'AI 모델 선택',send:'보내기'},en:{connection:'AI connection',model:'Choose AI model',send:'Send'}};
async function prepare(page,locale){
  const state=await fixture(page);
  state.aiUsage.spendingEnabled=false;
  state.aiUsage.models=state.aiUsage.models.map(model=>({...model,available:false,unavailableReason:'SPENDING_DISABLED'}));
  state.connections=[{id:'personal-bounded',provider:'OPENAI',model:'gpt-6-luna',maskedKey:'synthetic-only',updatedAt:'2026-10-05T00:00:00Z'}];
  if(locale==='en')await page.addInitScript(()=>localStorage.setItem('freelance-ops-ui-locale-v1','en'));
  await page.goto(path);
  await page.locator('#agent-chat-input').fill(draft);
  await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeDisabled();
  await page.locator('.chat-model-trigger').click();
  const menu=page.getByRole('dialog',{name:labels[locale].model,exact:true});
  await menu.getByLabel(labels[locale].connection,{exact:true}).selectOption('personal-bounded');
  await expect(menu).toContainText(locale==='ko'?'플랫폼 AI를 사용하지 않습니다':'do not use platform AI');
  await expect(menu).toContainText(locale==='ko'?'유료 웹 검색·임베딩·별도 AI 생성은 지원하지 않습니다':'Paid web search, embeddings and standalone AI generation are unsupported');
  await page.keyboard.press('Escape');
  await expect(page.locator('#agent-chat-input')).toHaveValue(draft);
  return state;
}
for(const locale of ['ko','en']){
  test(`${locale}: platform spending off still allows an explicit selected-key request without a client-issued scope`,async({page})=>{
    const state=await prepare(page,locale);
    expect(state.starts).toEqual([]);
    await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeEnabled();
    await page.locator('.agent-chat-composer button[type="submit"]').click();
    await expect.poll(()=>state.starts.length).toBe(1);
    expect(state.starts[0].modelSelection.credentialId).toBe('personal-bounded');
    expect(state.starts[0].requirementText).toBe(draft);
    expect(state.starts[0]).not.toHaveProperty('byokBudget');
    expect(state.starts[0]).not.toHaveProperty('platformBudget');
    expect(state.starts[0]).not.toHaveProperty('creditQuote');
    expect(state.blocked).toEqual([]);
  });
  for(const code of ['BYOK_SCOPE_EXPIRED','BYOK_LIMIT_EXHAUSTED'])test(`${locale}: ${code} preserves the draft and never falls back or retries`,async({page})=>{
    const state=await fixture(page);
    state.aiUsage.spendingEnabled=false;
    state.connections=[{id:'personal-bounded',provider:'OPENAI',model:'gpt-6-luna',maskedKey:'synthetic-only',updatedAt:'2026-10-05T00:00:00Z'}];
    if(locale==='en')await page.addInitScript(()=>localStorage.setItem('freelance-ops-ui-locale-v1','en'));
    const attempts=[];
    await page.route('**/agent-runs',route=>{
      if(route.request().method()!=='POST')return route.fallback();
      attempts.push(route.request().postDataJSON());
      return route.fulfill({status:409,json:{code,detail:'Raw synthetic response must not be shown'}});
    });
    await page.goto(path);
    await page.locator('#agent-chat-input').fill(draft);
    await page.locator('.chat-model-trigger').click();
    await page.getByRole('dialog',{name:labels[locale].model,exact:true}).getByLabel(labels[locale].connection,{exact:true}).selectOption('personal-bounded');
    await page.keyboard.press('Escape');
    await page.locator('.agent-chat-composer button[type="submit"]').click();
    const message=byokFailureMessages[code];
    await expect(page.locator('.agent-chat .form-error')).toContainText(locale==='ko'?message:creditEnglish[message]);
    await expect(page.locator('#agent-chat-input')).toHaveValue(draft);
    await expect(page.locator('.chat-model-trigger')).toContainText('gpt-6-luna');
    await expect(page.locator('body')).not.toContainText('Raw synthetic response must not be shown');
    expect(attempts).toHaveLength(1);
    expect(attempts[0].modelSelection.credentialId).toBe('personal-bounded');
    expect(state.starts).toEqual([]);
    expect(state.blocked).toEqual([]);
  });
}

test('selected key/model changes the visible per-run amount before Send; unknown pricing cannot execute',async({page})=>{
  const state=await fixture(page);
  state.aiUsage.spendingEnabled=false;
  state.connections=[
    {id:'luna-key',provider:'OPENAI',model:'gpt-6-luna',maskedKey:'synthetic-luna',updatedAt:'2026-10-05T00:00:00Z'},
    {id:'astra-key',provider:'OPENAI',model:'gpt-6-astra',maskedKey:'synthetic-astra',updatedAt:'2026-10-05T00:00:00Z'},
    {id:'unknown-key',provider:'OPENAI',model:'unpriced-future-model',maskedKey:'synthetic-unknown',updatedAt:'2026-10-05T00:00:00Z'},
  ];
  await page.goto(path);
  await page.locator('#agent-chat-input').fill(draft);
  for(const [key,price] of [['luna-key','$0.04275'],['astra-key','$4.275']]){
    await page.locator('.chat-model-trigger').click();
    await page.getByRole('dialog',{name:'AI 모델 선택',exact:true}).getByLabel('AI 연결',{exact:true}).selectOption(key);
    await page.keyboard.press('Escape');
    const notice=page.locator('.agent-chat-composer .byok-cost-notice');
    await expect(notice).toContainText(price);
    await expect(notice).toContainText('입력 15만·출력 4.8만');
    await expect(notice).toContainText('요금 변경·계정 조건·세금·환율');
    await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeEnabled();
    expect(state.starts).toEqual([]);
  }
  await page.locator('.chat-model-trigger').click();
  await page.getByRole('dialog',{name:'AI 모델 선택',exact:true}).getByLabel('AI 연결',{exact:true}).selectOption('unknown-key');
  await page.keyboard.press('Escape');
  await expect(page.locator('.agent-chat-composer .byok-cost-notice')).toContainText('비용 기준을 확인하지 못했습니다');
  await expect(page.locator('.agent-chat-composer button[type="submit"]')).toBeDisabled();
  await expect(page.locator('#agent-chat-input')).toHaveValue(draft);
  expect(state.starts).toEqual([]);
});
