// 설정 변경 명령은 독립된 요청이어야 한다. 일반 프로젝트 요청에 포함된 비율은
// 분석의 문맥일 뿐 작업 공간의 기본 설정을 바꿀 권한으로 해석하지 않는다.
const fields = [
  ["defaultTaxRate", /(?:기본\s*세율|부가세|tax\s*rate)/gi],
  ["defaultRiskBufferRate", /(?:위험\s*버퍼|리스크\s*버퍼|risk\s*buffer)/gi],
  ["maximumDiscountRate", /(?:최대\s*할인(?:율)?|maximum\s*discount(?:\s*rate)?)/gi]
];
const valuePattern = /^\s*(?:을|를|은|는|:|=|to|at|of|로)?\s*(-?\d+(?:\.\d+)?)\s*%/i;
const settingsPrefix =
  /^(?:\/settings\b|견적\s*(?:기본\s*)?설정|(?:estimate|pricing)\s*(?:defaults|settings)\b)\s*:?\s*/i;
const commandPrefix = /^(?:please\s+)?(?:set|change|update)\s+(?:the\s+)?/i;
const commandSuffix = /\s*(?:로|으로)?\s*(?:변경|설정|바꿔)(?:해\s*줘|해\s*주세요|해|줘|주세요)?[.!]?\s*$/;
const negated =
  /(?:바꾸지|변경하지|설정하지|변경\s*없이|그대로|하지\s*마|않|말고|말아|\b(?:not|never|don't|without|keep|preserve)\b)/i;

export function parseChatPolicyIntent(message) {
  const source = message.trim();
  if (negated.test(source)) return null;
  const explicitlySettings = settingsPrefix.test(source);
  let rest = source.replace(settingsPrefix, "").replace(commandPrefix, "").replace(commandSuffix, "");
  const values = {};
  let invalid = false;
  let fieldCount = 0;
  for (const [name, label] of fields) {
    let occurrences = 0;
    rest = rest.replace(new RegExp(`${label.source}${valuePattern.source.slice(1)}`, "gi"), (_match, percentage) => {
      occurrences += 1;
      fieldCount += 1;
      const value = Number(percentage) / 100;
      if (occurrences > 1 || !Number.isFinite(value) || value < 0 || value > 1) invalid = true;
      values[name] = value;
      return "";
    });
    // 필드명이 있어도 비율이 명시되지 않았다면 이전 값을 암묵적으로 유지하지 않는다.
    if (new RegExp(label.source, "i").test(rest)) invalid = true;
  }
  rest = rest.replace(/(?:\band\b|[,;&·\s]|와|과)+/gi, "");
  if (!explicitlySettings && rest) return null;
  if (invalid || rest || !fieldCount) return explicitlySettings || fieldCount ? { valid: false, values: {} } : null;
  return { valid: true, values };
}
