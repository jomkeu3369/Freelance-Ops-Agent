import { useT, useUiLocale } from "../../../../app/lib/ui-language";
import type { FormEvent } from "react";
import {
  AuthSession,
  Project,
  ActualOutcome,
  getOutcome,
  getProjectQuotation,
  saveOutcome
} from "../../../../app/lib/api";
import { useState, useEffect, useRef } from "react";
import {
  Graph,
  CircleNotch,
  Warning,
  CaretDown,
  Plus,
  Trash,
  PencilSimple,
  Clock,
  CheckCircle
} from "@phosphor-icons/react";
import { formatMoney } from "../../shared/formatters";
import { quotationScenarioLabels } from "../../shared/constants";
import { useQuotationHistory } from "../quotation/use-quotation-history";
import { quotationIdentity } from "../quotation/quotation-identity";
import { clearOutcomeDraft, outcomeDraftFromResult, readOutcomeDraft, writeOutcomeDraft, type OutcomeDraft } from "./outcome-draft";

interface OutcomeReviewProps {
  session: AuthSession;
  project: Project;
  permissions: Set<string>;
}

export function OutcomeReview({ session, project, permissions }: OutcomeReviewProps) {
  const t = useT();
  const locale = useUiLocale();
  const canRead = permissions.has("outcome.read");
  const canWrite = permissions.has("outcome.write");
  const canReadQuotations = permissions.has("quotation.read");
  const [outcome, setOutcome] = useState<ActualOutcome | null>(null);
  const { quotations, nextCursor, loadingMore, historyError, loadFirstPage, includeQuotation, loadMoreQuotations } =
    useQuotationHistory(session, project.id);
  const [draft, setDraft] = useState<OutcomeDraft>(() => outcomeDraftFromResult(null));
  const draftRef = useRef(draft);
  const instance = useRef({});
  const [draftStarted, setDraftStarted] = useState(false);
  const [draftUnavailable, setDraftUnavailable] = useState(false);
  const [cleanupUnavailable, setCleanupUnavailable] = useState(false);
  const [draftConflict, setDraftConflict] = useState(false);
  const [latestChecked, setLatestChecked] = useState(false);
  const draftKey = `freelance-ops-outcome-draft-v1:${encodeURIComponent(session.userId)}:${encodeURIComponent(session.workspaceId)}:${encodeURIComponent(project.id)}`;
  const { approvedQuotationId, workItems } = draft;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  function changeDraft(update: (current: OutcomeDraft) => OutcomeDraft) {
    if (!canWrite) return;
    const next = { ...update(draftRef.current), revision: window.crypto.randomUUID() };
    draftRef.current = next;
    setDraft(next);
    setDraftStarted(true);
    const available = writeOutcomeDraft(draftKey, next);
    setDraftUnavailable(!available);
    if (available) setCleanupUnavailable(false);
  }

  function setWorkItems(update: OutcomeDraft["workItems"] | ((current: OutcomeDraft["workItems"]) => OutcomeDraft["workItems"])) {
    changeDraft((current) => ({ ...current, workItems: typeof update === "function" ? update(current.workItems) : update }));
  }

  useEffect(() => {
    const handleSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; source: object }>).detail;
      if (detail.key === draftKey && detail.source !== instance.current) { setDraftConflict(true); setLatestChecked(false); }
    };
    window.addEventListener("freelance-ops-outcome-saved", handleSaved);
    return () => window.removeEventListener("freelance-ops-outcome-saved", handleSaved);
  }, [draftKey]);

  useEffect(() => {
    if (!draftStarted || !draftUnavailable) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftStarted, draftUnavailable]);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    Promise.all([
      getOutcome(session, project.id),
      canReadQuotations
        ? loadFirstPage().catch((cause: unknown) => {
            if (!cancelled) setError(cause instanceof Error ? cause.message : "견적 목록을 불러오지 못했습니다.");
            return [];
          })
        : Promise.resolve([])
    ])
      .then(async ([result, nextQuotations]) => {
        if (!cancelled) {
          setOutcome(result);
          const restored = canWrite ? readOutcomeDraft(draftKey) : { draft: null, unavailable: false, cleanupPending: false };
          const nextDraft = restored.draft ?? outcomeDraftFromResult(result);
          draftRef.current = nextDraft;
          setDraft(nextDraft);
          setDraftStarted(Boolean(restored.draft));
          setDraftUnavailable(restored.unavailable);
          setCleanupUnavailable(restored.cleanupPending);
          setDraftConflict(Boolean(restored.draft && (restored.draft.baseId !== (result?.id ?? null) || restored.draft.baseVersion !== (result?.version ?? null))));
          setLatestChecked(true);
          const selectedIds = [...new Set([result?.approvedQuotationId, nextDraft.approvedQuotationId].filter((id): id is string => Boolean(id)))];
          const selectedQuotations = canReadQuotations
            ? await Promise.all(selectedIds.map((id) => nextQuotations.find((quotation) => quotation.id === id) ??
              getProjectQuotation(session, project.id, id).catch((cause: unknown) => {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "기준 견적을 불러오지 못했습니다.");
                return null;
              })))
            : [];
          if (!cancelled) selectedQuotations.forEach((quotation) => { if (quotation) includeQuotation(quotation); });
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "결과를 불러오지 못했습니다.");
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, canReadQuotations, canWrite, draftKey, includeQuotation, loadAttempt, loadFirstPage, project.id, session]);

  if (!canRead)
    return (
      <div className="workspace-empty">
        <Graph size={38} />
        <h2>{t("프로젝트 결과를 볼 수 없습니다.")}</h2>
        <p>{t("결과 조회가 필요하다면 작업 공간 관리자에게 문의해 주세요.")}</p>
      </div>
    );
  if (loading)
    return (
      <div className="section-loading">
        <CircleNotch className="spin" /> {t("결과 기록을 확인하고 있습니다.")}
      </div>
    );
  if (loadFailed)
    return (
      <section className="outcome-load-error" role="alert">
        <Warning size={24} />
        <h2>{t("결과를 불러오지 못했습니다.")}</h2>
        <p>{t(error ?? "결과를 불러오지 못했습니다.")}</p>
        <button type="button" className="secondary-button" onClick={() => {
          setLoading(true);
          setLoadFailed(false);
          setError(null);
          setLoadAttempt((current) => current + 1);
        }}>
          {t("다시 불러오기")}
        </button>
      </section>
    );
  const approvedQuotation = outcome?.approvedQuotationId
    ? (quotations.find((quotation) => quotation.id === outcome.approvedQuotationId) ?? null)
    : null;
  const quotedHours =
    approvedQuotation?.items.filter((item) => item.unit === "HOUR").reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const revenueVariance = outcome && approvedQuotation ? outcome.totalRevenue - approvedQuotation.total : null;
  const hoursVariance = outcome && quotedHours > 0 ? outcome.actualHours - quotedHours : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || busy || loading || loadFailed || draftConflict) return;
    setBusy(true);
    setError(null);
    const submitted = draftRef.current;
    try {
      const latest = await getOutcome(session, project.id);
      if (submitted.baseId !== (latest?.id ?? null) || submitted.baseVersion !== (latest?.version ?? null)) {
        setOutcome(latest);
        setDraftConflict(true);
        setLatestChecked(true);
        return;
      }
      const savedOutcome = await saveOutcome(session, project.id, {
        approvedQuotationId: submitted.approvedQuotationId || null,
        totalRevenue: Number(submitted.totalRevenue),
        actualCost: Number(submitted.actualCost),
        actualHours: Number(submitted.actualHours),
        completedOn: submitted.completedOn || null,
        changeReason: submitted.changeReason,
        workItems: submitted.workItems.map((item) => ({ quotationItemId: null, ...item, actualHours: Number(item.actualHours), actualCost: Number(item.actualCost) }))
      });
      setOutcome(savedOutcome);
      window.dispatchEvent(new CustomEvent("freelance-ops-outcome-saved", { detail: { key: draftKey, source: instance.current } }));
      const cleared = submitted.revision ? clearOutcomeDraft(draftKey, submitted.revision) : { cleared: true, unavailable: false };
      setCleanupUnavailable(cleared.unavailable);
      if (cleared.cleared) {
        const next = outcomeDraftFromResult(savedOutcome);
        draftRef.current = next;
        setDraft(next);
        setDraftStarted(false);
      } else {
        setDraftConflict(true);
        setLatestChecked(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "결과를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="outcome-review">
      <div className="guided-copy outcome-guided-copy">
        <h2>
          {t("끝난 프로젝트를 다음")}
          <br />
          {t("견적의 근거로 남기세요.")}
        </h2>
        <p>{t("실제 공수와 비용을 직접 확정해 두면 이후 유사한 프로젝트의 참고 자료로 활용할 수 있습니다.")}</p>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {t(error)}
        </div>
      )}
      {canWrite && draftStarted && (
        <div className="requirement-draft-note" role="status">
          <span>{t(draftUnavailable ? "이 탭에서는 초안을 유지하지만 새로고침하면 사라질 수 있습니다." : "미저장 초안입니다. 다른 단계로 이동하거나 새로고침해도 이 탭에서 이어서 작성할 수 있습니다.")}</span>
          <button type="button" className="quiet-button" disabled={busy} onClick={async () => {
            if (!window.confirm(t("미저장 결과 초안을 버릴까요? 저장된 결과는 유지됩니다."))) return;
            const revision = draftRef.current.revision;
            setBusy(true);
            try {
              const latest = await getOutcome(session, project.id);
              const cleared = clearOutcomeDraft(draftKey, revision);
              if (!cleared.cleared) { setDraftConflict(true); setLatestChecked(false); return; }
              setCleanupUnavailable(cleared.unavailable);
              const next = outcomeDraftFromResult(latest);
              draftRef.current = next;
              setDraft(next);
              setOutcome(latest);
              setDraftStarted(false);
              setDraftConflict(false);
            } catch (cause) { setError(cause instanceof Error ? cause.message : "결과를 불러오지 못했습니다."); }
            finally { setBusy(false); }
          }}>{t("초안 버리기")}</button>
        </div>
      )}
      {cleanupUnavailable && (
        <p className="inline-error" role="alert">{t("브라우저 저장소의 이전 초안을 정리하지 못했습니다. 저장소 접근이 복구된 뒤 다시 나타날 수 있습니다.")}</p>
      )}
      {canWrite && draftConflict && (
        <div className="inline-error" role="alert">
          <p>{t("저장된 결과가 초안 작성 이후 변경됐습니다. 최신 결과를 확인하기 전에는 저장할 수 없습니다.")}</p>
          {latestChecked && outcome && (
            <div>
              <strong>{t("현재 저장된 결과")}</strong>
              <p>{t("최종 계약 금액")}: {formatMoney(outcome.totalRevenue, project.currency)} · {t("실제 비용")}: {formatMoney(outcome.actualCost, project.currency)} · {t("실제 공수")}: {outcome.actualHours}{t("시간")}</p>
              <p>{t("완료일")}: {outcome.completedOn || "—"} · {t("기준 견적")}: {outcome.approvedQuotationId || "—"}</p>
              <p>{t("변경 내용")}: {outcome.changeReason || "—"}</p>
              {outcome.workItems.map((item, index) => <p key={index}>{item.title} · {item.actualHours}{t("시간")} · {formatMoney(item.actualCost, project.currency)} · {item.notes || "—"}</p>)}
            </div>
          )}
          {latestChecked && !outcome && <p>{t("현재 저장된 결과가 없습니다.")}</p>}
          {!latestChecked ? (
            <button type="button" className="secondary-button" onClick={async () => {
              try { setOutcome(await getOutcome(session, project.id)); setLatestChecked(true); }
              catch (cause) { setError(cause instanceof Error ? cause.message : "결과를 불러오지 못했습니다."); }
            }}>{t("최신 결과 확인")}</button>
          ) : (
            <div>
              <p>{t("계속 편집한 뒤 저장하면 위 결과를 현재 초안으로 바꿉니다.")}</p>
              <button type="button" className="secondary-button" onClick={() => {
                changeDraft((current) => ({ ...current, baseId: outcome?.id ?? null, baseVersion: outcome?.version ?? null }));
                setDraftConflict(false);
              }}>{t("현재 초안으로 계속 편집")}</button>
            </div>
          )}
        </div>
      )}
      {outcome && (
        <div className="outcome-snapshot">
          <Graph size={25} />
          <div>
            <span>{t("확정된 결과")}</span>
            <strong>
              {t("이익률")}
              {Math.round(outcome.profitMargin * 100)}%
            </strong>
          </div>
          <dl>
            <div>
              <dt>{t("매출")}</dt>
              <dd>{formatMoney(outcome.totalRevenue, project.currency)}</dd>
            </div>
            <div>
              <dt>{t("실제 비용")}</dt>
              <dd>{formatMoney(outcome.actualCost, project.currency)}</dd>
            </div>
            <div>
              <dt>{t("실제 공수")}</dt>
              <dd>
                {outcome.actualHours}
                {t("시간")}
              </dd>
            </div>
          </dl>
        </div>
      )}
      {outcome && approvedQuotation && (
        <details className="outcome-variance workspace-disclosure">
          <summary>{t("견적 대비 차이")}</summary>
          <header>
            <span>{t("예상 대비 오차")}</span>
            <strong>
              {approvedQuotation.scenario} v{approvedQuotation.versionNumber}
            </strong>
          </header>
          <dl>
            <div>
              <dt>{t("견적 대비 계약 금액")}</dt>
              <dd className={revenueVariance != null && revenueVariance >= 0 ? "positive" : "negative"}>
                {revenueVariance == null
                  ? "-"
                  : `${revenueVariance >= 0 ? "+" : ""}${formatMoney(revenueVariance, project.currency)}`}
              </dd>
              <small>
                {t("견적")}
                {formatMoney(approvedQuotation.total, approvedQuotation.currency)} {t("→ 실제")}{" "}
                {formatMoney(outcome.totalRevenue, project.currency)}
              </small>
            </div>
            <div>
              <dt>{t("시간 공수 오차")}</dt>
              <dd className={hoursVariance != null && hoursVariance <= 0 ? "positive" : "negative"}>
                {hoursVariance == null
                  ? t("비교 불가")
                  : t("{v0}{v1}시간", { v0: hoursVariance >= 0 ? "+" : "", v1: hoursVariance.toLocaleString() })}
              </dd>
              <small>
                {quotedHours > 0
                  ? t("시간 단위 견적 {v0}시간 → 실제 {v1}시간", {
                      v0: quotedHours.toLocaleString(),
                      v1: outcome.actualHours.toLocaleString()
                    })
                  : t("시간 단위 견적 항목이 없습니다.")}
              </small>
            </div>
          </dl>
        </details>
      )}
      <details className="workspace-disclosure outcome-editor">
        <summary>{outcome ? t("결과 기록 상세·수정") : t("프로젝트 결과 기록하기")}</summary>
        <form className="outcome-form" aria-busy={busy} onSubmit={handleSubmit}>
          <fieldset className="outcome-fields" disabled={busy}>
            <section className="outcome-basics" aria-labelledby="outcome-basics-title">
              <header>
                <div>
                  <h3 id="outcome-basics-title">{t("계약과 실제 투입을 확정하세요.")}</h3>
                  <p>{t("발행한 견적을 연결하면 예상 대비 차이를 함께 확인할 수 있습니다.")}</p>
                </div>
              </header>
              <div className="outcome-metrics-grid">
                <div className="outcome-control outcome-quotation-control">
                  <label htmlFor="outcome-approved-quotation">{t("기준 견적")}</label>
                  <div className="outcome-select-shell">
                    <select
                      id="outcome-approved-quotation"
                      name="approvedQuotationId"
                      disabled={!canWrite}
                      value={approvedQuotationId}
                      onChange={(event) => changeDraft((current) => ({ ...current, approvedQuotationId: event.target.value }))}
                    >
                      <option value="">{t("견적을 연결하지 않음")}</option>
                      {approvedQuotationId && !quotations.some((quotation) => quotation.id === approvedQuotationId) && (
                        <option value={approvedQuotationId}>{t("저장된 기준 견적")}</option>
                      )}
                      {quotations
                        .filter(
                          (quotation) =>
                            quotation.status === "PUBLISHED" ||
                            quotation.id === approvedQuotationId ||
                            quotation.id === outcome?.approvedQuotationId
                        )
                        .map((quotation) => (
                          <option key={quotation.id} value={quotation.id}>
                            {t(quotationScenarioLabels[quotation.scenario])} v{quotation.versionNumber} ·{" "}
                            {formatMoney(quotation.total, quotation.currency)} · {quotationIdentity(quotation, locale)}
                          </option>
                        ))}
                    </select>
                    <CaretDown size={15} />
                  </div>
                  <small>{t("고객이 승인한 견적")}</small>
                  {historyError && (
                    <p className="inline-error" role="alert">
                      {t(historyError)}
                    </p>
                  )}
                  {canReadQuotations && nextCursor && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void loadMoreQuotations()}
                      disabled={loadingMore}
                    >
                      {loadingMore ? t("이전 견적을 불러오는 중입니다.") : t("이전 견적 더 보기")}
                    </button>
                  )}
                </div>
                <label className="outcome-control">
                  <span>{t("최종 계약 금액")}</span>
                  <div className="outcome-input-shell">
                    <input
                      name="totalRevenue"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      readOnly={!canWrite}
                      value={draft.totalRevenue}
                      onChange={(event) => changeDraft((current) => ({ ...current, totalRevenue: event.target.value }))}
                    />
                    <small>{project.currency}</small>
                  </div>
                </label>
                <label className="outcome-control">
                  <span>{t("실제 비용")}</span>
                  <div className="outcome-input-shell">
                    <input
                      name="actualCost"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      readOnly={!canWrite}
                      value={draft.actualCost}
                      onChange={(event) => changeDraft((current) => ({ ...current, actualCost: event.target.value }))}
                    />
                    <small>{project.currency}</small>
                  </div>
                </label>
                <label className="outcome-control">
                  <span>{t("실제 공수")}</span>
                  <div className="outcome-input-shell">
                    <input
                      name="actualHours"
                      type="number"
                      min="0"
                      step="0.5"
                      required
                      readOnly={!canWrite}
                      value={draft.actualHours}
                      onChange={(event) => changeDraft((current) => ({ ...current, actualHours: event.target.value }))}
                    />
                    <small>{t("시간")}</small>
                  </div>
                </label>
                <label className="outcome-control">
                  <span>{t("완료일")}</span>
                  <div className="outcome-date-shell">
                    <input
                      name="completedOn"
                      type="date"
                      readOnly={!canWrite}
                      value={draft.completedOn}
                      onChange={(event) => changeDraft((current) => ({ ...current, completedOn: event.target.value }))}
                    />
                  </div>
                </label>
              </div>
            </section>
            <section className="actual-work-items">
              <header className="actual-work-heading">
                <div>
                  <span>{t("항목별 실제 결과")}</span>
                  <small>{t("세부 작업을 나누면 다음 견적에서 공수 오차를 비교할 수 있습니다.")}</small>
                </div>
                {canWrite && workItems.length > 0 && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setWorkItems((current) => [...current, { title: "", actualHours: "0", actualCost: "0", notes: "" }])
                    }
                  >
                    <Plus size={16} /> {t("항목 추가")}
                  </button>
                )}
              </header>
              {workItems.length === 0 ? (
                <div className="actual-work-empty">
                  <span className="actual-work-empty-icon">
                    <Graph size={22} />
                  </span>
                  <div>
                    <strong>{t("세부 항목은 선택 사항입니다.")}</strong>
                    <span>{t("전체 비용과 공수만 기록해도 결과를 저장할 수 있습니다.")}</span>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setWorkItems([{ title: "", actualHours: "0", actualCost: "0", notes: "" }])}
                    >
                      <Plus size={16} /> {t("첫 항목 추가")}
                    </button>
                  )}
                </div>
              ) : (
                workItems.map((item, index) => (
                  <fieldset key={index} disabled={!canWrite}>
                    <legend>
                      {t("실제 작업")}
                      {index + 1}
                    </legend>
                    <div className="form-row">
                      <label>
                        {t("작업명")}
                        <input
                          required
                          maxLength={200}
                          value={item.title}
                          onChange={(event) =>
                            setWorkItems((current) =>
                              current.map((currentItem, itemIndex) =>
                                itemIndex === index ? { ...currentItem, title: event.target.value } : currentItem
                              )
                            )
                          }
                        />
                      </label>
                      <label>
                        {t("실제 공수")}
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={item.actualHours}
                          onChange={(event) =>
                            setWorkItems((current) =>
                              current.map((currentItem, itemIndex) =>
                                itemIndex === index
                                  ? { ...currentItem, actualHours: event.target.value }
                                  : currentItem
                              )
                            )
                          }
                        />
                      </label>
                      <label>
                        {t("실제 비용")}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.actualCost}
                          onChange={(event) =>
                            setWorkItems((current) =>
                              current.map((currentItem, itemIndex) =>
                                itemIndex === index
                                  ? { ...currentItem, actualCost: event.target.value }
                                  : currentItem
                              )
                            )
                          }
                        />
                      </label>
                    </div>
                    <label>
                      {t("작업 메모")}
                      <textarea
                        rows={3}
                        maxLength={3000}
                        value={item.notes}
                        onChange={(event) =>
                          setWorkItems((current) =>
                            current.map((currentItem, itemIndex) =>
                              itemIndex === index ? { ...currentItem, notes: event.target.value } : currentItem
                            )
                          )
                        }
                      />
                    </label>
                    {canWrite && (
                      <button
                        type="button"
                        className="remove-feature"
                        onClick={() => setWorkItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <Trash size={16} /> {t("항목 제거")}
                      </button>
                    )}
                  </fieldset>
                ))
              )}
            </section>
            <section className="outcome-change-card" aria-labelledby="outcome-change-title">
              <header>
                <div>
                  <h3 id="outcome-change-title">{t("처음 예상과 달라진 점")}</h3>
                  <p>{t("다음 견적에서 같은 오차를 줄일 수 있도록 실제로 달라진 이유만 남겨주세요.")}</p>
                </div>
                <PencilSimple size={22} />
              </header>
              <div className="outcome-change-prompts" aria-label={t("작성할 내용 예시")}>
                <span>
                  <Plus size={13} /> {t("추가된 범위")}
                </span>
                <span>
                  <Trash size={13} /> {t("제외된 작업")}
                </span>
                <span>
                  <Clock size={13} /> {t("일정·비용 변화")}
                </span>
              </div>
              <label htmlFor="outcome-change-reason">{t("변경 내용")}</label>
              <div className="outcome-change-input">
                <textarea
                  id="outcome-change-reason"
                  name="changeReason"
                  rows={6}
                  maxLength={5000}
                  readOnly={!canWrite}
                  value={draft.changeReason}
                  onChange={(event) => changeDraft((current) => ({ ...current, changeReason: event.target.value }))}
                  placeholder={t(
                    "예: 고객 확인이 늦어져 일정이 3일 늘었고, 관리자 통계 화면이 추가되어 개발 공수가 6시간 증가했습니다."
                  )}
                />
              </div>
              <small>{t("확인된 사실을 중심으로 작성하세요. 비어 있어도 결과를 저장할 수 있습니다.")}</small>
            </section>
            {canWrite ? (
              <button type="submit" className="primary-button" disabled={busy || draftConflict}>
                {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} {t("사용자 확정 결과 저장")}
              </button>
            ) : (
              <p className="permission-note">{t("읽기 전용 결과입니다.")}</p>
            )}
          </fieldset>
        </form>
      </details>
    </section>
  );
}
