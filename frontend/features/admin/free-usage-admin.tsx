"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, AuthSession, loadSession, saveSession, subscribeToSessionRecovery } from "../../app/lib/api";
import { AdminSettingsRequests } from "../../app/lib/admin-settings-requests";
import { AiSpendingBudgets, AiSpendingModel, AiSpendingSettings, canonicalUsd, modelStartsPaused, parseAiSpendingSettings, parseUsdAmount, platformStartsPaused, spendingModelKey } from "../../app/lib/admin-ai-spending";
import { getAiSpendingSettings, updateAiSpendingBudgets, updateAiSpendingModel } from "../../app/lib/admin-ai-spending-api";
import { LanguageSelector, useT } from "../../app/lib/ui-language";
import { AuthGate } from "../workspace/auth/auth-gate";
import { useDialogFocusTrap } from "../workspace/shared/use-dialog-focus-trap";
import "../workspace/auth/auth.css";
import "../workspace/usage/free-usage.css";

type Change = ({ kind: "budgets"; after: AiSpendingBudgets } | { kind: "model"; before: AiSpendingModel; after: AiSpendingModel }) & { reviewed: AiSpendingSettings };
const emptyBudgets = { accountWeekUsd: "", globalDayUsd: "", globalWeekUsd: "" };
const budgetFields = [
  { key: "accountWeekUsd", id: "admin-account-week-usd", label: "계정당 주간 예산 (USD)" },
  { key: "globalDayUsd", id: "admin-global-day-usd", label: "전체 일간 예산 (USD)" },
  { key: "globalWeekUsd", id: "admin-global-week-usd", label: "전체 주간 예산 (USD)" }
] as const;
const staleMessage = "다른 관리자가 설정을 변경했습니다. 최신 값을 확인한 뒤 다시 승인해 주세요.";

