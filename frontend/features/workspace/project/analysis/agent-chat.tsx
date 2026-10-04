"use client";

import { FormEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { ChatCircleText, ArrowUp, ArrowDown, ArrowUpRight, CheckCircle, CircleNotch, WarningCircle, WifiSlash, ListChecks, SlidersHorizontal } from "@phosphor-icons/react";
import { chatState, resultPendingMessage } from "../../../../app/lib/chat-presentation.mjs";
import { parseChatPolicyIntent } from "../../../../app/lib/chat-policy-intent.mjs";
import { departmentLabels, runStatusLabels } from "../../shared/constants";
import { eventActivityLabels, runFailureMessage } from "../../shared/activity-presentation";
import { StreamState } from "../../shared/types";

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
  streamState: StreamState;
  clarification: ReactNode;
  headerTools?: ReactNode;
  composerTools?: ReactNode;
  composerInfo?: ReactNode | ((draft: string) => ReactNode);
  retryMessages: string[];
  canSendAI: boolean;
  onOpenAISettings: () => void;
  onOpenResult: (view: AgentRunView) => void;
  onSend: (message: string) => Promise<boolean>;
  onCancel: () => Promise<void>;
}

function draftKey(session: AuthSession, projectId: string) {
  return `freelance-ops-chat-draft-v1:${session.userId}:${session.workspaceId}:${projectId}`;
}

function proposalKey(session: AuthSession, projectId: string) {
  return `freelance-ops-policy-proposal-v1:${session.userId}:${session.workspaceId}:${projectId}`;
}

const subscribeToConnection = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => { window.removeEventListener("online", notify); window.removeEventListener("offline", notify); };
};

const activeStatuses = new Set(["QUEUED", "RUNNING", "WAITING_FOR_USER"]);

function eventText(event: WorkflowEvent, t: (source: string) => string): string {
  const summary = event.data.summary;
  const department = event.data.department;
  if (typeof summary === "string" && summary.trim()) return summary;
  const label = t(eventActivityLabels[event.type] ?? ({ "task.delegated": "담당 작업 시작", "task.completed": "담당 작업 완료" }[event.type]) ?? "분석 진행");
  if (typeof department === "string" && department.trim()) return `${t(departmentLabels[department.toLowerCase()] ?? "담당 작업")} · ${label}`;
  return label;
}

