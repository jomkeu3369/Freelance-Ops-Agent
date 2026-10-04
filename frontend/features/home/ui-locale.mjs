import { englishUi } from './ui-english.mjs';

export const localeStorageKey = 'freelance-ops-ui-locale-v1';
export const supportedLocales = ['ko', 'en'];
export function normalizeLocale(value) { return supportedLocales.includes(value) ? value : 'ko'; }
// Only explicitly marked interface strings enter this dictionary. User content never does.
export function translateUi(source, locale = 'ko', values = {}) {
  const text = locale === 'en' ? (englishUi[source] ?? source) : source;
  return text.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}
