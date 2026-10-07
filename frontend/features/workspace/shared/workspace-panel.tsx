import { ReactNode, useId, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { useT } from "../../../app/lib/ui-language";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

/** On-demand, modal reading surface. Unmounting restores the invoking control. */
export function WorkspacePanel({ title, children, onClose, className = "" }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const t = useT();
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  useDialogFocusTrap(panel, onClose, false, true, true);
  return <div className="workspace-panel-backdrop">
    <section ref={panel} className={`workspace-panel ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="workspace-panel-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("닫기")}><X size={21} /></button>
      </header>
      <div className="workspace-panel-content">{children}</div>
    </section>
  </div>;
}
