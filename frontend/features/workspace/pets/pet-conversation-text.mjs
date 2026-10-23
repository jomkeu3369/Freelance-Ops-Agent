// 과거 발화도 같은 규칙으로 표시한다. 공수·일정 숫자는 유지하고 금액 주장은 계산된 견적으로 모은다.
const money = /[₩$€¥]\s*\d|(?:KRW|USD|EUR|JPY)\s*\d|\d[\d,.]*(?:\s*[십백천만억]\s*[\d,.]*)*\s*(?:원(?!문)|달러|유로|엔|KRW|USD|EUR|JPY)|[일이삼사오육칠팔구십백천][일이삼사오육칠팔구십백천만억]*\s*원(?!문)/i;
const priceClaim = /(?:예산|총액|공급가액|부가세).{0,35}(?:이내|초과|충족|맞췄|맞춘|검증할 수|확정할 수)/;

/** @param {string} text */
export function conversationText(text) {
  return text.trim().split(/(?<=[.!?。！？])\s+|\n+/).filter(part => !money.test(part) && !priceClaim.test(part)).join("\n\n");
}

/** @param {string} text @param {string | null | undefined} recipientName @param {string[]} names */
export function conversationReplyText(text, recipientName, names) {
  const known = [...new Set([...names,recipientName].filter(name => typeof name === "string" && name.trim()).map(name => name.trim()))]
    .sort((left,right) => right.length-left.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  const name = `(?:${known.join("|")})`;
  const address = `${name}(?:\\s*(?:아|야|님))?`;
  const punctuation = "[,，!！:：;；、.。?？]+";
  // 굵은 호칭의 닫는 기호만 소비해 본문에서 시작하는 강조는 유지한다.
  const opening = new RegExp(`^\\s*(?:(?:\\*\\*\\s*${address}\\s*${punctuation}\\s*\\*\\*|\\*\\*\\s*${address}\\s*\\*\\*\\s*(?:아|야|님)?\\s*${punctuation}|${address}\\s*${punctuation})\\s*)+`);
  const correction = /^(?:\s*검토 후 정정:\s*)+/;
  const content = known.length ? text.replace(opening,"") : text;
  const corrected = correction.test(content);
  const original = content.replace(correction,"");
  const filtered = conversationText(known.length ? original.replace(opening,"") : original);
  const body = known.length ? filtered.replace(opening,"") : filtered;
  const reply = body && recipientName ? `${recipientName}, ${body}` : body;
  return reply && corrected ? `검토 후 정정: ${reply}` : reply;
}
