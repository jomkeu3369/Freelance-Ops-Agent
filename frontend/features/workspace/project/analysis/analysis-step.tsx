import type { PendingRunRetry } from "../../../../app/lib/pending-run-store";
import type { SkillSelection } from "../../skills/skill-selection";
import { ListChecks, CaretRight, PawPrint, Receipt } from "@phosphor-icons/react";
import { ReactNode, useState } from "react";
import { useT } from "../../../../app/lib/ui-language";
import { AuthSession, AgentRunView, AgentRunUsage, WorkflowEvent } from "../../../../app/lib/api";
import { LiveWorkflow, snapshotFromEvents } from "../../../../app/components/live-workflow";
import { interruptionDraftKey } from "../../../../app/lib/interruption-draft.mjs";
import { StreamState } from "../../shared/types";
import { InterruptionForm } from "./interruption-form";
import { AnalysisTimeline } from "./analysis-timeline";
import { AnalysisResult } from "./analysis-result";
import { PetWorkspace } from "../../pets/pet-workspace";
import { WorkspacePanel } from "../../shared/workspace-panel";
import { AgentChat } from "./agent-chat";

interface AnalysisStepProps {
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

export function AnalysisStep({ session, projectId, run, runId, events, busy, snapshot, canCancel, canRespond, canRun, canEditPolicy, modelAvailable, composerTools, composerInfo, canSendAI, canStartQuotation, canOpenPets, onStartQuotation, onOpenPets, quotationError, retryCandidates, streamState, onOpenAISettings, onSendMessage, costUsage, onCancel, onResume, onCompareQuotes }: AnalysisStepProps) {
  const t = useT();
  const [reviewedRun, setReviewedRun] = useState<AgentRunView | null>(null);
  const [showWorkDetails, setShowWorkDetails] = useState(false);
  const resultView = reviewedRun?.runId === run?.runId ? run : reviewedRun;
  const active = !!runId && (!run || ["QUEUED", "RUNNING", "WAITING_FOR_USER"].includes(run.status));

  function openResult(view: AgentRunView) {
    setReviewedRun(view);
  }

  return (
    <>
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
                <button type="button" className="quiet-button chat-pet-trigger" disabled={!canOpenPets || active} onClick={onOpenPets}>
                  <PawPrint size={18} aria-hidden="true" />
                  <span>{t("함께할 펫")}</span>
                </button>
                <button type="button" className="primary-button chat-quotation-start" disabled={busy || active || !canStartQuotation} onClick={onStartQuotation}>
                  <Receipt size={17} aria-hidden="true" />
                  <span>{t("펫과 견적 만들기")}</span>
                </button>
              </>
            )}
            {runId && (
              <button
                type="button"
                className="quiet-button chat-work-details-trigger"
                onClick={() => setShowWorkDetails(true)}
              >
                <ListChecks size={18} aria-hidden="true" />
                <span>{t("작업 자세히 보기")}</span>
                <CaretRight size={13} aria-hidden="true" />
              </button>
            )}
          </>
        }
        streamState={streamState}
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
      {runId && showWorkDetails && (
        <WorkspacePanel
          title={t("작업 자세히 보기")}
          className="agent-chat-work-details"
          onClose={() => setShowWorkDetails(false)}
        >
          {run?.metadata && (
            <p className="model-selection-note">
              {run.metadata.credentialId ? t("개인 API 키") : t("기본 제공 AI")} · {run.metadata.provider} ·{" "}
              {run.metadata.model}
            </p>
          )}
          <PetWorkspace key={runId} run={run} />
          <LiveWorkflow snapshot={snapshot} />
          <AnalysisTimeline events={events} run={run} />
        </WorkspacePanel>
      )}
    </>
  );
}
