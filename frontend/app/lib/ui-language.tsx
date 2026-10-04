"use client";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import { localeStorageKey, normalizeLocale, translateUi } from "./ui-locale.mjs";

type Locale = "ko" | "en";
let memoryLocale: Locale = "ko";
let memoryOverride = false;
const eventName = "freelance-ops-ui-language";
const defaultSiteTitle = "Freelance Ops | 근거 있는 견적 운영";
function readLocale(): Locale {
  if (memoryOverride) return memoryLocale;
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
  const pathname = usePathname();
  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    const skipLink = document.querySelector<HTMLAnchorElement>("body > .skip-link");
    const previousSkipText = skipLink?.textContent ?? null;
    document.documentElement.lang = locale;
    if (skipLink) skipLink.textContent = translateUi("본문으로 건너뛰기", locale);
    // Next can commit metadata after hydration. Follow only shared-title changes,
    // including replacement title elements, without touching route-specific titles.
    const englishSiteTitle = translateUi(defaultSiteTitle, "en");
    const localizedTitle = translateUi(defaultSiteTitle, locale);
    const syncTitle = () => {
      const currentTitle = document.title;
      if ((currentTitle === defaultSiteTitle || currentTitle === englishSiteTitle) && currentTitle !== localizedTitle) {
        document.title = localizedTitle;
      }
    };
    const titleObserver = new MutationObserver(records => {
      if (records.some(record => record.target.nodeName === "TITLE"
        || record.target.parentNode?.nodeName === "TITLE"
        || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeName === "TITLE"))) {
        syncTitle();
      }
    });
    titleObserver.observe(document.head, { childList: true, characterData: true, subtree: true });
    syncTitle();
    return () => {
      titleObserver.disconnect();
      document.documentElement.lang = previousLanguage;
      if (skipLink) skipLink.textContent = previousSkipText;
      if (document.title === englishSiteTitle) document.title = defaultSiteTitle;
    };
  }, [locale, pathname]);
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
    try { localStorage.setItem(localeStorageKey, memoryLocale); memoryOverride = false; } catch { memoryOverride = true; }
    window.dispatchEvent(new Event(eventName));
  }}><option value="ko" lang="ko">한국어</option><option value="en" lang="en">English</option></select></label>;
}
export function SkipLink() { const t = useT(); return <a className="skip-link" href="#main-content">{t("본문으로 건너뛰기")}</a>; }
