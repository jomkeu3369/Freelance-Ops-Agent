"use client";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { CaretDown, Check, Globe } from "@phosphor-icons/react";
import { localeStorageKey, normalizeLocale, translateUi } from "./ui-locale.mjs";

type Locale = "ko" | "en";
let memoryLocale: Locale = "ko";
let memoryOverride = false;
const eventName = "freelance-ops-ui-language";
const defaultSiteTitle = "Freelance Ops | 근거 있는 견적 운영";
function writeLocale(value: Locale) {
  memoryLocale = value;
  try { localStorage.setItem(localeStorageKey, memoryLocale); memoryOverride = false; } catch { memoryOverride = true; }
  window.dispatchEvent(new Event(eventName));
}
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
    // This provider only lives on the landing route. Restore the unchanged
    // production workspace's language and skip link when leaving the page.
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
  const [open, setOpen] = useState(false);
  const [activeLocale, setActiveLocale] = useState<Locale>(locale);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const languages = [{ value: "ko", label: "한국어" }, { value: "en", label: "English" }] as const;

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onOutsidePointer);
    return () => document.removeEventListener("pointerdown", onOutsidePointer);
  }, [open]);

  function openList() {
    setActiveLocale(locale);
    setOpen(true);
  }
  function closeList() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  function selectLocale(value: Locale) {
    writeLocale(value);
    closeList();
  }

  return <div ref={rootRef} className="home-language" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={triggerRef} className="home-language-trigger" type="button" aria-label={`${t("표시 언어")}: ${locale === "ko" ? "한국어" : "English"}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => open ? closeList() : openList()} onKeyDown={event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openList(); }
    }}>
      <Globe className="home-language-globe" size={16} aria-hidden="true" />
      <span lang={locale}>{locale === "ko" ? "한국어" : "English"}</span>
      <CaretDown className="home-language-caret" size={12} aria-hidden="true" />
    </button>
    {open && <div ref={listRef} id={listId} className="home-language-list" role="listbox" tabIndex={0} aria-label={t("표시 언어")} aria-activedescendant={`${listId}-${activeLocale}`} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeList(); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveLocale(value => value === "ko" ? "en" : "ko"); }
      else if (event.key === "Home" || event.key === "End") { event.preventDefault(); setActiveLocale(event.key === "Home" ? "ko" : "en"); }
      else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectLocale(activeLocale); }
      else if (event.key.toLowerCase() === "e") setActiveLocale("en");
      else if (event.key === "한" || event.key.toLowerCase() === "k") setActiveLocale("ko");
    }}>
      {languages.map(language => <button key={language.value} id={`${listId}-${language.value}`} type="button" role="option" tabIndex={-1} aria-selected={locale === language.value} className={`home-language-option${activeLocale === language.value ? " is-active" : ""}`} onPointerMove={() => setActiveLocale(language.value)} onClick={() => selectLocale(language.value)}>
        <span lang={language.value}>{language.label}</span>
        {locale === language.value && <Check size={15} weight="bold" aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}
export function SkipLink() { const t = useT(); return <a className="skip-link" href="#main-content">{t("본문으로 건너뛰기")}</a>; }
