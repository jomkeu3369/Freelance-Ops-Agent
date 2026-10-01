// Deliberately narrow: only explicit percentages become a settings proposal.
// All other text remains the user's original agent request.
const fields = [
  ["defaultTaxRate", /(?:기본\s*세율|부가세|tax\s*rate)\s*(?:을|를|은|는|:|=|to|at|of|로)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%/i],
  ["defaultRiskBufferRate", /(?:위험\s*버퍼|리스크\s*버퍼|risk\s*buffer)\s*(?:을|를|은|는|:|=|to|at|of|로)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%/i],
  ["maximumDiscountRate", /(?:최대\s*할인(?:율)?|maximum\s*discount(?:\s*rate)?)\s*(?:을|를|은|는|:|=|to|at|of|로)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%/i],
];

export function parseChatPolicyIntent(message) {
  const values = {};
  for (const [name, pattern] of fields) {
    const match = message.match(pattern);
    if (match) values[name] = Number(match[1]) / 100;
  }
  const explicitlySettings = /^(?:\/settings\b|견적\s*(?:기본\s*)?설정|(?:estimate|pricing)\s*(?:defaults|settings)\b)/i.test(message.trim());
  const isPolicy = explicitlySettings || Object.keys(values).length > 0;
  if (!isPolicy) return null;
  if (Object.keys(values).length === 0 || Object.values(values).some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    return { valid: false, values: {} };
  }
  return { valid: true, values };
}
