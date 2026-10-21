// 과거 발화도 같은 규칙으로 표시한다. 공수·일정 숫자는 유지하고 금액 주장은 계산된 견적으로 모은다.
const money = /[₩$€¥]\s*\d|(?:KRW|USD|EUR|JPY)\s*\d|\d[\d,.]*(?:\s*[십백천만억]\s*[\d,.]*)*\s*(?:원(?!문)|달러|유로|엔|KRW|USD|EUR|JPY)|[일이삼사오육칠팔구십백천][일이삼사오육칠팔구십백천만억]*\s*원(?!문)/i;
const priceClaim = /(?:예산|총액|공급가액|부가세).{0,35}(?:이내|초과|충족|맞췄|맞춘|검증할 수|확정할 수)/;

/** @param {string} text */
export function conversationText(text) {
  return text.trim().split(/(?<=[.!?。！？])\s+|\n+/).filter(part => !money.test(part) && !priceClaim.test(part)).join("\n\n");
}
