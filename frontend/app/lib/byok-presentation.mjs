// Stable public-safe messages. Never interpolate credentials, provider errors or request payloads.
export const byokFailureMessages = Object.freeze({
  "BYOK_COST_NOTICE_REFRESH_REQUIRED": "개인 키 비용 안내가 변경되었습니다. 페이지를 새로고침하고 비용 한도를 확인한 뒤 직접 다시 보내 주세요. 입력은 보존되며 자동 재실행하지 않습니다.",
  "BYOK_SCOPE_REQUIRED": "개인 키 실행 권한을 확인하지 못했습니다. 연결을 다시 확인해 주세요. 다른 AI로 자동 전환하지 않습니다.",
  "BYOK_SCOPE_INVALID": "개인 키 실행 조건이 일치하지 않습니다. 연결과 선택한 모델을 확인해 주세요. 자동으로 다시 보내지 않습니다.",
  "BYOK_SCOPE_EXPIRED": "개인 키 실행 시간이 만료되었습니다. 기존 요청은 자동으로 다시 실행하지 않습니다.",
  "BYOK_SCOPE_CLOSED": "이 개인 키 실행은 종료되었습니다. 기존 요청은 자동으로 다시 실행하지 않습니다.",
  "BYOK_LIMIT_EXHAUSTED": "개인 키 실행 한도에 도달했습니다. 실패·재시도도 한도에 포함되며 자동으로 다시 보내지 않습니다.",
  "BYOK_PLAN_INPUT_BUDGET_EXCEEDED": "입력과 필요한 분석 단계가 실행 한도를 넘어 AI 호출 전에 중단했습니다. 요청이나 첨부 자료를 줄여 주세요.",
  "BYOK_ATTEMPT_REPLAY": "이미 접수된 개인 키 호출을 다시 실행하지 않았습니다. 실행 상태를 확인해 주세요."
});

export function byokFailureMessage(errorCode) {
  return typeof errorCode === "string" && Object.hasOwn(byokFailureMessages, errorCode) ? byokFailureMessages[errorCode] : null;
}

// Public Standard API text-token rates verified 2026-10-05 against the official
// per-model documentation. Input uses the higher cache-write rate conservatively.
// This is a token-based estimate, not a provider invoice or a guaranteed dollar cap.
export const byokEstimateAsOf = '2026-10-05';
export const byokCostNoticeVersion = 'byok-standard-150k-48k-2026-10-05-v1';
const rates = Object.freeze({
  'gpt-6-luna': {input:12500000n, output:50000000n},
  'gpt-6-sol': {input:250000000n, output:1000000000n},
  'gpt-6.1-sol': {input:250000000n, output:1000000000n},
  'gpt-6-astra': {input:1250000000n, output:5000000000n},
  'gpt-5.6-luna': {input:25000000n, output:120000000n},
  'gpt-5.6-terra': {input:250000000n, output:1200000000n},
  'gpt-5.6-sol': {input:500000000n, output:2000000000n, reviewAt:Date.parse('2026-11-22T00:00:00Z')},
});

export function byokCostEstimate(provider, model, now=Date.now()) {
  if(provider!=='OPENAI' || typeof model!=='string' || !Object.hasOwn(rates,model) || !Number.isFinite(now)) return null;
  const rate=rates[model];
  if(rate.reviewAt!==undefined && now>=rate.reviewAt) return null;
  const units=(150000n*rate.input+48000n*rate.output+999999n)/1000000n;
  const whole=units/100000000n;
  const fraction=(units%100000000n).toString().padStart(8,'0').replace(/0+$/,'');
  return {maxUsd:`${whole}${fraction?'.'+fraction:''}`,inputTokens:150000,outputTokens:48000,maxAttempts:50,durationSeconds:180,asOf:byokEstimateAsOf,
    sourceUrl:`https://developers.openai.com/api/docs/models/${model}`};
}