// Keep the route/export stable; this page now controls monetary platform guards, not legacy credits.
export function FreeUsageAdmin() {
  const t = useT();
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [settings, setSettings] = useState<AiSpendingSettings | null>(null);
  const [budgets, setBudgets] = useState<AiSpendingBudgets>(emptyBudgets);
  const [modelDrafts, setModelDrafts] = useState<Record<string, { maxRunUsd: string; enabled: boolean }>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const requests = useRef(new AdminSettingsRequests());
  const [change, setChange] = useState<Change | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  useDialogFocusTrap(dialog, () => setChange(null), busy, change !== null, true);

  const installSettings = useCallback((next: AiSpendingSettings) => {
    setSettings(next);
    setBudgets({ accountWeekUsd: next.accountWeekUsd, globalDayUsd: next.globalDayUsd, globalWeekUsd: next.globalWeekUsd });
    setModelDrafts(Object.fromEntries(next.models.map(model => [spendingModelKey(model), { maxRunUsd: model.maxRunUsd, enabled: model.enabled }])));
    setChange(null); setAcknowledged(false); setForbidden(false); setError(null); setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    const guard = requests.current;
    const receiveSession = (next: AuthSession | null) => {
      if (!active) return;
      const changed = guard.setScope(next ? `${next.userId}:${next.workspaceId}` : null);
      setSession(next);
      if (changed) {
        setSettings(null); setBudgets(emptyBudgets); setModelDrafts({}); setChange(null); setAcknowledged(false);
        setBusy(false); setLoading(!!next); setMessage(null); setError(null); setForbidden(false);
      }
    };
    Promise.resolve().then(() => { if (active) { receiveSession(loadSession()); setHydrated(true); } });
    const unsubscribe = subscribeToSessionRecovery(receiveSession);
    const cleared = () => receiveSession(null);
    window.addEventListener("freelance-ops-session-cleared", cleared);
    return () => { active = false; unsubscribe(); window.removeEventListener("freelance-ops-session-cleared", cleared); guard.setScope(null); };
  }, []);

  useEffect(() => {
    if (!session) return;
    const request = requests.current.beginRead();
    if (request === null) return;
    let cancelled = false;
    getAiSpendingSettings(session).then(value => {
      if (cancelled || !requests.current.acceptsRead(request)) return;
      const next = parseAiSpendingSettings(value);
      if (!next) throw new Error("Invalid monetary settings contract");
      installSettings(next);
    }).catch(cause => {
      if (cancelled || !requests.current.acceptsRead(request)) return;
      setSettings(null); setChange(null); setAcknowledged(false); setLoading(false);
      if (cause instanceof ApiError && cause.status === 403) setForbidden(true);
      else setError("관리자 설정을 확인하지 못했습니다. 다시 확인해 주세요.");
    });
    return () => { cancelled = true; };
  }, [session, retry, installSettings]);

  function prepareBudgets(event: FormEvent) {
    event.preventDefault();
    if (!settings || busy) return;
    setMessage(null);
    if (budgetFields.some(({ key }) => parseUsdAmount(budgets[key], settings.maxBudgetUsd) === null)) {
      const legacyBudgetRemains = budgetFields.some(({ key }) => parseUsdAmount(settings[key], settings.maxBudgetUsd) === null && canonicalUsd(budgets[key]) === canonicalUsd(settings[key]));
      setError(legacyBudgetRemains ? "수정 상한을 초과한 기존 예산이 남아 있습니다. 저장하려면 세 예산을 모두 0~{max} USD 범위로 조정해 주세요." : "예산은 0~{max} USD, 소수점 이하 최대 8자리로 입력해 주세요."); return;
    }
    if (budgetFields.every(({ key }) => canonicalUsd(budgets[key]) === canonicalUsd(settings[key]))) return;
    setError(null); setAcknowledged(false); setChange({ kind: "budgets", after: { ...budgets }, reviewed: settings });
  }

  function prepareModel(event: FormEvent, model: AiSpendingModel) {
    event.preventDefault();
    if (!settings || busy) return;
    const draft = modelDrafts[spendingModelKey(model)];
    if (!draft || parseUsdAmount(draft.maxRunUsd, settings.maxModelRunUsd) === null) {
      setError("모델 한도는 0~{max} USD, 소수점 이하 최대 8자리로 입력해 주세요."); return;
    }
    if (canonicalUsd(draft.maxRunUsd) === canonicalUsd(model.maxRunUsd) && draft.enabled === model.enabled) return;
    setError(null); setMessage(null); setAcknowledged(false);
    setChange({ kind: "model", before: model, after: { ...model, ...draft }, reviewed: settings });
  }

  function reload() {
    if (busy) return;
    setSettings(null); setChange(null); setAcknowledged(false); setError(null); setLoading(true); setRetry(value => value + 1);
  }

  async function applyChange() {
    if (!session || !settings || !change || !acknowledged) return;
    if (settings.revision !== change.reviewed.revision) {
      setMessage(staleMessage); reload(); return;
    }
    const mutation = requests.current.beginMutation();
    if (mutation === null) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const value = change.kind === "budgets"
        ? await updateAiSpendingBudgets(session, change.reviewed.revision, change.after)
        : await updateAiSpendingModel(session, change.reviewed.revision, change.after);
      if (!requests.current.acceptsMutation(mutation)) return;
      const next = parseAiSpendingSettings(value);
      if (!next) throw new Error("Invalid monetary settings contract");
      installSettings(next);
      setMessage(change.kind === "budgets" ? "기본 AI 비용 예산을 변경했습니다." : "기본 AI 모델 설정을 변경했습니다.");
    } catch (cause) {
      if (!requests.current.acceptsMutation(mutation)) return;
      setChange(null); setAcknowledged(false); setSettings(null);
      if (cause instanceof ApiError && cause.status === 403) setForbidden(true);
      else if (cause instanceof ApiError && cause.status === 409) {
        setLoading(true); setRetry(value => value + 1); setMessage(staleMessage);
      } else setError("변경 결과를 확인하지 못했습니다. 다시 확인해 현재 값을 검토한 뒤 진행하세요.");
    } finally {
      if (requests.current.acceptsMutation(mutation)) { requests.current.finishMutation(mutation); setBusy(false); }
    }
  }

  const budgetsUnchanged = settings && budgetFields.every(({ key }) => parseUsdAmount(budgets[key], settings.maxBudgetUsd) !== null && canonicalUsd(budgets[key]) === canonicalUsd(settings[key]));
  if (!hydrated) return <main className="free-usage-admin"><p role="status">{t("관리자 권한 확인 중…")}</p></main>;
  if (!session) return <AuthGate error={error} setError={setError} onAuthenticated={async next => {
    requests.current.setScope(`${next.userId}:${next.workspaceId}`); saveSession(next);
    setSettings(null); setChange(null); setAcknowledged(false); setMessage(null); setError(null); setLoading(true); setForbidden(false); setSession(next);
  }} />;
  return <main id="main-content" className="free-usage-admin">
    <header className="free-usage-admin-header"><Link href="/workspace/settings">{t("작업 공간으로 돌아가기")}</Link><LanguageSelector /></header>
    <h1>{t("사이트 관리자")}</h1>
    <p><Link href="/admin/notices">{t("운영 공지 및 메일 관리")}</Link></p>
    {forbidden ? <section role="alert"><h2>{t("접근 권한이 없습니다.")}</h2><p>{t("사이트 관리자 권한이 필요합니다. 작업 공간 관리자 권한으로는 접근할 수 없습니다.")}</p></section> : <>
      {loading && <p role="status">{t("관리자 권한 확인 중…")}</p>}
      {error && <p className="free-usage-warning" role="alert">{t(error, { max: error.startsWith("모델") ? settings?.maxModelRunUsd ?? "100" : settings?.maxBudgetUsd ?? "100000" })}</p>}
      {message && <p role="status">{t(message)}</p>}
      {!loading && <button type="button" className="secondary-button" disabled={busy} onClick={reload}>{t("다시 확인")}</button>}
      {settings && !loading && <section className="free-usage-admin-card" aria-labelledby="admin-spending-title">
        <h2 id="admin-spending-title">{t("기본 AI 비용 관리")}</h2>
        <p>{t("모든 금액은 USD(미국 달러)입니다. 계정당 주간 예산과 전체 계정 합산 일간·주간 예산을 관리합니다.")}</p>
        <p>{t("일간 예산은 매일 00:00, 주간 예산은 매주 월요일 00:00 (Asia/Seoul)에 새 기간이 시작됩니다.")}</p>
        <p>{t("비용 집행 상태 (읽기 전용): {state}", { state: settings.spendingEnabled ? t("켜짐") : t("꺼짐") })}</p>
        {!settings.spendingEnabled && <p className="free-usage-warning">{t("서버에서 기본 AI 비용 집행이 꺼져 있습니다. 예산·모델 설정을 저장해도 비용 집행은 켜지지 않습니다.")}</p>}
        {platformStartsPaused(settings) && <p>{t("새 기본 AI 시작이 일시 중지된 상태입니다.")}</p>}
        <p>{t("0 예산, 0 모델 한도 또는 모델 사용 중지는 새 기본 AI 시작에만 적용됩니다. 이미 진행 중인 실행을 취소하지 않습니다.")}</p>
        <p>{t("이미 확정된 비용과 진행 중·비용 미확인 실행의 예약액은 유지됩니다. 한도를 낮춰도 사용량이나 예약액은 초기화·환불되지 않습니다.")}</p>
        <p>{t("개인 API 키(BYOK)의 개인 비용 한도와 제공사 청구는 별도로 적용됩니다.")}</p>
        {budgetFields.some(({ key }) => parseUsdAmount(settings[key], settings.maxBudgetUsd) === null) && <p className="free-usage-warning">{t("기존 예산 중 현재 수정 상한을 초과한 값이 있습니다. 저장된 값은 그대로 표시하며, 예산 변경 시 세 예산을 모두 0~{max} USD 범위로 조정해야 합니다.", { max: settings.maxBudgetUsd })}</p>}
        <form onSubmit={prepareBudgets} noValidate>
          <div className="admin-budget-fields">
            {budgetFields.map(({ key, id, label }) => <label key={key} htmlFor={id}>{t(label)}
              <input id={id} type="text" inputMode="decimal" autoComplete="off" value={budgets[key]} disabled={busy} aria-describedby="admin-budget-help" onChange={event => setBudgets(current => ({ ...current, [key]: event.target.value }))} />
            </label>)}
          </div>
          <p id="admin-budget-help">{t("각 예산은 0~{max} USD, 소수점 이하 최대 8자리입니다. 하나라도 0이면 새 기본 AI 시작을 일시 중지합니다.", { max: settings.maxBudgetUsd })}</p>
          <button type="submit" className="primary-button" disabled={busy || !!budgetsUnchanged}>{t("예산 변경 검토")}</button>
        </form>
        <hr />
        <h3>{t("모델별 실행 한도·사용 가능 여부")}</h3>
        <p>{t("실행당 최대 비용은 실제 요금이나 정액 가격이 아닌 비용 예약 한도입니다. 0 또는 사용 중지는 해당 모델의 새 기본 AI 시작을 일시 중지합니다.")}</p>
        <p id="admin-model-help">{t("모델 한도는 0~{max} USD, 소수점 이하 최대 8자리입니다.", { max: settings.maxModelRunUsd })}</p>
        {settings.models.map(model => {
          const key = spendingModelKey(model);
          const draft = modelDrafts[key] ?? { maxRunUsd: model.maxRunUsd, enabled: model.enabled };
          const unchanged = parseUsdAmount(draft.maxRunUsd, settings.maxModelRunUsd) !== null && canonicalUsd(draft.maxRunUsd) === canonicalUsd(model.maxRunUsd) && draft.enabled === model.enabled;
          return <form key={key} className="admin-model-rate" onSubmit={event => prepareModel(event, model)} noValidate>
            <strong>{model.provider} · {model.model}</strong>
            <p>{modelStartsPaused(model) ? t("이 모델의 새 기본 AI 시작: 일시 중지") : t("이 모델의 새 기본 AI 시작: 예산·서버 상태에 따라 사용 가능")}</p>
            <label>{t("실행당 최대 비용 (USD)")}<input type="text" inputMode="decimal" autoComplete="off" value={draft.maxRunUsd} disabled={busy} aria-describedby="admin-model-help" onChange={event => setModelDrafts(current => ({ ...current, [key]: { ...draft, maxRunUsd: event.target.value } }))} /></label>
            <label className="free-usage-checkbox"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => setModelDrafts(current => ({ ...current, [key]: { ...draft, enabled: event.target.checked } }))} />{t("기본 제공 AI에서 사용 가능")}</label>
            <button type="submit" className="secondary-button" disabled={busy || unchanged}>{t("모델 설정 변경 검토")}</button>
          </form>;
        })}
      </section>}
    </>}
    {change && settings && !forbidden && <div className="free-usage-backdrop">
      <section ref={dialog} className="free-usage-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title" aria-describedby="admin-confirm-description" aria-busy={busy}>
        <h2 id="admin-confirm-title">{change.kind === "budgets" ? t("기본 AI 예산을 변경할까요?") : t("기본 AI 모델 설정을 변경할까요?")}</h2>
        <p id="admin-confirm-description">{t("검토한 USD 설정과 새 실행에 미치는 영향을 확인해 주세요.")}</p>
        {change.kind === "budgets" ? budgetFields.map(({ key, label }) => <p key={key}>{t(label)}: {change.reviewed[key]} → {change.after[key]}</p>) : <>
          <p>{change.after.provider} · {change.after.model}</p>
          <p>{t("실행당 최대 비용: {before} → {after} USD", { before: change.before.maxRunUsd, after: change.after.maxRunUsd })}</p>
          <p>{t("사용 가능 여부: {before} → {after}", { before: change.before.enabled ? t("사용 가능") : t("사용 중지"), after: change.after.enabled ? t("사용 가능") : t("사용 중지") })}</p>
        </>}
        {(change.kind === "budgets" ? budgetFields.some(({ key }) => canonicalUsd(change.after[key]) === "0") : modelStartsPaused(change.after)) && <p className="free-usage-warning">{change.kind === "budgets" ? t("0 예산으로 새 기본 AI 시작을 일시 중지합니다.") : t("이 모델의 새 기본 AI 시작을 일시 중지합니다.")}</p>}
        <p className="free-usage-warning">{t("예산·모델 한도·사용 가능 여부를 변경하면 모든 계정의 새 기본 AI 실행과 운영 비용에 영향을 줄 수 있습니다.")}</p>
        <p>{t("이미 확정된 비용과 진행 중·비용 미확인 실행의 예약액은 유지됩니다. 한도를 낮춰도 사용량이나 예약액은 초기화·환불되지 않습니다.")}</p>
        <p>{t("개인 API 키(BYOK)의 개인 비용 한도와 제공사 청구는 별도로 적용됩니다.")}</p>
        {!change.reviewed.spendingEnabled && <p>{t("서버에서 기본 AI 비용 집행이 꺼져 있습니다. 예산·모델 설정을 저장해도 비용 집행은 켜지지 않습니다.")}</p>}
        <label className="free-usage-checkbox"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />{t("모든 계정에 미치는 영향과 추가 비용 가능성을 확인했습니다.")}</label>
        <div className="free-usage-actions"><button type="button" data-autofocus className="secondary-button" disabled={busy} onClick={() => setChange(null)}>{t("취소")}</button><button type="button" className="primary-button" disabled={!acknowledged || busy} onClick={applyChange}>{busy ? t("처리 중…") : t("변경 승인")}</button></div>
      </section>
    </div>}
  </main>;
}
