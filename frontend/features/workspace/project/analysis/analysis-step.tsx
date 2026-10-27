import type { PendingRunRetry } from "../../../../app/lib/pending-run-store";
import type { SkillSelection } from "../../skills/skill-selection";
import { PawPrint, Receipt } from "@phosphor-icons/react";
import { ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../../../app/lib/ui-language";
import { AuthSession, AgentRunView, AgentRunUsage, WorkflowEvent } from "../../../../app/lib/api";
import { snapshotFromEvents } from "../../../../app/components/live-workflow";
import { interruptionDraftKey } from "../../../../app/lib/interruption-draft.mjs";
import { StreamState } from "../../shared/types";
import { InterruptionForm } from "./interruption-form";
import { AnalysisTimeline } from "./analysis-timeline";
import { AnalysisResult } from "./analysis-result";
import { WorkspacePanel } from "../../shared/workspace-panel";
import { AgentChat } from "./agent-chat";

interface AnalysisStepProps {
  conversationTools?: ReactNode;
  onInterrupt?: () => Promise<void>;
  session: AuthSession;
  projectId: string;
  run: AgentRunView | null;
  runId: string | null;
  events: WorkflowEvent[];
  busy: boolean;
  snapshot: ReturnType<typeof snapshotFromEvents>;
  canCancel: boolean;
  canRespond: boolean;
  canRun: boolean;
  canEditPolicy: boolean;
  modelAvailable: boolean;
  composerTools?: ReactNode;
  composerInfo?: ReactNode | ((draft: string, retry: PendingRunRetry | undefined, policy: boolean) => ReactNode);
  retryCandidates: PendingRunRetry[];
  canSendAI: boolean;
  canStartQuotation: boolean;
  canOpenPets: boolean;
  onStartQuotation: () => void;
  onOpenPets: () => void;
  quotationError: string | null;
  streamState: StreamState;
  onOpenAISettings: (draft: string) => void;
  onSendMessage: (message: string, attachmentIds?: string[], skillSelection?: SkillSelection) => Promise<boolean>;
  costUsage: AgentRunUsage | null;
  onCancel: () => Promise<void>;
  onResume: (answers: string[]) => Promise<void>;
  onCompareQuotes: () => void;
}

export function AnalysisStep({ session, projectId, run, runId, events, busy, canCancel, canRespond, canRun, canEditPolicy, modelAvailable, composerTools, composerInfo, canSendAI, canStartQuotation, canOpenPets, onStartQuotation, onOpenPets, quotationError, retryCandidates, streamState, onOpenAISettings, onSendMessage, costUsage, onCancel, onResume, onCompareQuotes, conversationTools, onInterrupt }: AnalysisStepProps) {
  const t = useT();
  const [reviewedRun, setReviewedRun] = useState<AgentRunView | null>(null);
  const conversationPanel = useRef<HTMLElement>(null);
  const resultView = reviewedRun?.runId === run?.runId ? run : reviewedRun;
  const active = !!runId && (!run || ["QUEUED", "RUNNING", "WAITING_FOR_USER"].includes(run.status));

  useLayoutEffect(() => {
    const panel = conversationPanel.current;
    const main = panel?.closest<HTMLElement>(".workspace-main");
    const chat = panel?.querySelector<HTMLElement>(".agent-chat");
    const log = chat?.querySelector<HTMLElement>(".agent-chat-turns");
    if (!panel || !main || !chat || !log) return;
    // 제목과 번역 길이가 달라져도 실제 남은 높이로 대화 영역을 정한다.
    const flowHeight = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.position === "absolute" || style.position === "fixed") return 0;
      return element.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    };
    const updateHeight = () => {
      const top = panel.getBoundingClientRect().top + main.scrollTop;
      const height = window.visualViewport?.height ?? window.innerHeight;
      const chrome = [...chat.children].filter(element => element !== log).reduce((sum, element) => sum + flowHeight(element), 0);
      const auxiliary = [...panel.children].filter(element => element !== chat).reduce((sum, element) => sum + flowHeight(element), 0);
      const minimum = Math.ceil(chrome + auxiliary + parseFloat(getComputedStyle(log).minHeight));
      const value = `${Math.max(minimum, Math.floor(height - top - 16))}px`;
      if (panel.style.getPropertyValue("--pet-chat-height") !== value) panel.style.setProperty("--pet-chat-height", value);
    };
    const observer = new ResizeObserver(updateHeight);
    const workbench = panel.closest(".project-workbench");
    [main, workbench?.querySelector(".project-heading"), workbench?.querySelector(".workbench-steps"), workbench?.querySelector(".pet-conversation-shortcut")].forEach(element => {
      if (element) observer.observe(element);
    });
    const observeChrome = () => {
      [...chat.children, ...panel.children].filter(element => element !== log && element !== chat).forEach(element => observer.observe(element));
      updateHeight();
    };
    const mutation = new MutationObserver(observeChrome);
    mutation.observe(chat, { childList: true });
    mutation.observe(panel, { childList: true });
    observeChrome();
    window.addEventListener("resize", updateHeight);
    window.visualViewport?.addEventListener("resize", updateHeight);
    updateHeight();
    return () => {
      observer.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", updateHeight);
      window.visualViewport?.removeEventListener("resize", updateHeight);
    };
  }, [projectId]);

  function openResult(view: AgentRunView) {
    setReviewedRun(view);
  }

  return (
    <section className="pet-conversation-main" ref={conversationPanel}>
      <AgentChat
        key={`${session.userId}:${session.workspaceId}:${projectId}`}
        session={session}
        projectId={projectId}
        run={run}
        runId={runId}
        events={events}
        busy={busy}
        canRun={canRun}
        canEditPolicy={canEditPolicy}
        canCancel={canCancel}
        modelAvailable={modelAvailable}
        canSendAI={canSendAI}
        retryCandidates={retryCandidates}
        composerInfo={composerInfo}
        composerTools={composerTools}
        headerTools={
          <>
            {canRun && (
              <>
                <button type="button" className="quiet-button chat-pet-trigger" aria-label={t("펫 만들기·관리")} disabled={!canOpenPets || active} onClick={onOpenPets}>
                  <PawPrint size={18} aria-hidden="true" />
                  <span className="chat-action-long">{t("펫 만들기·관리")}</span><span className="chat-action-short" aria-hidden="true">{t("펫 관리")}</span>
                </button>
                <button type="button" className="secondary-button chat-quotation-start" aria-label={t("문의로 대화 시작")} disabled={busy || active || !canStartQuotation} onClick={onStartQuotation}>
                  <Receipt size={17} aria-hidden="true" />
                  <span className="chat-action-long">{t("문의로 대화 시작")}</span><span className="chat-action-short" aria-hidden="true">{t("문의로 시작")}</span>
                </button>
              </>
            )}
          </>
        }
        streamState={streamState}
        conversationTools={conversationTools}
        onInterrupt={onInterrupt}
        onOpenAISettings={onOpenAISettings}
        onSend={onSendMessage}
        onCancel={onCancel}
        onOpenResult={openResult}
        clarification={
          run?.interruption ? (
            <InterruptionForm
              key={run.interruption.interruptionId}
              interruption={run.interruption}
              draftKey={interruptionDraftKey(
                session.userId,
                session.workspaceId,
                runId ?? run.runId,
                run.interruption.interruptionId
              )}
              draftWorkspaceId={session.workspaceId}
              draftRunId={runId ?? run.runId}
              busy={busy}
              canRespond={canRespond}
              onSubmit={onResume}
            />
          ) : (
            <p>{t("사용자 확인을 기다리고 있습니다")}</p>
          )
        }
      />
      {quotationError && <p className="form-error" role="alert">{quotationError}</p>}
      {resultView?.result && (
        <WorkspacePanel title={t("분석 결과")} className="agent-chat-result-panel" onClose={() => setReviewedRun(null)}>
          <AnalysisResult
            run={resultView}
            events={resultView.runId === runId ? events : []}
            costUsage={resultView.runId === runId ? costUsage : null}
            onCompareQuotes={resultView.runId === runId ? onCompareQuotes : undefined}
          />
        </WorkspacePanel>
      )}
      {runId && <details className="pet-conversation-history"><summary>{t("실행 기록")}</summary><AnalysisTimeline events={events} run={run} /></details>}
    </section>
  );
}
