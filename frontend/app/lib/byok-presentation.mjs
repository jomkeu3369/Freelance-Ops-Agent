// Stable public-safe messages. Never interpolate credentials, provider errors or request payloads.
export const byokFailureMessages = Object.freeze({
  "BYOK_SCOPE_REQUIRED": "개인 키 실행 권한을 확인하지 못했습니다. 연결을 다시 확인해 주세요. 다른 AI로 자동 전환하지 않습니다.",
  "BYOK_SCOPE_INVALID": "개인 키 실행 조건이 일치하지 않습니다. 연결과 선택한 모델을 확인해 주세요. 자동으로 다시 보내지 않습니다.",
  "BYOK_SCOPE_EXPIRED": "개인 키 실행 시간이 만료되었습니다. 기존 요청은 자동으로 다시 실행하지 않습니다.",
  "BYOK_SCOPE_CLOSED": "이 개인 키 실행은 종료되었습니다. 기존 요청은 자동으로 다시 실행하지 않습니다.",
  "BYOK_LIMIT_EXHAUSTED": "개인 키 실행 한도에 도달했습니다. 실패·재시도도 한도에 포함되며 자동으로 다시 보내지 않습니다.",
  "BYOK_ATTEMPT_REPLAY": "이미 접수된 개인 키 호출을 다시 실행하지 않았습니다. 실행 상태를 확인해 주세요."
});

export function byokFailureMessage(errorCode) {
  return typeof errorCode === "string" && Object.hasOwn(byokFailureMessages, errorCode) ? byokFailureMessages[errorCode] : null;
}
