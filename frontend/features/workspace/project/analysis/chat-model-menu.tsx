import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { CaretDown, Sparkle } from "@phosphor-icons/react";
import { useT } from "../../../../app/lib/ui-language";

/** Local selection only. The explicit Send action remains the execution boundary. */
export function ChatModelMenu({ label, locked, contextKey, children }: { label: string; locked: boolean; contextKey: string; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const contextRef = useRef(contextKey);
  const visible = open && !locked;
  useEffect(() => {
    const changed = contextRef.current !== contextKey;
    contextRef.current = contextKey;
    if (!locked && !changed) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const restore = changed && !locked && (root.current?.contains(document.activeElement) || document.activeElement === document.body);
      setOpen(false);
      if (restore) trigger.current?.focus();
    });
    return () => { cancelled = true; };
  }, [contextKey, locked]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && root.current?.contains(document.activeElement)) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    if (!locked) panel.current?.querySelector<HTMLElement>("select:not(:disabled), button:not(:disabled)")?.focus();
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, locked]);
  return <div ref={root} className="chat-model-menu" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="quiet-button chat-model-trigger" disabled={locked}
      aria-label={`${t("AI 모델 선택")}: ${label}`} title={locked ? t("작업 중에는 AI 설정을 바꿀 수 없습니다.") : label}
      aria-haspopup="dialog" aria-expanded={visible} aria-controls={visible ? panelId : undefined}
      onClick={() => setOpen(value => !value)} onKeyDown={event => {
        if (event.key === "ArrowDown" && !locked) { event.preventDefault(); setOpen(true); }
      }}>
      <Sparkle size={16} aria-hidden="true" /><span>{label}</span><CaretDown size={12} aria-hidden="true" />
    </button>
    {visible && <div ref={panel} id={panelId} className="chat-model-popover" role="dialog" aria-label={t("AI 모델 선택")}>
      <strong>{t("AI 모델 선택")}</strong>
      {children}
    </div>}
  </div>;
}
