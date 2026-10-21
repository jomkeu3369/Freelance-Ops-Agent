import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type FormEvent } from "react";
import { ArrowRight, CheckCircle, CircleNotch, Warning } from "@phosphor-icons/react";
import { ApiError, AuthSession, RateCard, RateCardFolder, moveRateCardToFolder } from "../../../app/lib/api";
import { useT } from "../../../app/lib/ui-language";
import { rateCardFolderOptions, rateCardFolderPath } from "./rate-card-folders";
import { formatMoney } from "../shared/formatters";

interface RateCardBulkMoveProps {
  session: AuthSession;
  rateCards: RateCard[];
  visibleCards: RateCard[];
  folders: RateCardFolder[];
  canWrite: boolean;
  onChange: Dispatch<SetStateAction<RateCard[]>>;
  onPendingChange: (pending: boolean) => void;
}

export function RateCardBulkMove({ session, rateCards, visibleCards, folders, canWrite, onChange, onPendingChange }: RateCardBulkMoveProps) {
  const t = useT();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [destination, setDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<{ moved: number; unchanged: number } | null>(null);
  const [failures, setFailures] = useState<Array<{ id: string; message: string }>>([]);
  const pending = useRef(false);
  const interrupted = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ session, canWrite });
  const feedback = useRef<HTMLDivElement>(null);
  const selected = rateCards.filter((card) => selectedIds.includes(card.id));
  const allVisibleSelected = visibleCards.length > 0 && visibleCards.every((card) => selectedIds.includes(card.id));
  const hiddenCount = selected.filter((card) => !visibleCards.some((visible) => visible.id === card.id)).length;

  useEffect(() => { if (!canWrite) interrupted.current = true; latest.current = { session, canWrite }; }, [session, canWrite]);
  useEffect(() => {
    mounted.current = true;
    const protectMove = (event: BeforeUnloadEvent) => { if (pending.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protectMove);
    return () => { mounted.current = false; window.removeEventListener("beforeunload", protectMove); onPendingChange(false); };
  }, [onPendingChange]);
  useEffect(() => { if (notice || failures.length > 0) feedback.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); }, [notice, failures]);

  function toggle(id: string) {
    if (pending.current || !canWrite) return;
    setSelectedIds((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
    setNotice(null);
    setFailures([]);
  }

  async function move(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || pending.current || selected.length === 0 || destination === null || destination && !folders.some((folder) => folder.id === destination)) return;
    pending.current = true;
    interrupted.current = false;
    setBusy(true);
    onPendingChange(true);
    setProgress(0);
    setNotice(null);
    setFailures([]);
    const failed: Array<{ id: string; message: string }> = [];
    const completed = new Set<string>();
    let moved = 0;
    let unchanged = 0;
    try {
      for (const card of selected) {
        if (!mounted.current || interrupted.current || !latest.current.canWrite || latest.current.session.workspaceId !== session.workspaceId || latest.current.session.userId !== session.userId) break;
        try {
          const saved = await moveRateCardToFolder(latest.current.session, card.id, destination || null);
          if (!mounted.current || latest.current.session.workspaceId !== session.workspaceId || latest.current.session.userId !== session.userId) break;
          // 응답을 기다리는 동안 더 최신 목록을 받았다면 이전 메타데이터로 되돌리지 않는다.
          onChange((values) => values.map((value) => value.id === saved.id && value.version <= saved.version ? saved : value));
          if ((card.folderId ?? "") === destination && card.version === saved.version) unchanged += 1;
          else moved += 1;
          completed.add(card.id);
        } catch (cause) {
          failed.push({ id: card.id, message: cause instanceof ApiError && cause.status === 429 ? "요청이 많아 이동을 잠시 멈췄습니다. 잠시 후 남은 항목을 다시 이동해 주세요." : cause instanceof Error ? cause.message : "단가를 옮기지 못했습니다." });
          if (cause instanceof ApiError && [401, 403, 429].includes(cause.status)) break;
        }
        if (mounted.current) setProgress(completed.size + failed.length);
      }
      if (!mounted.current) return;
      setSelectedIds((values) => values.filter((id) => !completed.has(id)));
      setFailures(failed);
      setNotice({ moved, unchanged });
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); onPendingChange(false); }
    }
  }

  if (!canWrite) return <p className="permission-note" role="status">{t("단가를 변경할 권한이 없습니다. 등록된 단가와 활성 상태만 확인할 수 있습니다.")}</p>;

  return (
    <div className="rate-bulk-move" aria-busy={busy}>
      <form onSubmit={move} aria-label={t("선택 단가 폴더 이동")}>
        <p role="status">{t("{count}개 선택 · 현재 목록 밖 {hidden}개", { count: selected.length, hidden: hiddenCount })}</p>
        <div className="rate-bulk-actions">
          <button type="button" className="secondary-button" disabled={busy || visibleCards.length === 0} onClick={() => { if (pending.current) return; setSelectedIds((values) => allVisibleSelected ? values.filter((id) => !visibleCards.some((card) => card.id === id)) : [...new Set([...values, ...visibleCards.map((card) => card.id)])]); setFailures([]); setNotice(null); }}>{t(allVisibleSelected ? "현재 목록 선택 해제" : "현재 목록 모두 선택")}</button>
          <button type="button" className="secondary-button" disabled={busy || selected.length === 0} onClick={() => { if (pending.current) return; setSelectedIds([]); setFailures([]); setNotice(null); }}>{t("전체 선택 해제")}</button>
        </div>
        {selected.length > 0 && <details className="rate-bulk-selection"><summary>{t("선택한 단가 확인")}</summary><ul>{selected.map((card) => <li key={card.id}>{card.name}<small>{rateCardFolderPath(folders, card.folderId ?? null).map((folder) => folder.name).join(" / ") || t("미분류")}</small></li>)}</ul></details>}
        <label className="rate-bulk-destination">{t("이동할 폴더")}<select aria-label={t("이동할 폴더")} value={destination ?? "__choose__"} disabled={busy} onChange={(event) => setDestination(event.target.value === "__choose__" ? null : event.target.value)}>
          <option value="__choose__" disabled>{t("폴더를 선택하세요")}</option>
          <option value="">{t("미분류")}</option>
          {rateCardFolderOptions(folders).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select></label>
        <button type="submit" className="primary-button" disabled={busy || selected.length === 0 || destination === null || Boolean(destination && !folders.some((folder) => folder.id === destination))}>{busy ? <CircleNotch size={18} className="spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}{busy ? t("{count}개 처리 중", { count: progress }) : t("선택한 {count}개 이동", { count: selected.length })}</button>
        <p className="rate-library-hint">{t("선택은 검색·폴더 이동 중에도 유지됩니다. 단가 금액과 활성 상태는 그대로 유지됩니다.")}</p>
      </form>
      <div ref={feedback}>
        {notice && <div className="settings-saved" role="status"><CheckCircle size={18} aria-hidden="true" />{t("{moved}개 이동 완료 · {unchanged}개는 이미 같은 폴더입니다.", notice)}</div>}
        {failures.length > 0 && <div className="inline-error rate-bulk-errors" role="alert"><Warning size={18} aria-hidden="true" /><div><p>{t("일부 단가를 옮기지 못했습니다. 남은 선택 항목을 확인한 뒤 다시 시도해 주세요.")}</p><ul>{failures.map((failure) => <li key={failure.id}>{rateCards.find((card) => card.id === failure.id)?.name ?? failure.id}: {t(failure.message)}</li>)}</ul></div></div>}
      </div>
      {visibleCards.length === 0 ? <p className="rate-library-hint">{t("현재 목록에 선택할 단가가 없습니다.")}</p> : <div className="rate-bulk-list" role="group" aria-label={t("이동할 서비스 단가 선택")}>
        {visibleCards.map((card) => <label key={card.id} aria-label={card.name}><input type="checkbox" checked={selectedIds.includes(card.id)} disabled={busy} onChange={() => toggle(card.id)} /><span><strong>{card.name}</strong><small>{rateCardFolderPath(folders, card.folderId ?? null).map((folder) => folder.name).join(" / ") || t("미분류")}</small><small>{card.active ? t("사용 중") : t("비활성")} · {card.unit === "FIXED" ? t("{v0} / 건", { v0: formatMoney(card.rate, card.currency) }) : <>{formatMoney(card.rate, card.currency)} / {t(card.unit === "HOUR" ? "시간" : "일")}</>}</small></span></label>)}
      </div>}
    </div>
  );
}
