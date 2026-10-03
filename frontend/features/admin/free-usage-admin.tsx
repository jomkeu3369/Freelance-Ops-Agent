"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, AuthSession, FreeUsageSettings, getFreeUsageSettings, loadSession, resetAllFreeUsage, saveSession, subscribeToSessionRecovery, updateFreeUsageLimit } from "../../app/lib/api";
import { parseFreeUsageLimit } from "../../app/lib/free-usage.mjs";
import { LanguageSelector, useT } from "../../app/lib/ui-language";
import { AuthGate } from "../workspace/auth/auth-gate";
import { useDialogFocusTrap } from "../workspace/shared/use-dialog-focus-trap";
import "../workspace/auth/auth.css";
import "../workspace/usage/free-usage.css";

type Change = { kind: "limit"; limit: number } | { kind: "reset" };

export function FreeUsageAdmin() {
  const t = useT();
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [settings, setSettings] = useState<FreeUsageSettings | null>(null);
  const [limit, setLimit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const mutationPending = useRef(false);
  const [change, setChange] = useState<Change | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  useDialogFocusTrap(dialog, () => setChange(null), busy, change !== null, true);

  useEffect(() => {
    Promise.resolve().then(() => { setSession(loadSession()); setHydrated(true); });
    return subscribeToSessionRecovery(next => { setSession(next); if (!next) { setSettings(null); setChange(null); } });
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getFreeUsageSettings(session).then(value => {
      if (cancelled) return;
      setSettings(value); setLimit(String(value.limit)); setForbidden(false); setError(null); setLoading(false);
    }).catch(cause => {
      if (cancelled) return;
      setSettings(null); setChange(null); setLoading(false);
      if (cause instanceof ApiError && cause.status === 403) setForbidden(true);
      else setError("관리자 설정을 확인하지 못했습니다. 다시 확인해 주세요.");
    });
    return () => { cancelled = true; };
  }, [session, retry]);

  function prepareLimit(event: FormEvent) {
    event.preventDefault();
    if (!settings || busy) return;
    const value = parseFreeUsageLimit(limit, settings.maxLimit);
    setMessage(null);
    if (value === null) { setError("허용 범위 안의 정수만 입력해 주세요."); return; }
    if (value === settings.limit) return;
    setError(null); setAcknowledged(false); setChange({ kind: "limit", limit: value });
  }

  async function applyChange() {
    if (!session || !settings || !change || !acknowledged || mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true); setError(null); setMessage(null);
    try {
      const next = change.kind === "limit" ? await updateFreeUsageLimit(session, settings, change.limit) : await resetAllFreeUsage(session, settings);
      setSettings(next); setLimit(String(next.limit)); setChange(null); setAcknowledged(false);
      setMessage(change.kind === "limit" ? "월간 무료 분석 한도를 변경했습니다." : "모든 계정의 이번 달 무료 사용량을 초기화했습니다.");
    } catch (cause) {
      setChange(null); setAcknowledged(false);
      if (cause instanceof ApiError && cause.status === 403) { setSettings(null); setForbidden(true); }
      else if (cause instanceof ApiError && cause.status === 409) {
        setSettings(null); setLoading(true); setRetry(value => value + 1);
        setMessage("다른 관리자가 설정을 변경했습니다. 최신 값을 확인한 뒤 다시 승인해 주세요.");
      } else {
        setSettings(null);
        setError("변경 결과를 확인하지 못했습니다. 다시 확인해 현재 값을 검토한 뒤 진행하세요.");
      }
    } finally { mutationPending.current = false; setBusy(false); }
  }

  if (!hydrated) return <main className="free-usage-admin"><p role="status">{t("관리자 권한 확인 중…")}</p></main>;
  if (!session) return <AuthGate error={error} setError={setError} onAuthenticated={async next => { saveSession(next); setSettings(null); setLoading(true); setForbidden(false); setSession(next); }} />;
  return <main id="main-content" className="free-usage-admin">
    <header className="free-usage-admin-header"><Link href="/workspace/settings">{t("작업 공간으로 돌아가기")}</Link><LanguageSelector /></header>
    <h1>{t("사이트 관리자")}</h1>
    {forbidden ? <section role="alert"><h2>{t("접근 권한이 없습니다.")}</h2><p>{t("사이트 관리자 권한이 필요합니다. 작업 공간 관리자 권한으로는 접근할 수 없습니다.")}</p></section> : <>
      {loading && <p role="status">{t("관리자 권한 확인 중…")}</p>}
      {error && <p className="free-usage-warning" role="alert">{t(error)}</p>}
      {message && <p role="status">{t(message)}</p>}
      {!loading && <button type="button" className="secondary-button" disabled={busy} onClick={() => { setSettings(null); setChange(null); setLoading(true); setRetry(value => value + 1); }}>{t("다시 확인")}</button>}
      {settings && !loading && <section className="free-usage-admin-card" aria-labelledby="admin-quota-title">
        <h2 id="admin-quota-title">{t("월간 무료 분석 관리")}</h2>
        <p>{t("모든 계정에 적용됩니다. 계정별 사용량은 매월 1일 00:00 (Asia/Seoul)에 초기화됩니다.")}</p>
        <p className="free-usage-warning">{t("한도를 늘리거나 사용량을 초기화하면 무료 AI 호출이 추가되어 서비스 운영 비용이 증가할 수 있습니다.")}</p>
        <form onSubmit={prepareLimit} noValidate>
          <label htmlFor="admin-free-limit">{t("계정당 월간 무료 분석 한도")}<input id="admin-free-limit" type="number" min={0} max={settings.maxLimit} step={1} inputMode="numeric" value={limit} disabled={busy} aria-describedby="admin-limit-help" onChange={event => setLimit(event.target.value)} /></label>
          <p id="admin-limit-help">{t("0~{max}회 사이의 정수. 0은 새 무료 분석 시작을 일시 중지합니다. 이미 사용한 횟수는 유지됩니다.", { max: settings.maxLimit })}</p>
          <button type="submit" className="primary-button" disabled={busy || parseFreeUsageLimit(limit, settings.maxLimit) === settings.limit}>{t("한도 변경 검토")}</button>
        </form>
        <hr />
        <h3>{t("전체 계정 사용량 초기화")}</h3>
        <p>{t("이번 달 모든 계정의 사용·예약 횟수를 새로 시작합니다. 실행 기록은 삭제하지 않습니다.")}</p>
        <p>{t("이미 진행 중인 분석은 계속 실행되며 이전 사용량에 기록됩니다. 새 할당량에서 다시 차감하지 않아 추가 비용이 발생할 수 있습니다.")}</p>
        {settings.lastResetAt && <p>{t("최근 전체 초기화: {date}", { date: settings.lastResetAt })}</p>}
        <button type="button" className="danger-button" disabled={busy} onClick={() => { setError(null); setMessage(null); setAcknowledged(false); setChange({ kind: "reset" }); }}>{t("전체 초기화 검토")}</button>
      </section>}
    </>}
    {change && settings && !forbidden && <div className="free-usage-backdrop">
      <section ref={dialog} className="free-usage-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title" aria-describedby="admin-confirm-description" aria-busy={busy}>
        <h2 id="admin-confirm-title">{change.kind === "reset" ? t("전체 계정 사용량을 초기화할까요?") : t("월간 한도를 변경할까요?")}</h2>
        <p id="admin-confirm-description">{change.kind === "limit" ? t("모든 계정의 월간 무료 분석 한도: {before} → {after}회", { before: settings.limit, after: change.limit }) : t("이번 달 모든 계정의 사용·예약 횟수를 새로 시작합니다. 실행 기록은 삭제하지 않습니다.")}</p>
        <p className="free-usage-warning">{t("한도를 늘리거나 사용량을 초기화하면 무료 AI 호출이 추가되어 서비스 운영 비용이 증가할 수 있습니다.")}</p>
        {change.kind === "reset" && <>
          <p>{t("초기화 후 계정당 이번 달 무료 한도는 {limit}회입니다.", { limit: settings.limit })}</p>
          <p>{t("이미 진행 중인 분석은 계속 실행되며 이전 사용량에 기록됩니다. 새 할당량에서 다시 차감하지 않아 추가 비용이 발생할 수 있습니다.")}</p>
        </>}
        {change.kind === "limit" && change.limit === 0 && <p>{t("0으로 변경하면 새 무료 분석 시작이 일시 중지됩니다.")}</p>}
        <label className="free-usage-checkbox"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />{t("모든 계정에 미치는 영향과 추가 비용 가능성을 확인했습니다.")}</label>
        <div className="free-usage-actions"><button type="button" data-autofocus className="secondary-button" disabled={busy} onClick={() => setChange(null)}>{t("취소")}</button><button type="button" className={change.kind === "reset" ? "danger-button" : "primary-button"} disabled={!acknowledged || busy} onClick={applyChange}>{busy ? t("처리 중…") : change.kind === "reset" ? t("전체 초기화 승인") : t("한도 변경 승인")}</button></div>
      </section>
    </div>}
  </main>;
}
