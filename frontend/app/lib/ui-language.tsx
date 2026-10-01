"use client";
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import { localeStorageKey, normalizeLocale, translateUi } from "./ui-locale.mjs";

type Locale = "ko" | "en";
let memoryLocale: Locale = "ko";
const eventName = "freelance-ops-ui-language";
function readLocale(): Locale {
  try { return normalizeLocale(localStorage.getItem(localeStorageKey)) as Locale; } catch { return memoryLocale; }
}
function subscribe(onChange: () => void) {
  window.addEventListener(eventName, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(eventName, onChange); window.removeEventListener("storage", onChange); };
}
const LocaleContext = createContext<Locale>("ko");
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readLocale, () => "ko" as Locale);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function useUiLocale() { return useContext(LocaleContext); }
export function useT() {
  const locale = useUiLocale();
  return useCallback((source: string | null | undefined, values: Record<string, string | number> = {}) => translateUi(source ?? "", locale, values), [locale]);
}
export function LanguageSelector() {
  const locale = useUiLocale();
  const t = useT();
  return <label className="ui-language-selector"><span className="sr-only">{t("표시 언어")}</span><select aria-label={t("표시 언어")} value={locale} onChange={event => {
    memoryLocale = normalizeLocale(event.target.value) as Locale;
    try { localStorage.setItem(localeStorageKey, memoryLocale); } catch { /* This tab still keeps the choice. */ }
    window.dispatchEvent(new Event(eventName));
  }}><option value="ko" lang="ko">한국어</option><option value="en" lang="en">English</option></select></label>;
}
export function SkipLink() { const t = useT(); return <a className="skip-link" href="#main-content">{t("본문으로 건너뛰기")}</a>; }
