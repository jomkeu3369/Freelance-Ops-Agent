"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useT } from "../../../../app/lib/ui-language";
import {
  AgentRunHistoryItem,
  AgentRunView,
  ApiError,
  AuthSession,
  EstimationPolicyProposal,
  WorkflowEvent,
  confirmEstimationPolicyProposal,
  getAgentRun,
  getCurrentEstimationPolicy,
  getEstimationPolicyProposal,
  listProjectAgentRunHistory,
  listProjectEstimationPolicyProposals,
  proposeEstimationPolicy,
} from "../../../../app/lib/api";
import { parseChatPolicyIntent } from "../../../../app/lib/chat-policy-intent.mjs";

interface AgentChatProps {
  session: AuthSession;
  projectId: string;
  run: AgentRunView | null;
  runId: string | null;
  events: WorkflowEvent[];
  busy: boolean;
  canRun: boolean;
  canEditPolicy: boolean;
  canCancel: boolean;
  modelAvailable: boolean;
  onSend: (message: string) => Promise<boolean>;
  onCancel: () => Promise<void>;
}

function draftKey(session: AuthSession, projectId: string) {
  return `freelance-ops-chat-draft-v1:${session.userId}:${session.workspaceId}:${projectId}`;
}

function proposalKey(session: AuthSession, projectId: string) {
  return `freelance-ops-policy-proposal-v1:${session.userId}:${session.workspaceId}:${projectId}`;
}

const activeStatuses = new Set(["QUEUED", "RUNNING", "WAITING_FOR_USER"]);

function eventText(event: WorkflowEvent): string {
  const summary = event.data.summary;
  const department = event.data.department;
  if (typeof summary === "string" && summary.trim()) return summary;
  if (typeof department === "string" && department.trim()) return `${department} · ${event.type}`;
  return event.type;
}

