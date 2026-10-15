import { englishUi } from "./ui-english.mjs";

export const localeStorageKey = "freelance-ops-ui-locale-v1";
export const supportedLocales = ["ko", "en"];
export function normalizeLocale(value) {
  return supportedLocales.includes(value) ? value : "ko";
}
// 명시적으로 표시한 화면 문구만 번역 사전에 넣고 사용자 내용은 넣지 않는다.
export function translateUi(source, locale = "ko", values = {}) {
  const text = locale === "en" ? (englishUi[source] ?? source) : source;
  return text.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(values, key) ? String(values[key]) : match));
}
