import { useState } from "react";
import { Gauge } from "@phosphor-icons/react";
import Link from "next/link";
import { AuthSession } from "../../../app/lib/api";
import { freeUsageResetLabel } from "../../../app/lib/free-usage.mjs";
import { isWeeklyCreditUsage } from "../../../app/lib/credit-policy";
import { useT, useUiLocale } from "../../../app/lib/ui-language";
import { WorkspacePanel } from "../shared/workspace-panel";
import { CreditUsageState, useCreditUsage } from "./use-credit-usage";

export function FreeUsageStatus({ session, revision = "", compact = false, state }: { session: AuthSession; revision?: string; compact?: boolean; state?: CreditUsageState }) {
  const t = useT();
  const locale = useUiLocale();
  const [showDetails, setShowDetails] = useState(false);
  const ownState = useCreditUsage(session, revision, !state);
  const { data, loading, failed, refresh } = state ?? ownState;
  const usage = isWeeklyCreditUsage(data) ? data : null;
  const content = <div className="free-usage-detail-content">
    {loading ? <p role="status">{t("주간 크레딧 확인 중…")}</p> : failed || !usage ? <p role="status">{t("주간 크레딧과 모델 가격을 확인하지 못했습니다.")} <button type="button" className="quiet-button" onClick={() => void refresh()}>{t("다시 확인")}</button></p> : <>
      <p className="free-usage-count" aria-live="polite">{t("이번 주 {remaining} / {limit} 크레딧 남음", { remaining: usage.remaining, limit: usage.limit })}</p>
      <p>{t("사용 {used} · 예약 {reserved} 크레딧", { used: usage.used, reserved: usage.reserved })}</p>
      <p>{t("계정 전체에서 공유하며 매주 월요일 00:00 (Asia/Seoul)에 초기화됩니다. 모델별 차감량은 보내기 전에 표시됩니다.")}</p>
      <small>{t("다음 초기화: {date} (한국 시간)", { date: freeUsageResetLabel(usage.resetAt, locale) ?? usage.resetAt })}</small>
      {usage.limit === 0 && <p>{t("현재 기본 제공 AI 시작이 일시 중지되어 있습니다.")}</p>}
      <p><button type="button" className="quiet-button" onClick={() => void refresh()}>{t("다시 확인")}</button></p>
      {usage.canManage && <p><Link href="/admin">{t("사이트 관리자")}</Link></p>}
    </>}
  </div>;
  if (compact) return <div className="free-usage-status compact">
    <button type="button" className="free-usage-trigger" aria-haspopup="dialog" aria-label={t("주간 크레딧")} onClick={() => setShowDetails(true)}>
      <Gauge size={16} aria-hidden="true" />
      <span>{loading ? t("크레딧 확인 중") : usage ? t("{remaining} 크레딧 남음", { remaining: usage.remaining }) : t("사용량 확인 필요")}</span>
    </button>
    {showDetails && <WorkspacePanel title={t("주간 크레딧")} className="chat-usage-panel" onClose={() => setShowDetails(false)}>{content}</WorkspacePanel>}
  </div>;
  return <section className="free-usage-status" aria-label={t("주간 크레딧")}><strong>{t("주간 크레딧")}</strong>{content}</section>;
}
