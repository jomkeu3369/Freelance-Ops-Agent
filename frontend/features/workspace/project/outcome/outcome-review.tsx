import type { FormEvent } from "react";
import {
  AuthSession,
  Project,
  ActualOutcome,
  Quotation,
  getOutcome,
  listQuotations,
  saveOutcome
} from "../../../../app/lib/api";
import { useState, useEffect } from "react";
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

interface OutcomeReviewProps {
  session: AuthSession;
  project: Project;
  permissions: Set<string>;
}

export function OutcomeReview({ session, project, permissions }: OutcomeReviewProps) {
  const canRead = permissions.has("outcome.read");
  const canWrite = permissions.has("outcome.write");
  const canReadQuotations = permissions.has("quotation.read");
  const [outcome, setOutcome] = useState<ActualOutcome | null>(null);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [workItems, setWorkItems] = useState<
    Array<{ title: string; actualHours: number; actualCost: number; notes: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    Promise.all([
      getOutcome(session, project.id),
      canReadQuotations ? listQuotations(session, project.id) : Promise.resolve([])
    ])
      .then(([result, nextQuotations]) => {
        if (!cancelled) {
          setOutcome(result);
          setQuotations(nextQuotations);
          setWorkItems(
            result?.workItems.map((item) => ({
              title: item.title,
              actualHours: item.actualHours,
              actualCost: item.actualCost,
              notes: item.notes ?? ""
            })) ?? []
          );
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled && cause instanceof Error && !cause.message.includes("찾")) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, canReadQuotations, project.id, session]);

  if (!canRead)
    return (
      <div className="workspace-empty">
        <Graph size={38} />
        <h2>프로젝트 결과를 볼 수 없습니다.</h2>
        <p>결과 조회가 필요하다면 작업 공간 관리자에게 문의해 주세요.</p>
      </div>
    );
  if (loading)
    return (
      <div className="section-loading">
        <CircleNotch className="spin" /> 결과 기록을 확인하고 있습니다.
      </div>
    );
  const approvedQuotation = outcome?.approvedQuotationId
    ? (quotations.find((quotation) => quotation.id === outcome.approvedQuotationId) ?? null)
    : null;
  const quotedHours =
    approvedQuotation?.items
      .filter((item) => item.unit === "HOUR")
      .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const revenueVariance =
    outcome && approvedQuotation ? outcome.totalRevenue - approvedQuotation.total : null;
  const hoursVariance = outcome && quotedHours > 0 ? outcome.actualHours - quotedHours : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || busy) return;
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const savedOutcome = await saveOutcome(session, project.id, {
        approvedQuotationId: String(data.get("approvedQuotationId")) || null,
        totalRevenue: Number(data.get("totalRevenue")),
        actualCost: Number(data.get("actualCost")),
        actualHours: Number(data.get("actualHours")),
        completedOn: String(data.get("completedOn")) || null,
        changeReason: String(data.get("changeReason")),
        workItems: workItems.map((item) => ({ quotationItemId: null, ...item }))
      });
      setOutcome(savedOutcome);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "결과를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="outcome-review">
      <div className="guided-copy outcome-guided-copy">
        <span>프로젝트 회고</span>
        <h2>
          끝난 프로젝트를 다음
          <br />
          견적의 근거로 남기세요.
        </h2>
        <p>실제 공수와 비용을 직접 확정해 두면 이후 유사한 프로젝트의 참고 자료로 활용할 수 있습니다.</p>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {error}
        </div>
      )}
      {outcome && (
        <div className="outcome-snapshot">
          <Graph size={25} />
          <div>
            <span>확정된 결과</span>
            <strong>이익률 {Math.round(outcome.profitMargin * 100)}%</strong>
          </div>
          <dl>
            <div>
              <dt>매출</dt>
              <dd>{formatMoney(outcome.totalRevenue, project.currency)}</dd>
            </div>
            <div>
              <dt>실제 비용</dt>
              <dd>{formatMoney(outcome.actualCost, project.currency)}</dd>
            </div>
            <div>
              <dt>실제 공수</dt>
              <dd>{outcome.actualHours}시간</dd>
            </div>
          </dl>
        </div>
      )}
      {outcome && approvedQuotation && (
        <details className="outcome-variance workspace-disclosure"><summary>견적 대비 차이</summary>
          <header>
            <span>예상 대비 오차</span>
            <strong>
              {approvedQuotation.scenario} v{approvedQuotation.versionNumber}
            </strong>
          </header>
          <dl>
            <div>
              <dt>견적 대비 계약 금액</dt>
              <dd className={revenueVariance != null && revenueVariance >= 0 ? "positive" : "negative"}>
                {revenueVariance == null
                  ? "-"
                  : `${revenueVariance >= 0 ? "+" : ""}${formatMoney(revenueVariance, project.currency)}`}
              </dd>
              <small>
                견적 {formatMoney(approvedQuotation.total, approvedQuotation.currency)} → 실제{" "}
                {formatMoney(outcome.totalRevenue, project.currency)}
              </small>
            </div>
            <div>
              <dt>시간 공수 오차</dt>
              <dd className={hoursVariance != null && hoursVariance <= 0 ? "positive" : "negative"}>
                {hoursVariance == null
                  ? "비교 불가"
                  : `${hoursVariance >= 0 ? "+" : ""}${hoursVariance.toLocaleString()}시간`}
              </dd>
              <small>
                {quotedHours > 0
                  ? `시간 단위 견적 ${quotedHours.toLocaleString()}시간 → 실제 ${outcome.actualHours.toLocaleString()}시간`
                  : "시간 단위 견적 항목이 없습니다."}
              </small>
            </div>
          </dl>
        </details>
      )}
      <details className="workspace-disclosure outcome-editor"><summary>{outcome ? "결과 기록 상세·수정" : "프로젝트 결과 기록하기"}</summary>
      <form className="outcome-form" aria-busy={busy} onSubmit={handleSubmit}>
        <fieldset className="outcome-fields" disabled={busy}>
          <section className="outcome-basics" aria-labelledby="outcome-basics-title">
            <header>
              <span>최종 결과</span>
              <div>
                <h3 id="outcome-basics-title">계약과 실제 투입을 확정하세요.</h3>
                <p>발행한 견적을 연결하면 예상 대비 차이를 함께 확인할 수 있습니다.</p>
              </div>
            </header>
            <div className="outcome-metrics-grid">
              <label className="outcome-control outcome-quotation-control">
                <span>기준 견적</span>
                <div className="outcome-select-shell">
                  <select
                    name="approvedQuotationId"
                    disabled={!canWrite}
                    defaultValue={outcome?.approvedQuotationId ?? ""}
                  >
                    <option value="">견적을 연결하지 않음</option>
                    {quotations
                      .filter((quotation) => quotation.status === "PUBLISHED")
                      .map((quotation) => (
                        <option key={quotation.id} value={quotation.id}>
                          {quotationScenarioLabels[quotation.scenario]} v{quotation.versionNumber} ·{" "}
                          {formatMoney(quotation.total, quotation.currency)}
                        </option>
                      ))}
                  </select>
                  <CaretDown size={15} />
                </div>
                <small>고객이 승인한 견적</small>
              </label>
              <label className="outcome-control">
                <span>최종 계약 금액</span>
                <div className="outcome-input-shell">
                  <input
                    name="totalRevenue"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    readOnly={!canWrite}
                    defaultValue={outcome?.totalRevenue ?? ""}
                  />
                  <small>{project.currency}</small>
                </div>
              </label>
              <label className="outcome-control">
                <span>실제 비용</span>
                <div className="outcome-input-shell">
                  <input
                    name="actualCost"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    readOnly={!canWrite}
                    defaultValue={outcome?.actualCost ?? ""}
                  />
                  <small>{project.currency}</small>
                </div>
              </label>
              <label className="outcome-control">
                <span>실제 공수</span>
                <div className="outcome-input-shell">
                  <input
                    name="actualHours"
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    readOnly={!canWrite}
                    defaultValue={outcome?.actualHours ?? ""}
                  />
                  <small>시간</small>
                </div>
              </label>
              <label className="outcome-control">
                <span>완료일</span>
                <div className="outcome-date-shell">
                  <input
                    name="completedOn"
                    type="date"
                    readOnly={!canWrite}
                    defaultValue={outcome?.completedOn ?? ""}
                  />
                </div>
              </label>
            </div>
          </section>
          <section className="actual-work-items">
            <header className="actual-work-heading">
              <div>
                <span>항목별 실제 결과</span>
                <small>세부 작업을 나누면 다음 견적에서 공수 오차를 비교할 수 있습니다.</small>
              </div>
              {canWrite && workItems.length > 0 && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setWorkItems((current) => [
                      ...current,
                      { title: "", actualHours: 0, actualCost: 0, notes: "" }
                    ])
                  }
                >
                  <Plus size={16} /> 항목 추가
                </button>
              )}
            </header>
            {workItems.length === 0 ? (
              <div className="actual-work-empty">
                <span className="actual-work-empty-icon">
                  <Graph size={22} />
                </span>
                <div>
                  <strong>세부 항목은 선택 사항입니다.</strong>
                  <span>전체 비용과 공수만 기록해도 결과를 저장할 수 있습니다.</span>
                </div>
                {canWrite && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setWorkItems([{ title: "", actualHours: 0, actualCost: 0, notes: "" }])}
                  >
                    <Plus size={16} /> 첫 항목 추가
                  </button>
                )}
              </div>
            ) : (
              workItems.map((item, index) => (
                <fieldset key={index} disabled={!canWrite}>
                  <legend>실제 작업 {index + 1}</legend>
                  <div className="form-row">
                    <label>
                      작업명
                      <input
                        required
                        maxLength={200}
                        value={item.title}
                        onChange={(event) =>
                          setWorkItems((current) =>
                            current.map((currentItem, itemIndex) =>
                              itemIndex === index
                                ? { ...currentItem, title: event.target.value }
                                : currentItem
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      실제 공수
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={item.actualHours}
                        onChange={(event) =>
                          setWorkItems((current) =>
                            current.map((currentItem, itemIndex) =>
                              itemIndex === index
                                ? { ...currentItem, actualHours: Number(event.target.value) }
                                : currentItem
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      실제 비용
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.actualCost}
                        onChange={(event) =>
                          setWorkItems((current) =>
                            current.map((currentItem, itemIndex) =>
                              itemIndex === index
                                ? { ...currentItem, actualCost: Number(event.target.value) }
                                : currentItem
                            )
                          )
                        }
                      />
                    </label>
                  </div>
                  <label>
                    작업 메모
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
                      onClick={() =>
                        setWorkItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      <Trash size={16} /> 항목 제거
                    </button>
                  )}
                </fieldset>
              ))
            )}
          </section>
          <section className="outcome-change-card" aria-labelledby="outcome-change-title">
            <header>
              <div>
                <span>견적 대비 기록</span>
                <h3 id="outcome-change-title">처음 예상과 달라진 점</h3>
                <p>다음 견적에서 같은 오차를 줄일 수 있도록 실제로 달라진 이유만 남겨주세요.</p>
              </div>
              <PencilSimple size={22} />
            </header>
            <div className="outcome-change-prompts" aria-label="작성할 내용 예시">
              <span>
                <Plus size={13} /> 추가된 범위
              </span>
              <span>
                <Trash size={13} /> 제외된 작업
              </span>
              <span>
                <Clock size={13} /> 일정·비용 변화
              </span>
            </div>
            <label htmlFor="outcome-change-reason">변경 내용</label>
            <div className="outcome-change-input">
              <textarea
                id="outcome-change-reason"
                name="changeReason"
                rows={6}
                maxLength={5000}
                readOnly={!canWrite}
                defaultValue={outcome?.changeReason ?? ""}
                placeholder="예: 고객 확인이 늦어져 일정이 3일 늘었고, 관리자 통계 화면이 추가되어 개발 공수가 6시간 증가했습니다."
              />
            </div>
            <small>확인된 사실을 중심으로 작성하세요. 비어 있어도 결과를 저장할 수 있습니다.</small>
          </section>
          {canWrite ? (
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 사용자 확정 결과 저장
            </button>
          ) : (
            <p className="permission-note">읽기 전용 결과입니다.</p>
          )}
        </fieldset>
      </form>
      </details>
    </section>
  );
}
