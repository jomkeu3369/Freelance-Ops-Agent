import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, Check, Globe } from "@phosphor-icons/react";
import { setUiLocale, useT, useUiLocale } from "../../app/lib/ui-language";

const languages = [{ value: "ko", code: "KO", label: "한국어" }, { value: "en", code: "EN", label: "English" }];

/** Workspace-only menu; public and authentication language controls keep their layout. */
export function WorkspaceLanguageMenu() {
  const locale = useUiLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialIndex = useRef(0);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelectorAll<HTMLButtonElement>("button")[initialIndex.current]?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={root} className="workspace-language-menu" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="workspace-language-trigger" aria-label={t("표시 언어")}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { initialIndex.current = languages.findIndex(item => item.value === locale); setOpen(value => !value); }}
      onKeyDown={event => {
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); initialIndex.current = event.key === "ArrowUp" ? languages.length - 1 : 0; setOpen(true);
        }
      }}>
      <Globe size={16} aria-hidden="true" /><span>{locale.toUpperCase()}</span><CaretDown size={11} aria-hidden="true" />
    </button>
    {open && <div ref={menu} id={id} className="workspace-language-options" role="menu" tabIndex={-1} aria-label={t("표시 언어")} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (current + 1) % items.length : event.key === "ArrowUp" ? (current + items.length - 1) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); items[next].focus(); }
    }}>
      {languages.map(item => <button key={item.value} type="button" role="menuitemradio" aria-checked={locale === item.value} tabIndex={-1}
        onClick={() => { setUiLocale(item.value); close(); }}>
        <span className="workspace-language-code">{item.code}</span><span lang={item.value}>{item.label}</span>{locale === item.value && <Check size={15} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}
