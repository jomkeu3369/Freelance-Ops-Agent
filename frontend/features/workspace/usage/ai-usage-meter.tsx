import { useCallback, useEffect, useId, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { AuthSession, getAiUsageHistory } from "../../../app/lib/api";
import { AiUsageHistoryItem, formatUsagePercent, parseAiUsageHistory } from "../../../app/lib/ai-usage-presentation";
import { freeUsageResetLabel } from "../../../app/lib/free-usage.mjs";
import { useT, useUiLocale } from "../../../app/lib/ui-language";
import { WorkspacePanel } from "../shared/workspace-panel";
import { AiUsageState } from "./use-ai-usage";

export function AiUsageMeter({ session, state }: { session: AuthSession; state: AiUsageState }) {
  const t = useT(); const locale = useUiLocale(); const id = useId();
  const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const { data: usage, loading, refresh } = state;
  const [open, setOpen] = useState(false); const [historyOpen, setHistoryOpen] = useState(false);
  const [items, setItems] = useState<AiUsageHistoryItem[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false); const [historyFailed, setHistoryFailed] = useState(false);
  const historyLock = useRef(false); const mounted = useRef(true);
  const suppressHint = useRef(false);
  const pinned = useRef(false);
  const restoreTrigger = useCallback(() => {
    suppressHint.current = true;
    requestAnimationFrame(() => { trigger.current?.focus(); suppressHint.current = false; });
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) { pinned.current = false; setOpen(false); } };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { pinned.current = false; setOpen(false); if (root.current?.contains(document.activeElement)) restoreTrigger(); }
    };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, restoreTrigger]);
  async function loadHistory(nextCursor?: string) {
    if (historyLock.current) return;
    historyLock.current = true; setHistoryLoading(true); setHistoryFailed(false);
    try {
      const page = parseAiUsageHistory(await getAiUsageHistory(session, nextCursor));
      if (!page) throw new Error("Unrecognized usage history");
      if (mounted.current) { setItems(previous => nextCursor ? [...previous, ...page.items] : page.items); setCursor(page.nextCursor); }
    } catch { if (mounted.current) setHistoryFailed(true); }
    finally { historyLock.current = false; if (mounted.current) setHistoryLoading(false); }
  }
  const remaining = usage && Number(usage.limitUsd) > 0 ? usage.remainingPercent : null;
  const label = loading ? t("사용량 확인 중…") : !usage ? t("사용량 확인 필요") : Number(usage.limitUsd) === 0 ? t("주간 한도가 설정되지 않았습니다.") : t("주간 잔여 {percent}", { percent: formatUsagePercent(remaining, locale) });
  return <div className="chat-credit-control" ref={root} onPointerEnter={event => { if (event.pointerType === "mouse" && !historyOpen) setOpen(true); }}
    onPointerLeave={() => { if (!pinned.current && !root.current?.contains(document.activeElement)) setOpen(false); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { pinned.current = false; setOpen(false); } }}>
    <button ref={trigger} type="button" className="chat-credit-trigger" aria-label={`${t("주간 사용량")}: ${label}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onFocus={event => { if (event.currentTarget.matches(":focus-visible") && !historyOpen && !suppressHint.current) setOpen(true); }} onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current); }}>
      <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
        <circle className="chat-credit-track" cx="16" cy="16" r="12" fill="none" strokeWidth="3" />
        {remaining !== null && <circle className="chat-credit-progress" cx="16" cy="16" r="12" fill="none" strokeWidth="3" pathLength="100" strokeDasharray={`${remaining} 100`} transform="rotate(-90 16 16)" />}
        {remaining === null && <text x="16" y="20" textAnchor="middle">{loading ? "…" : usage ? "—" : "?"}</text>}
      </svg>
    </button>
    {open && <div id={id} role="dialog" aria-label={t("주간 사용량")} className="chat-credit-popover">
      <div className="chat-credit-heading"><strong>{label}</strong><button type="button" className="chat-credit-close" aria-label={t("닫기")} onClick={() => { pinned.current = false; setOpen(false); restoreTrigger(); }}><X size={15} aria-hidden="true" /></button></div>
      {usage && <>
        <p>{t("진행 중 예약 {percent}", { percent: formatUsagePercent(Number(usage.limitUsd) > 0 ? usage.reservedPercent : null, locale) })}</p>
        <small>{t("정확한 서버 비율: 잔여 {remaining}% · 예약 {reserved}%", { remaining: usage.remainingPercent ?? "—", reserved: usage.reservedPercent ?? "—" })}</small>
        <small>{t("≈ 표시는 소수점 둘째 자리로 반올림한 값입니다.")}</small>
        <p>{t("다음 초기화: {date} (한국 시간)", { date: freeUsageResetLabel(usage.resetAt, locale) ?? usage.resetAt })}</p>
      </>}
      {!loading && !usage && <p role="status">{t("사용량 서버 응답을 확인하지 못했습니다. 잔여 비율을 추정하지 않습니다.")}</p>}
      <div className="chat-credit-links">
        <button type="button" onClick={() => { pinned.current = false; setOpen(false); setHistoryOpen(true); void loadHistory(); }}>{t("사용 내역")}</button>
        <button type="button" disabled={loading} onClick={() => void refresh()}>{t("다시 확인")}</button>
      </div>
    </div>}
    {historyOpen && <WorkspacePanel title={t("사용 내역")} className="chat-usage-panel" onClose={() => { setHistoryOpen(false); setOpen(false); restoreTrigger(); }}>
      {usage && <p className="chat-usage-summary">{t("주간 예산 ${limit} · 정산 ${settled} · 예약 ${reserved} (USD)", { limit: usage.limitUsd, settled: usage.settledUsd, reserved: usage.reservedUsd })}</p>}
      <p className="model-selection-note">{t("비용과 비율의 상세값은 서버가 반환한 정밀도 그대로 표시됩니다. 사용량 미확정 요청의 예약은 유지됩니다.")}</p>
      {historyFailed && <p role="alert">{t("사용 내역을 불러오지 못했습니다.")} <button type="button" className="quiet-button" onClick={() => void loadHistory(items.length ? cursor ?? undefined : undefined)}>{t("다시 확인")}</button></p>}
      <ol className="chat-usage-history">{items.map((item, index) => <li key={`${item.runId}:${index}`}>
        <strong>{item.model}</strong><time dateTime={item.startedAt}>{freeUsageResetLabel(item.startedAt, locale) ?? item.startedAt}</time>
        <p>{item.status} · {item.usageKnown ? t("사용량 확인됨") : t("사용량 미확정 · 예약 유지")}</p>
        <p>{t("정산 ${settled} · 예약 ${reserved} (USD)", { settled: item.platformCostUsd ?? "—", reserved: item.platformReservedUsd ?? "—" })}</p>
        {(item.byokInputTokens != null || item.byokOutputTokens != null) && <p>{t("개인 키 토큰: 입력 {input} · 출력 {output}", { input: item.byokInputTokens ?? "—", output: item.byokOutputTokens ?? "—" })}</p>}
      </li>)}</ol>
      {historyLoading ? <p role="status">{t("사용 내역 확인 중…")}</p> : !historyFailed && !items.length ? <p>{t("이 기간의 사용 내역이 없습니다.")}</p> : null}
      {cursor && !historyFailed && <button type="button" className="quiet-button" disabled={historyLoading} onClick={() => void loadHistory(cursor)}>{t("더 보기")}</button>}
    </WorkspacePanel>}
  </div>;
}
