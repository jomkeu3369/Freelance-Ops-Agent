import { useEffect, useState } from "react";
import { Gauge } from "@phosphor-icons/react";
import { WorkspacePanel } from "../shared/workspace-panel";
import Link from "next/link";
import { AuthSession, FreeUsage, getFreeUsage } from "../../../app/lib/api";
import { freeUsageResetLabel } from "../../../app/lib/free-usage.mjs";
import { useT, useUiLocale } from "../../../app/lib/ui-language";

export function FreeUsageStatus({ session, revision = "", compact = false }: { session: AuthSession; revision?: string; compact?: boolean }) {
  const t = useT();
  const locale = useUiLocale();
  const [showDetails, setShowDetails] = useState(false);
  const [data, setData] = useState<FreeUsage | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getFreeUsage(session).then(value => { if (!cancelled) { setData(value); setFailed(false); } })
      .catch(() => { if (!cancelled) { setData(null); setFailed(true); } });
    return () => { cancelled = true; };
  }, [session, revision, retry]);
  const explanation = data ? <>
    <p>{t("계정 전체에서 공유하며 매월 1일 00:00 (Asia/Seoul)에 초기화됩니다. 완료 또는 부분 결과를 받은 분석을 차감하며 진행 중에는 횟수를 예약합니다.")}</p>
    <small>{t("다음 초기화: {date} (한국 시간)", { date: freeUsageResetLabel(data.resetAt, locale) ?? data.resetAt })}</small>
  </> : null;
  const adminLink = data?.canManage ? <p><Link href="/admin">{t("사이트 관리자")}</Link></p> : null;
  const content = <div className="free-usage-detail-content">
    {failed ? <p role="status">{t("무료 사용량을 확인하지 못했습니다.")} <button type="button" className="quiet-button" onClick={() => setRetry(value => value + 1)}>{t("다시 확인")}</button></p> : data ? <>
      <p className="free-usage-count" aria-live="polite">{t("사용 {used} / 월 {limit}회", { used: data.used, limit: data.limit })} · {t("예약 {reserved}회", { reserved: data.reserved })} · {t("남음 {remaining}회", { remaining: data.remaining })}</p>
      {explanation}
      {data.limit === 0 && <p>{t("현재 무료 분석 시작이 일시 중지되어 있습니다.")}</p>}
      {adminLink}
    </> : <p role="status">{t("무료 사용량 확인 중…")}</p>}
  </div>;
  if (compact) return <div className="free-usage-status compact">
    <button type="button" className="free-usage-trigger" aria-haspopup="dialog" aria-label={t("월간 무료 분석")} onClick={() => setShowDetails(true)}>
      <Gauge size={16} aria-hidden="true" />
      <span>{failed ? t("사용량 확인 필요") : data ? t("남음 {remaining}회", { remaining: data.remaining }) : t("사용량 확인 중")}</span>
    </button>
    {showDetails && <WorkspacePanel title={t("월간 무료 분석")} className="chat-usage-panel" onClose={() => setShowDetails(false)}>{content}</WorkspacePanel>}
  </div>;
  return <section className="free-usage-status" aria-label={t("월간 무료 분석")}><strong>{t("월간 무료 분석")}</strong>{content}</section>;
}