export function AgentChat({ session, projectId, run, runId, events, busy, canRun, canEditPolicy, canCancel, modelAvailable, onSend, onCancel }: AgentChatProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<AgentRunHistoryItem[]>([]);
  const [policyHistory, setPolicyHistory] = useState<EstimationPolicyProposal[]>([]);
  const [pastRuns, setPastRuns] = useState<Record<string, AgentRunView>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [acceptedMessage, setAcceptedMessage] = useState("");
  const [proposal, setProposal] = useState<EstimationPolicyProposal | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const key = draftKey(session, projectId);
  const pendingKey = proposalKey(session, projectId);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try { setDraft(sessionStorage.getItem(key) ?? ""); } catch { setDraft(""); }
    });
    return () => { cancelled = true; };
  }, [key]);

  useEffect(() => {
    if (!canEditPolicy) return;
    let cancelled = false;
    listProjectEstimationPolicyProposals(session, projectId)
      .then((items) => { if (!cancelled) setPolicyHistory(items); })
      .catch(() => { if (!cancelled) setPolicyError(t("견적 설정 기록을 불러오지 못했습니다.")); });
    return () => { cancelled = true; };
  }, [canEditPolicy, projectId, session, t]);

  useEffect(() => {
    if (!canEditPolicy) return;
    let cancelled = false;
    let proposalId: string | null = null;
    try { proposalId = sessionStorage.getItem(pendingKey); } catch { /* Session storage is optional. */ }
    if (proposalId) getEstimationPolicyProposal(session, proposalId)
      .then((value) => { if (!cancelled) setProposal(value); })
      .catch(() => { if (!cancelled) { setProposal(null); try { sessionStorage.removeItem(pendingKey); } catch { /* ignore */ } } });
    return () => { cancelled = true; };
  }, [canEditPolicy, pendingKey, session]);

  useEffect(() => {
    if (!canRun) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) setLoading(true); });
    listProjectAgentRunHistory(session, projectId)
      .then(async (items) => {
        const settled = await Promise.allSettled(items.filter((item) => item.runId !== runId).map((item) => getAgentRun(session, item.runId)));
        if (cancelled) return;
        const views: Record<string, AgentRunView> = {};
        settled.forEach((result) => { if (result.status === "fulfilled") views[result.value.runId] = result.value; });
        setPastRuns(views);
        setHistory(items);
        setError(null);
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : t("작업 기록을 불러오지 못했습니다.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canRun, projectId, runId, session, t]);

  const turns = useMemo(() => {
    const known = new Map(history.map((item) => [item.runId, item]));
    if (runId && !known.has(runId)) known.set(runId, { runId, requirementText: acceptedMessage, status: run?.status ?? "QUEUED", createdAt: run?.updatedAt ?? "" });
    return [...known.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [acceptedMessage, history, run?.status, run?.updatedAt, runId]);
  const timeline = useMemo(() => [
    ...turns.map((value) => ({ kind: "run" as const, value, createdAt: value.createdAt })),
    ...policyHistory.map((value) => ({ kind: "policy" as const, value, createdAt: value.createdAt })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [turns, policyHistory]);
  const active = !!runId && (!run || activeStatuses.has(run.status));

  function updateDraft(value: string) {
    setDraft(value);
    try { sessionStorage.setItem(key, value); } catch { /* Keep the in-memory draft. */ }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft;
    if (!message.trim() || sending || busy || active) return;
    setSending(true);
    setPolicyError(null);
    try {
      const policyIntent = parseChatPolicyIntent(message);
      if (policyIntent) {
        if (!canEditPolicy) throw new Error(t("견적 설정 변경 권한이 없습니다."));
        if (!policyIntent.valid) throw new Error(t("예: 기본 세율 10%, 위험 버퍼 15%, 최대 할인 20%로 변경"));
        const current = await getCurrentEstimationPolicy(session);
        const next = await proposeEstimationPolicy(session, {
          projectId,
          sourceMessage: message,
          defaultTaxRate: policyIntent.values.defaultTaxRate ?? current.defaultTaxRate,
          defaultRiskBufferRate: policyIntent.values.defaultRiskBufferRate ?? current.defaultRiskBufferRate,
          maximumDiscountRate: policyIntent.values.maximumDiscountRate ?? current.maximumDiscountRate,
          expectedVersion: current.version,
          idempotencyKey: crypto.randomUUID(),
        });
        setProposal(next);
        setPolicyHistory((items) => [next, ...items.filter((item) => item.proposalId !== next.proposalId)]);
        try { sessionStorage.setItem(pendingKey, next.proposalId); } catch { /* Keep it in memory. */ }
        updateDraft("");
      } else {
        if (!canRun || !modelAvailable) return;
        if (await onSend(message)) { setAcceptedMessage(message); updateDraft(""); }
      }
    } catch (cause) {
      setPolicyError(cause instanceof Error ? cause.message : t("설정 변경안을 만들지 못했습니다."));
    } finally {
      setSending(false);
    }
  }

  async function confirmProposal() {
    if (!proposal || proposal.status !== "PENDING" || policyBusy) return;
    setPolicyBusy(true);
    setPolicyError(null);
    try {
      const applied = await confirmEstimationPolicyProposal(session, proposal.proposalId, proposal.confirmationToken);
      setProposal(applied);
      setPolicyHistory((items) => items.map((item) => item.proposalId === applied.proposalId ? applied : item));
      try { sessionStorage.removeItem(pendingKey); } catch { /* ignore */ }
    } catch (cause) {
      if (cause instanceof ApiError && (cause.status === 410 || cause.status === 409)) {
        setProposal(null);
        try { sessionStorage.removeItem(pendingKey); } catch { /* ignore */ }
        setPolicyError(t("제안이 만료되었거나 현재 설정이 바뀌었습니다. 새 변경안을 입력해 주세요."));
        return;
      }
      setPolicyError(cause instanceof Error ? cause.message : t("설정 변경을 확정하지 못했습니다."));
    } finally { setPolicyBusy(false); }
  }

  return (
    <section className="agent-chat" aria-label={t("에이전트 대화")}>
      <header className="agent-chat-heading">
        <div><span>{t("프로젝트 에이전트")}</span><h2>{t("무엇을 도와드릴까요?")}</h2></div>
        <p>{t("요청을 보내면 실제 작업 단계와 결과가 이 대화에 기록됩니다.")}</p>
      </header>
      <div className="agent-chat-turns" aria-live="polite" aria-relevant="additions text">
        {loading && <p className="agent-chat-muted">{t("작업 기록을 불러오는 중입니다.")}</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && timeline.length === 0 && <p className="agent-chat-muted">{t("첫 요청을 입력해 주세요.")}</p>}
        {timeline.map((entry) => {
          if (entry.kind === "policy") {
            const item = entry.value;
            return <div className="agent-chat-turn" key={`policy-${item.proposalId}`} data-proposal-id={item.proposalId}>
              <div className="agent-chat-message user"><span>{t("내 요청")}</span><p>{item.sourceMessage}</p></div>
              <div className="agent-chat-message assistant"><span>{t("견적 기본 설정")} · {item.status === "APPLIED" ? t("적용됨") : t("확인 대기")}</span>
                <p>{t("기본 세율")}: {(item.before.defaultTaxRate * 100).toLocaleString()}% → {(item.after.defaultTaxRate * 100).toLocaleString()}%</p>
                <p>{t("위험 버퍼")}: {(item.before.defaultRiskBufferRate * 100).toLocaleString()}% → {(item.after.defaultRiskBufferRate * 100).toLocaleString()}%</p>
                <p>{t("최대 할인")}: {(item.before.maximumDiscountRate * 100).toLocaleString()}% → {(item.after.maximumDiscountRate * 100).toLocaleString()}%</p>
              </div>
            </div>;
          }
          const item = entry.value;
          const view = item.runId === runId ? run : pastRuns[item.runId];
          const status = view?.status ?? item.status;
          const liveEvents = item.runId === runId ? events : [];
          return <div className="agent-chat-turn" key={item.runId} data-run-id={item.runId}>
            {item.requirementText && <div className="agent-chat-message user"><span>{t("내 요청")}</span><p>{item.requirementText}</p></div>}
            <div className="agent-chat-message assistant">
              <span>{t("작업 상태")} · {t(status)}</span>
              {liveEvents.length > 0 && <ol className="agent-chat-events">{liveEvents.slice(-8).map((entry) => <li key={entry.eventId}>{eventText(entry)}</li>)}</ol>}
              {view?.result ? <div className="agent-chat-result">
                <strong>{t("결과")}</strong>
                <p>{view.result.projectSummary}</p>
                {view.result.departmentResults.length > 0 && <details><summary>{t("담당 작업과 근거 보기")}</summary><ul>{view.result.departmentResults.map((result, index) => <li key={`${result.department}-${index}`}><strong>{result.department}</strong> · {result.summary}</li>)}</ul></details>}
                {(view.result.quotationDraft || view.result.quotationDrafts.length > 0) && <p>{t("견적 초안이 준비되었습니다. 견적 단계에서 검토해 주세요.")}</p>}
              </div> : <p className="agent-chat-muted">{status === "FAILED" ? t("작업에 실패했습니다. 상세 상태를 확인해 주세요.") : status === "CANCELLED" ? t("작업이 취소되었습니다.") : t("작업 결과를 기다리는 중입니다.")}</p>}
            </div>
          </div>;
        })}
      </div>
      {proposal && <section className="agent-chat-policy" aria-label={t("견적 기본 설정 변경안")}>
        <strong>{proposal.status === "APPLIED" ? t("견적 기본 설정이 변경되었습니다.") : t("견적 기본 설정 변경안")}</strong>
        <p>{t("현재 값과 변경 값을 확인해 주세요. 확인 전에는 적용되지 않습니다.")}</p>
        <dl>
          {([
            ["defaultTaxRate", "기본 세율"],
            ["defaultRiskBufferRate", "위험 버퍼"],
            ["maximumDiscountRate", "최대 할인"],
          ] as const).map(([field, label]) => <div key={field}><dt>{t(label)}</dt><dd>{(proposal.before[field] * 100).toLocaleString()}% → {(proposal.after[field] * 100).toLocaleString()}%</dd></div>)}
        </dl>
        {proposal.status === "PENDING" && <button type="button" className="primary-button" disabled={policyBusy} onClick={() => void confirmProposal()}>{policyBusy ? t("적용 중...") : t("확인하고 적용")}</button>}
      </section>}
      {policyError && <p role="alert" className="form-error">{policyError}</p>}
      <form className="agent-chat-composer" onSubmit={(event) => void submit(event)}>
        <label htmlFor="agent-chat-input">{t("요청 입력")}</label>
        <textarea id="agent-chat-input" value={draft} onChange={(event) => updateDraft(event.target.value)} maxLength={50000} rows={3} placeholder={t("예: 이 프로젝트의 요구사항을 검토하고 견적 초안을 만들어 줘")} disabled={(!canRun && !canEditPolicy) || active || busy || sending} />
        <div className="agent-chat-actions">
          {active && canCancel && <button type="button" className="quiet-button danger" disabled={busy} onClick={() => void onCancel()}>{t("작업 취소")}</button>}
          <button type="submit" className="primary-button" disabled={!draft.trim() || active || busy || sending || (!canRun && !canEditPolicy)}>{sending ? t("요청 중...") : t("보내기")}</button>
        </div>
        {!modelAvailable && canRun && <p className="agent-chat-muted">{t("먼저 사용할 AI 모델을 선택해 주세요.")}</p>}
      </form>
    </section>
  );
}
