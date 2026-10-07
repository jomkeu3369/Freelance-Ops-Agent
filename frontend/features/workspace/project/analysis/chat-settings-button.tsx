import { useId, useState } from "react";
import { GearSix } from "@phosphor-icons/react";
import { useT } from "../../../../app/lib/ui-language";

export function ChatSettingsButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  const id = useId();
  const [hint, setHint] = useState(false);
  return <span className="chat-settings-control" onPointerEnter={event => { if (event.pointerType === "mouse") setHint(true); }} onPointerLeave={() => setHint(false)}>
    <button type="button" className="quiet-button agent-chat-model-button" aria-label={t("AI 설정 열기")} aria-describedby={hint ? id : undefined}
      onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setHint(true); }} onBlur={() => setHint(false)}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setHint(false); } }}
      onClick={() => { setHint(false); onClick(); }}><GearSix size={18} aria-hidden="true" /></button>
    {hint && <span id={id} role="tooltip" className="chat-settings-tooltip">{t("AI 설정")}</span>}
  </span>;
}
