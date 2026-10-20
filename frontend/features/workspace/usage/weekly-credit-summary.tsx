import Link from "next/link";
import { ArrowClockwise, ArrowUpRight, CalendarBlank, CircleNotch, Coins, Info } from "@phosphor-icons/react";
import { WeeklyCreditUsage } from "../../../app/lib/credit-policy";
import { freeUsageResetLabel } from "../../../app/lib/free-usage.mjs";
import { useT, useUiLocale } from "../../../app/lib/ui-language";
import { CreditUsageState } from "./use-credit-usage";

interface WeeklyCreditSummaryProps {
  usage: WeeklyCreditUsage | null;
  loading: boolean;
  failed: boolean;
  refresh: CreditUsageState["refresh"];
}

export function WeeklyCreditSummary({ usage, loading, failed, refresh }: WeeklyCreditSummaryProps) {
  const t = useT();
  const locale = useUiLocale();
  const number = new Intl.NumberFormat(locale === "en" ? "en-US" : "ko-KR");
  const percentage = usage && usage.limit > 0 ? Math.min(100, usage.remaining / usage.limit * 100) : 0;
  const percentageLabel = new Intl.NumberFormat(locale === "en" ? "en-US" : "ko-KR", {
    maximumFractionDigits: 1
  }).format(percentage);
  const available = !loading && !failed && usage;

  return (
    <section className="free-usage-status weekly-credit-summary" aria-label={t("주간 크레딧")} aria-busy={loading}>
      <div className="weekly-credit-card">
        <header className="weekly-credit-header">
          <div className="weekly-credit-heading">
            <span className="weekly-credit-icon"><Coins size={28} weight="regular" aria-hidden="true" /></span>
            <div>
              <h2>{t("주간 크레딧")}</h2>
              <p>{t("이번 주 사용 현황")}</p>
            </div>
          </div>
          <button type="button" className="quiet-button weekly-credit-refresh" aria-label={t("다시 확인")} disabled={loading} onClick={() => void refresh()}>
            <ArrowClockwise size={20} className={loading ? "spin" : undefined} aria-hidden="true" />
            <span>{t("다시 확인")}</span>
          </button>
        </header>

        {loading ? (
          <div className="weekly-credit-state" role="status">
            <CircleNotch className="spin" size={24} aria-hidden="true" />
            <p>{t("주간 크레딧 확인 중…")}</p>
          </div>
        ) : !available ? (
          <div className="weekly-credit-state" role="status">
            <Info size={26} aria-hidden="true" />
            <p>{t("주간 크레딧과 모델 가격을 확인하지 못했습니다.")}</p>
          </div>
        ) : (
          <>
            <div className="weekly-credit-overview">
              <div className="weekly-credit-balance">
                <p className="weekly-credit-label">{t("이번 주 남은 크레딧")}</p>
                <p className="free-usage-count weekly-credit-amount" aria-live="polite" aria-atomic="true">
                  <span className="sr-only">{t("이번 주 {remaining} / {limit} 크레딧 남음", { remaining: usage.remaining, limit: usage.limit })}</span>
                  <strong aria-hidden="true">{number.format(usage.remaining)}</strong>
                  <span className="weekly-credit-limit" aria-hidden="true">/ {t("{credits} 크레딧", { credits: number.format(usage.limit) })}</span>
                </p>
                <dl className="weekly-credit-metrics">
                  <div><dt>{t("사용한 크레딧")}</dt><dd>{number.format(usage.used)}</dd></div>
                  <div><dt>{t("예약된 크레딧")}</dt><dd>{number.format(usage.reserved)}</dd></div>
                </dl>
              </div>
              <div className="weekly-credit-visual">
                <div className="weekly-credit-gauge" role="meter" aria-label={t("남은 크레딧 비율")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${percentageLabel}%`}>
                  <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">
                    <circle className="weekly-credit-track" cx="80" cy="80" r="70" />
                    <circle className="weekly-credit-fill" cx="80" cy="80" r="70" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - percentage} strokeLinecap="round" transform="rotate(-90 80 80)" opacity={percentage > 0 ? 1 : 0} />
                  </svg>
                  <div className="weekly-credit-gauge-label" aria-hidden="true">
                    <strong>{percentageLabel}<span>%</span></strong>
                    <span>{usage.limit === 0 ? t("일시 중지") : t("사용 가능")}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="weekly-credit-reset">
              <CalendarBlank size={26} aria-hidden="true" />
              <div><span>{t("다음 초기화")}</span><strong>{freeUsageResetLabel(usage.resetAt, locale) ?? usage.resetAt}</strong></div>
              <p>{t("매주 월요일 00:00 · 한국 시간")}</p>
            </div>
            {usage.limit === 0 && <p className="weekly-credit-paused" role="status">{t("현재 기본 제공 AI 시작이 일시 중지되어 있습니다.")}</p>}
          </>
        )}
      </div>
      <div className="weekly-credit-notes">
        <p className="weekly-credit-note"><Info size={19} aria-hidden="true" /><span>{t("크레딧은 계정 전체에서 공유됩니다.")} {t("모델별 차감량은 보내기 전에 표시됩니다.")}</span></p>
        {available && usage.canManage && <Link href="/admin">{t("사이트 관리자")}<ArrowUpRight size={16} aria-hidden="true" /></Link>}
      </div>
    </section>
  );
}