function useAgentChatController({ session, projectId, run, runId, events, busy, canRun, canEditPolicy, canCancel, modelAvailable, streamState, clarification, headerTools, composerTools, composerInfo, canSendAI, retryMessages, onOpenAISettings, onOpenResult, onSend, onCancel }: AgentChatProps) {
  const t = useT();
  const online = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);
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
  const [historyRevision, setHistoryRevision] = useState(0);
  const [unread, setUnread] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const followsLatest = useRef(true);
  const mounted = useRef(true);
  const sendLock = useRef(false);
  const confirmLock = useRef(false);
  const cancelLock = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const composing = useRef(false);
  const policyDraft = useMemo(() => parseChatPolicyIntent(draft), [draft]);
  const retryingDraft = retryMessages.includes(draft);
  const maySendDraft = canSendAI || retryingDraft || !!policyDraft && canEditPolicy;
  const key = draftKey(session, projectId);
  const pendingKey = proposalKey(session, projectId);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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
  }, [canRun, projectId, runId, session, t, historyRevision]);

  const turns = useMemo(() => {
    const known = new Map(history.map((item) => [item.runId, item]));
    if (runId && !known.has(runId)) known.set(runId, { runId, requirementText: acceptedMessage, status: run?.status ?? "QUEUED", createdAt: run?.updatedAt ?? "" });
    return [...known.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [acceptedMessage, history, run?.status, run?.updatedAt, runId]);
  const timeline = useMemo(() => [
    ...turns.map((value) => ({ kind: "run" as const, value, createdAt: value.createdAt })),
    ...[...new Map([...policyHistory, ...(proposal ? [proposal] : [])].map((value) => [value.proposalId, value])).values()].map((value) => ({ kind: "policy" as const, value, createdAt: value.createdAt })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [turns, policyHistory, proposal]);
  const active = !!runId && (!run || activeStatuses.has(run.status));
  const presentation = chatState(run?.status ?? (runId ? "QUEUED" : null), { online, reconnecting: active && streamState === "reconnecting" });
  const updateSignature = `${timeline.map((entry) => entry.kind === "policy" ? `${entry.value.proposalId}:${entry.value.status}` : entry.value.runId).join("|")}:${run?.status}:${run?.interruption?.interruptionId}:${events.at(-1)?.eventId}:${run?.result?.projectSummary}`;

  useLayoutEffect(() => {
    const box = viewport.current;
    if (!box) return;
    if (followsLatest.current) box.scrollTop = box.scrollHeight;
    else Promise.resolve().then(() => setUnread(true));
  }, [updateSignature]);

  useEffect(() => {
    const body = content.current;
    if (!body) return;
    const observer = new ResizeObserver(() => {
      if (followsLatest.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
  }, [draft]);

  function showLatest() {
    followsLatest.current = true;
    setUnread(false);
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  function updateDraft(value: string) {
    setDraft(value);
    try { sessionStorage.setItem(key, value); } catch { /* Keep the in-memory draft. */ }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft;
    if (!online || !message.trim() || sendLock.current || busy || active || composing.current) return;
    sendLock.current = true;
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
        if (!mounted.current) return;
        setProposal(next);
        setPolicyHistory((items) => [next, ...items.filter((item) => item.proposalId !== next.proposalId)]);
        try { sessionStorage.setItem(pendingKey, next.proposalId); } catch { /* Keep it in memory. */ }
        updateDraft("");
      } else {
        if (!canRun) throw new Error(t("분석을 실행할 권한이 없습니다."));
        if (!canSendAI && !retryingDraft) throw new Error(t("크레딧 가격과 잔여량을 확인한 뒤 다시 보내 주세요."));
        if (!modelAvailable) throw new Error(t("먼저 사용할 AI 모델을 선택해 주세요."));
        const accepted = await onSend(message);
        if (!mounted.current) return;
        if (accepted) { setAcceptedMessage(message); updateDraft(""); showLatest(); }
        else setPolicyError(t("요청을 보내지 못했습니다. 입력은 보존되었습니다. 다시 보내 주세요."));
      }
    } catch (cause) {
      setPolicyError(cause instanceof Error ? cause.message : t("설정 변경안을 만들지 못했습니다."));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function cancel() {
    if (!active || !canCancel || busy || cancelLock.current) return;
    cancelLock.current = true;
    setCancelling(true);
    try { await onCancel(); }
    finally { cancelLock.current = false; setCancelling(false); }
  }

  async function confirmProposal(item: EstimationPolicyProposal) {
    if (!canEditPolicy || item.status !== "PENDING" || confirmLock.current) return;
    confirmLock.current = true;
    setPolicyBusy(true);
    setPolicyError(null);
    try {
      const applied = await confirmEstimationPolicyProposal(session, item.proposalId, item.confirmationToken);
      if (!mounted.current) return;
      setProposal(applied);
      setPolicyHistory((items) => items.map((item) => item.proposalId === applied.proposalId ? applied : item));
      try { if (sessionStorage.getItem(pendingKey) === item.proposalId) sessionStorage.removeItem(pendingKey); } catch { /* ignore */ }
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && (cause.status === 410 || cause.status === 409)) {
        setProposal(null);
        setPolicyHistory((items) => items.map((value) => value.proposalId === item.proposalId ? { ...value, status: "EXPIRED" } : value));
        try { sessionStorage.removeItem(pendingKey); } catch { /* ignore */ }
        setPolicyError(t("제안이 만료되었거나 현재 설정이 바뀌었습니다. 새 변경안을 입력해 주세요."));
        return;
      }
      setPolicyError(cause instanceof Error ? cause.message : t("설정 변경을 확정하지 못했습니다."));
    } finally { confirmLock.current = false; setPolicyBusy(false); }
  }

  return { t, presentation, headerTools, composerTools, composerInfo, maySendDraft, viewport, content, input, followsLatest, setUnread, loading, error, setHistoryRevision, timeline, draft, canRun, online, updateDraft, canEditPolicy, policyBusy, busy, confirmProposal, runId, run, pastRuns, events, active, streamState, clarification, onOpenResult, unread, showLatest, proposal, policyError, submit, sending, composing, onOpenAISettings, canCancel, cancelling, cancel, modelAvailable };
}

export function AgentChat(props: AgentChatProps) {
  return <AgentChatSurface {...useAgentChatController(props)} />;
}

export type AgentChatSurfaceProps = ReturnType<typeof useAgentChatController>;

/** Pure conversation presentation; the authenticated controller remains separate. */
export function AgentChatSurface({ t, presentation, headerTools, composerTools, composerInfo, maySendDraft, viewport: viewportRef, content: contentRef, input: inputRef, followsLatest: followsLatestRef, setUnread, loading, error, setHistoryRevision, timeline, draft, canRun, online, updateDraft, canEditPolicy, policyBusy, busy, confirmProposal, runId, run, pastRuns, events, active, streamState, clarification, onOpenResult, unread, showLatest, proposal, policyError, submit, sending, composing: composingRef, onOpenAISettings, canCancel, cancelling, cancel, modelAvailable }: AgentChatSurfaceProps) {
  return (
    <section className="agent-chat" aria-label={t("에이전트 대화")}>
      <header className="agent-chat-heading">
        <div className="agent-chat-identity"><span className="agent-chat-avatar" aria-hidden="true"><ChatCircleText size={23} weight="duotone" /></span><div><h2>{t("프로젝트 대화")}</h2><p>{t("프로젝트 에이전트")}</p></div></div>
        <div className="agent-chat-header-tools">{headerTools}</div>
        <span className={`agent-chat-state ${presentation.tone}`} role="status"><i aria-hidden="true" />{t(presentation.label)}</span>
      </header>
      {/* A scrollable log needs focus so keyboard users can read older messages with arrow keys. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div ref={viewportRef} className="agent-chat-turns" role="log" aria-label={t("대화 기록")} aria-live="off" tabIndex={0} onScroll={() => {
        const box = viewportRef.current;
        if (!box) return;
        followsLatestRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 70;
        if (followsLatestRef.current) setUnread(false);
      }}>
      <div ref={contentRef} className="agent-chat-content">
        {loading && <p className="agent-chat-muted">{t("작업 기록을 불러오는 중입니다.")}</p>}
        {error && <div role="alert"><p>{error}</p><button type="button" className="quiet-button" onClick={() => setHistoryRevision((value) => value + 1)}>{t("기록 다시 불러오기")}</button></div>}
        {!loading && !error && timeline.length === 0 && <div className="agent-chat-empty"><span className="agent-chat-empty-icon" aria-hidden="true"><ChatCircleText size={30} weight="duotone" /></span><strong>{t("무엇을 도와드릴까요?")}</strong><p>{t("요구사항 검토나 견적 초안 작성을 요청해 보세요.")}</p><small>{t("견적 설정을 바꿀 때는 적용 전에 확인을 받습니다.")}</small>{!draft && canRun && <div className="agent-chat-starters">{["이 프로젝트의 요구사항과 확인할 질문을 정리해 줘", "이 프로젝트의 작업 범위와 견적 초안을 만들어 줘"].map(message => <button type="button" key={message} disabled={!online} onClick={() => { updateDraft(t(message)); inputRef.current?.focus(); }}>{t(message)}<ArrowUpRight size={17} aria-hidden="true" /></button>)}</div>}</div>}
        {timeline.map((entry) => {
          if (entry.kind === "policy") {
            const item = entry.value;
            return <div className="agent-chat-turn" key={`policy-${item.proposalId}`} data-proposal-id={item.proposalId}>
              <div className="agent-chat-message user"><span>{t("내 요청")}</span><p>{item.sourceMessage}</p></div>
              <div className="agent-chat-message assistant agent-chat-policy" data-state={item.status === "APPLIED" ? "success" : "attention"}><span>{t("견적 기본 설정")} · {item.status === "APPLIED" ? t("적용됨") : item.status === "PENDING" ? t("확인 대기") : t("새 변경안 필요")}</span>
                <strong>{item.status === "APPLIED" ? t("견적 기본 설정이 변경되었습니다.") : t("견적 기본 설정 변경안")}</strong>
                {item.status === "PENDING" && <p className="agent-chat-muted">{t("현재 값과 변경 값을 확인해 주세요. 확인 전에는 적용되지 않습니다.")}</p>}
                <dl>{([ ["defaultTaxRate", "기본 세율"], ["defaultRiskBufferRate", "위험 버퍼"], ["maximumDiscountRate", "최대 할인"] ] as const).map(([field, label]) => <div key={field}><dt>{t(label)}</dt><dd>{(item.before[field] * 100).toLocaleString()}% → {(item.after[field] * 100).toLocaleString()}%</dd></div>)}</dl>
                {item.status === "PENDING" && canEditPolicy && <button type="button" className="primary-button" disabled={policyBusy || busy} onClick={() => void confirmProposal(item)}>{policyBusy ? t("적용 중...") : t("확인하고 적용")}</button>}
                {item.status === "PENDING" && !canEditPolicy && <p>{t("견적 설정 변경 권한이 없습니다.")}</p>}
              </div>
            </div>;
          }
          const item = entry.value;
          const view = item.runId === runId ? run : pastRuns[item.runId];
          const status = view?.status ?? item.status;
          const liveEvents = item.runId === runId ? events : [];
          const state = chatState(status, item.runId === runId ? { online, reconnecting: active && streamState === "reconnecting" } : {});
          const missingHistory = item.runId !== runId && !view && !loading;
          const needsResultRetry = missingHistory;
          return <div className="agent-chat-turn" key={item.runId} data-run-id={item.runId}>
            {item.requirementText && <div className="agent-chat-message user"><span>{t("내 요청")}</span><p>{item.requirementText}</p></div>}
            <div className="agent-chat-message assistant" data-state={missingHistory ? "offline" : state.tone}>
              <span className="agent-chat-message-label">{missingHistory ? <WarningCircle size={17} aria-hidden="true" /> : state.working ? <CircleNotch size={17} className="spin" aria-hidden="true" /> : state.tone === "success" ? <CheckCircle size={17} aria-hidden="true" /> : <ListChecks size={17} aria-hidden="true" />}{t("작업 상태")} · {missingHistory ? t("기록 확인 필요") : t(runStatusLabels[status] ?? "확인 중")}</span>
              {liveEvents.length > 0 && <details className="agent-chat-activity"><summary>{eventText(liveEvents.at(-1)!, t)}</summary><ol className="agent-chat-events">{liveEvents.slice(-8).map((entry) => <li key={entry.eventId}>{eventText(entry, t)}</li>)}</ol></details>}
              {view?.result ? <div className="agent-chat-result">
                <strong>{t("검토할 결과")}</strong>
                <p>{view.result.projectSummary}</p>
                <button type="button" className="secondary-button" onClick={() => onOpenResult(view)}>{t("결과 열기")}<ArrowUpRight size={17} aria-hidden="true" /></button>
              </div> : status === "WAITING_FOR_USER" && item.runId === runId ? clarification : <p className="agent-chat-muted">{missingHistory ? t("저장된 결과를 확인할 수 없습니다. 기록을 다시 불러와 주세요.") : status === "FAILED" ? t(runFailureMessage(view?.errorCode ?? null)) : status === "CANCELLED" ? t("작업이 취소되었습니다.") : t(resultPendingMessage(status))}</p>}
              {needsResultRetry && <button type="button" className="quiet-button" disabled={loading} onClick={() => setHistoryRevision(value => value + 1)}>{t("기록 다시 불러오기")}</button>}
              {status === "CANCELLED" && <p className="agent-chat-muted">{t("저장된 프로젝트와 이전 결과는 변경되지 않습니다.")}</p>}
            </div>
          </div>;
        })}
      </div>
      </div>
      {unread && <button type="button" className="agent-chat-new quiet-button" onClick={showLatest}><ArrowDown size={17} aria-hidden="true" />{t("새 메시지 보기")}</button>}
      <p className="sr-only" role="status">{unread ? t("새 메시지가 있습니다.") : [proposal ? proposal.status === "APPLIED" ? t("견적 기본 설정이 변경되었습니다.") : proposal.status === "PENDING" ? t("견적 기본 설정 변경안") : t("새 변경안 필요") : "", run ? t(runStatusLabels[run.status]) : ""].filter(Boolean).join(" · ")}</p>
      {!online && <p className="agent-chat-connection offline" role="status"><WifiSlash size={18} aria-hidden="true" />{t("인터넷 연결을 확인해 주세요. 입력한 내용은 보존되며 자동으로 전송되지 않습니다.")}</p>}
      {online && active && streamState === "reconnecting" && <p className="agent-chat-connection" role="status">{t("연결을 다시 확인하고 있습니다. 요청을 다시 보내지 않아도 됩니다.")}</p>}
      {policyError && <p role="alert" className="form-error">{policyError}</p>}
      <form className="agent-chat-composer" onSubmit={(event) => void submit(event)}>
        <label htmlFor="agent-chat-input">{t("요청 입력")}</label>
        <textarea ref={inputRef} id="agent-chat-input" aria-describedby="agent-chat-input-help" value={draft} onChange={(event) => updateDraft(event.target.value)} maxLength={50000} rows={2} placeholder={t("예: 이 프로젝트의 요구사항을 검토하고 견적 초안을 만들어 줘")} disabled={!canRun && !canEditPolicy} readOnly={sending} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.keyCode !== 229 && !composingRef.current) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }} />
        <p id="agent-chat-input-help" className="agent-chat-muted">{active ? t("작업 중에도 다음 요청을 작성할 수 있습니다. 완료 후 보내 주세요.") : t("Enter로 줄바꿈 · Ctrl/⌘ + Enter로 보내기. 초안은 이 탭에 저장됩니다.")}</p>
        {typeof composerInfo === "function" ? composerInfo(draft) : composerInfo}
        <div className="agent-chat-actions">
          {canRun && <fieldset className="agent-chat-tools" disabled={sending} aria-label={t("AI 설정")}>
            {composerTools}
            <button type="button" className="quiet-button agent-chat-model-button" onClick={onOpenAISettings} aria-label={t("AI 설정 열기")} title={t("AI 설정 열기")}><SlidersHorizontal size={17} aria-hidden="true" /><span className="agent-chat-settings-label">{t("AI 설정")}</span></button>
          </fieldset>}
          {active && canCancel && <button type="button" className="quiet-button danger" disabled={busy || cancelling} onClick={() => void cancel()}>{t("작업 취소")}</button>}
          <button type="submit" className="primary-button" aria-label={sending ? t("요청 중...") : t("보내기")} disabled={!online || !draft.trim() || active || busy || sending || !maySendDraft || (!canRun && !canEditPolicy)}>{sending ? <CircleNotch size={18} className="spin" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}<span className="agent-chat-send-label">{sending ? t("요청 중...") : t("보내기")}</span></button>
        </div>
        {!modelAvailable && canRun && <p className="agent-chat-muted">{t("먼저 사용할 AI 모델을 선택해 주세요.")}</p>}
      </form>
    </section>
  );
}
