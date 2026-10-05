import { useT } from "../../../app/lib/ui-language";
import {
  AuthSession,
  CreditQuote,
  isCreditQuoteRefreshRequired,
  isPlatformSpendUnavailable,
  Project,
  Client,
  AgentRunView,
  WorkflowEvent,
  Provider,
  AgentRunUsage,
  getAgentRunUsage,
  ApiError
} from "../../../app/lib/api";
import { AIConnection, isSupportedProvider, listAIConnections } from "../../../app/lib/api";
import { snapshotFromEvents } from "../../../app/components/live-workflow";
import { StreamState, WorkbenchStep } from "../shared/types";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  configuredModelOptions,
  terminalStatuses,
  pipelineStatusLabels,
  projectDeletionBlockingStatuses
} from "../shared/constants";
import { useDialogFocusTrap } from "../shared/use-dialog-focus-trap";
import {
  AddressBook,
  PencilSimple,
  Trash,
  CircleNotch,
  ArrowRight
} from "@phosphor-icons/react";
import { projectClientLabel } from "../shared/formatters";
import { IntakeReview } from "./intake/intake-review";
import { PetCustomizer } from "../pets/pet-customizer";
import type { PendingRunRetry } from "../../../app/lib/pending-run-store";
import { parseChatPolicyIntent } from "../../../app/lib/chat-policy-intent.mjs";
import { creditDecision, isWeeklyCreditUsage } from "../../../app/lib/credit-policy";
import { useCreditUsage } from "../usage/use-credit-usage";
import { CreditCostNote } from "../usage/credit-cost-note";
import { AiUsageMeter } from "../usage/ai-usage-meter";
import { useAiUsage } from "../usage/use-ai-usage";
import { includedUsageBlocker } from "../../../app/lib/ai-usage-presentation";
import { ChatModelControls } from "./analysis/chat-model-controls";
import { ChatModelMenu } from "./analysis/chat-model-menu";
import { AnalysisStep } from "./analysis/analysis-step";
import { QuoteBuilder } from "./quotation/quote-builder";
import { OutcomeReview } from "./outcome/outcome-review";
import { WorkspacePanel } from "../shared/workspace-panel";
import { ProjectEditDialog } from "./dialogs/project-edit-dialog";

interface ProjectWorkbenchProps {
  session: AuthSession;
  project: Project;
  clients: Client[];
  run: AgentRunView | null;
  runId: string | null;
  events: WorkflowEvent[];
  busy: boolean;
  streamState: StreamState;
  snapshot: ReturnType<typeof snapshotFromEvents>;
  permissions: Set<string>;
  initialStep: WorkbenchStep;
  onStepChange: (step: WorkbenchStep) => void;
  onProjectUpdated: (project: Project) => void;
  onDelete: () => Promise<void>;
  onRun: (provider: Provider, model: string, credentialId?: string, message?: string, creditQuote?: CreditQuote) => Promise<boolean>;
  pendingRetries: PendingRunRetry[];
  onResetRun: () => void;
  onCancel: () => Promise<void>;
  onResume: (answers: string[]) => Promise<void>;
}

export function ProjectWorkbench({ session, project, clients, run, runId, events, busy, streamState, snapshot, permissions, initialStep, onStepChange, onProjectUpdated, onDelete, onRun, pendingRetries, onResetRun, onCancel, onResume }: ProjectWorkbenchProps) {
  const t = useT();
  const [provider, setProvider] = useState<Provider>("OPENAI");
  const [connections, setConnections] = useState<AIConnection[]>([]);
  const [credentialId, setCredentialId] = useState("");
  const [connectionError, setConnectionError] = useState(false);
  const connection = connections.find((item) => item.id === credentialId);
  const [model, setModel] = useState(configuredModelOptions.OPENAI[0] ?? "");
  const [activeStep, setActiveStep] = useState<WorkbenchStep>(initialStep);
  const [editingProject, setEditingProject] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const deleteDialog = useRef<HTMLElement>(null);
  const aiSettingsContent = useRef<HTMLDivElement>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [costUsage, setCostUsage] = useState<AgentRunUsage | null>(null);
  const [creditReviewRequired, setCreditReviewRequired] = useState(false);
  const canRun = permissions.has("agent.run");
  const usage = useCreditUsage(session, `${runId ?? ""}:${run?.status ?? ""}`);
  const ledger = useAiUsage(session, `${runId ?? ""}:${run?.status ?? ""}`);
  const weeklyUsage = isWeeklyCreditUsage(usage.data) ? usage.data : null;
  const canRespond = permissions.has("agent.respond") && (!run?.metadata || isSupportedProvider(run.metadata.provider));
  const canCancel = permissions.has("agent.cancel");
  const chatModel = credentialId
    ? connection && isSupportedProvider(connection.provider) && !connectionError ? { provider: connection.provider, model: connection.model, credentialId: connection.id } : null
    : model.trim() ? { provider, model: model.trim(), credentialId: undefined } : null;

  const credit = creditDecision(usage.loading ? null : usage.data, chatModel?.provider ?? provider, chatModel?.model ?? model, chatModel?.credentialId);
  const retryCandidates = pendingRetries.filter(item => !!chatModel && item.provider === chatModel.provider && item.model === chatModel.model && (item.credentialId ?? "") === (chatModel.credentialId ?? ""));
  const ledgerBlocker = includedUsageBlocker(ledger.data, chatModel?.provider ?? provider, chatModel?.model ?? model);
  const ledgerMessage = ledger.loading ? t("사용량 확인 중…") : ledgerBlocker === "paused" ? t("기본 제공 AI 실행이 현재 중지되어 있습니다.") : ledgerBlocker === "model" ? t("선택한 모델의 지원 여부와 예약 상한을 확인해 주세요.") : ledgerBlocker === "insufficient" ? t("선택한 모델의 예약 상한보다 잔여 예산이 적습니다.") : t("사용량과 비용 상한을 확인한 뒤 기본 제공 AI를 보낼 수 있습니다.");
  const canSendAI = !!chatModel && (credit.kind === "byok" || credit.kind === "ready" && !ledgerBlocker && !ledger.loading);

  async function sendMessage(message: string) {
    if (!chatModel) return false;
    const retry = retryCandidates.find(item => item.message === message);
    if (!retry && credit.kind !== "ready" && credit.kind !== "byok") throw new Error(t("크레딧 가격과 잔여량을 확인한 뒤 다시 보내 주세요."));
    if (!retry && credit.kind !== "byok" && (ledger.loading || ledgerBlocker)) throw new Error(ledgerMessage);
    try {
      const accepted = await onRun(chatModel.provider, chatModel.model, chatModel.credentialId, message, retry ? retry.creditQuote : credit.kind === "ready" ? credit.quote : undefined);
      if (accepted) setCreditReviewRequired(false);
      return accepted;
    } catch (cause) {
      if (isCreditQuoteRefreshRequired(cause)) {
        setCreditReviewRequired(true);
        await usage.refresh();
        throw new Error(cause.code === "PLATFORM_MODEL_UNAVAILABLE"
          ? t("이 모델은 기본 제공 AI에서 사용할 수 없습니다. 다른 모델이나 개인 API 키를 선택해 주세요.")
          : t("크레딧 가격을 다시 확인했습니다. 새 차감량을 검토하고 직접 다시 보내 주세요."));
      }
      if (isPlatformSpendUnavailable(cause)) throw new Error(t("AI 분석의 운영 보호한도 때문에 요청을 시작하지 못했습니다. 사용자 크레딧 소진과는 별개입니다. 자동으로 다시 보내지 않습니다."));
      throw cause;
    }
  }

  useEffect(() => {
    if (!canRun) return;
    let cancelled = false;
    listAIConnections(session).then((value) => {
      if (!cancelled) { setConnections(value.connections.filter((item) => isSupportedProvider(item.provider))); setConnectionError(false); }
    }).catch(() => { if (!cancelled) setConnectionError(true); });
    return () => { cancelled = true; };
  }, [canRun, session, runId]);

  useEffect(() => {
    Promise.resolve().then(() => {
      setActiveStep(initialStep);
      setShowAISettings(false);
      setShowDeleteConfirmation(false);
      setDeleteConfirmation("");
      setDeleteError(null);
    });
  }, [initialStep, project.id]);

  const selectStep = (step: WorkbenchStep) => {
    setActiveStep(step);
    setShowAISettings(false);
    onStepChange(step);
  };

  const closeDeleteConfirmation = useCallback(() => {
    if (deletingProject) return;
    setShowDeleteConfirmation(false);
    setDeleteConfirmation("");
    setDeleteError(null);
  }, [deletingProject, setShowDeleteConfirmation, setDeleteConfirmation, setDeleteError]);

  useDialogFocusTrap(deleteDialog, closeDeleteConfirmation, deletingProject, showDeleteConfirmation);

  useEffect(() => {
    if (!runId || !run || !terminalStatuses.has(run.status) || !permissions.has("audit.read")) {
      Promise.resolve().then(() => setCostUsage(null));
      return;
    }
    let cancelled = false;
    getAgentRunUsage(session, runId)
      .then((usage) => {
        if (!cancelled) setCostUsage(usage);
      })
      .catch(() => {
        if (!cancelled) setCostUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [permissions, run, runId, session]);

  function openQuotations() {
    selectStep("quote");
  }

  async function deleteProject() {
    setDeletingProject(true);
    setDeleteError(null);
    try {
      await onDelete();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setDeleteError("진행 중이거나 확인을 기다리는 AI 분석이 있습니다. AI 분석에서 실행을 중단한 뒤 다시 삭제해 주세요.");
      } else {
        setDeleteError(cause instanceof Error ? cause.message : "프로젝트를 삭제하지 못했습니다.");
      }
      setDeletingProject(false);
    }
  }

  function openAISettings() { setShowAISettings(true); }

  const runInProgress = !!runId && (!run || projectDeletionBlockingStatuses.has(run.status));
  const selectionLocked = busy || runInProgress;
  const selectedModelName = runInProgress ? run?.metadata?.model || t("AI 모델")
    : credentialId ? chatModel?.model ?? t("AI 연결 확인 필요") : model || t("AI 모델 선택");
  const selectedUsesPersonalKey = runInProgress ? !!run?.metadata?.credentialId : !!credentialId && !!chatModel;
  const selectedModelLabel = `${selectedUsesPersonalKey ? `${t("내 키 ·")} ` : ""}${selectedModelName}`;
  const modelControls = !selectionLocked ? <ChatModelControls
    catalogModels={ledger.data?.models ?? null}
    modelRates={weeklyUsage?.modelRates ?? null} connections={connections} credentialId={credentialId} provider={provider} model={model}
    busy={busy} connectionError={connectionError} onCredentialChange={setCredentialId}
    onProviderChange={value => { setProvider(value); setModel(configuredModelOptions[value][0] ?? ""); }} onModelChange={setModel} />
    : <p className="model-selection-note">{t("작업 중에는 AI 설정을 바꿀 수 없습니다.")}</p>;

  function prepareNextAnalysis() {
    onResetRun();
    requestAnimationFrame(() => aiSettingsContent.current?.querySelector<HTMLSelectElement>("select")?.focus());
  }

  const aiSettings = activeStep === "agent" && canRun && showAISettings ? (
    <WorkspacePanel title={t("AI 설정")} className="agent-chat-settings" onClose={() => setShowAISettings(false)}>
      <div ref={aiSettingsContent}>
      {modelControls}
      {!runId && <PetCustomizer key={`${session.workspaceId}:${session.userId}:${project.id}`} session={session} projectId={project.id} disabled={busy} selection={chatModel} />}
      {runId && !selectionLocked && <button type="button" className="secondary-button" onClick={prepareNextAnalysis}><ArrowRight size={18} />{t("새 분석 준비")}</button>}
      </div>
    </WorkspacePanel>
  ) : null;

  return (
    <section className={`project-workbench${activeStep === "agent" ? " is-chat" : ""}`}>
      <div className={`project-heading${activeStep === "agent" ? " chat-project-heading" : ""}`}>
        <div>
          <div className="project-context-line">
            <span className="project-status">
              <i /> {t(pipelineStatusLabels[project.status]) ?? project.status}
            </span>
          </div>
          <h1>{project.title}</h1>
          <span className="project-client">
            <AddressBook size={15} />
            {projectClientLabel(project, clients, t)}
          </span>
        </div>
        {activeStep !== "agent" &&
          (permissions.has("project.write") || permissions.has("project.delete")) && (
            <div className="project-heading-actions">
              {permissions.has("project.write") && (
                <button type="button" className="secondary-button" onClick={() => setEditingProject(true)}>
                  <PencilSimple size={18} /> {t("프로젝트 정보 수정")}</button>
              )}
              {permissions.has("project.delete") && (
                <button
                  type="button"
                  className="quiet-button danger"
                  onClick={() => setShowDeleteConfirmation(true)}
                >
                  <Trash size={18} /> {t("프로젝트 삭제")}</button>
              )}
            </div>
          )}
      </div>


      {showDeleteConfirmation && (
        <div className="project-delete-backdrop">
          <section
            ref={deleteDialog}
            className="project-delete-confirmation"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="project-delete-title"
            aria-describedby="project-delete-description"
          >
            <header>
              <span className="project-delete-icon" aria-hidden="true">
                <Trash size={22} />
              </span>
              <div>
                <span>{t("프로젝트 삭제")}</span>
                <h2 id="project-delete-title">{t("정말 삭제하시겠어요?")}</h2>
              </div>
              <button
                type="button"
                className="project-delete-close"
                aria-label={t("삭제 창 닫기")}
                disabled={deletingProject}
                onClick={closeDeleteConfirmation}
              >
                ×
              </button>
            </header>
            <div className="project-delete-copy" id="project-delete-description">
              <p>{t("삭제하면 다음 자료를 다시 복구할 수 없습니다.")}</p>
              <ul>
                <li>{t("정리된 요구사항")}</li>
                <li>{t("AI 분석 기록")}</li>
                <li>{t("견적과 결과 기록")}</li>
              </ul>
              {run && projectDeletionBlockingStatuses.has(run.status) && (
                <p>{t("진행 중이거나 확인 대기 중인 AI 분석은 먼저 안전하게 중단합니다.")}</p>
              )}
            </div>
            <label>
              <span>{t("확인을 위해 프로젝트명을 입력해 주세요.")}</span>
              <strong>{project.title}</strong>
              <input
                autoComplete="off"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={t("프로젝트명 입력")}
              />
            </label>
            {deleteError && (
              <p className="form-error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="project-delete-actions">
              <button
                type="button"
                className="quiet-button"
                disabled={deletingProject}
                onClick={closeDeleteConfirmation}
              >
                {t("취소")}</button>
              <button
                type="button"
                className="danger-button"
                disabled={deletingProject || deleteConfirmation !== project.title}
                onClick={deleteProject}
              >
                {deletingProject ? <CircleNotch size={17} className="spin" /> : <Trash size={17} />} {t("영구 삭제")}</button>
            </div>
          </section>
        </div>
      )}

      <nav className="workbench-steps" aria-label={t("프로젝트 진행 단계")}>
        {(
          [
            ["intake", "01", "문의"],
            ["agent", "02", "AI 분석"],
            ["quote", "03", "견적"],
            ["outcome", "04", "결과"]
          ] as const
        ).map(([id, number, label]) => (
          <button
            type="button"
            key={id}
            aria-current={activeStep === id ? "step" : undefined}
            className={activeStep === id ? "active" : ""}
            onClick={() => selectStep(id)}
          >
            <span>{number}</span>
            {t(label)}
          </button>
        ))}
      </nav>

      {activeStep === "intake" && (
        <IntakeReview
          session={session}
          project={project}
          permissions={permissions}
          onContinue={() => selectStep("agent")}
        />
      )}

      {activeStep === "agent" && (
        <AnalysisStep
          key={`${session.userId}:${session.workspaceId}:${project.id}`}
          session={session}
          projectId={project.id}
          run={run}
          runId={runId}
          events={events}
          busy={busy}
          streamState={streamState}
          snapshot={snapshot}
          canCancel={canCancel}
          canRespond={canRespond}
          canRun={canRun}
          canEditPolicy={permissions.has("quotation.write") && permissions.has("quotation.read") && permissions.has("project.read")}
          modelAvailable={!!chatModel}
          canSendAI={canSendAI}
          retryMessages={retryCandidates.map(item => item.message)}
          usageState={usage}
          composerInfo={(draft) => <><CreditCostNote reviewRequired={creditReviewRequired} policy={!!parseChatPolicyIntent(draft)} active={runInProgress} decision={credit} retry={retryCandidates.find(item => item.message === draft)} loading={usage.loading} onRetry={() => void usage.refresh()} />
            {!runInProgress && !parseChatPolicyIntent(draft) && !retryCandidates.some(item => item.message === draft) && credit.kind !== "byok" && ledgerBlocker && <div className="agent-chat-credit-note"><div className="chat-credit-notice" role="status">{ledgerMessage}{!ledger.loading && <button type="button" className="quiet-button" onClick={() => void ledger.refresh()}>{t("다시 확인")}</button>}</div></div>}
            <AiUsageMeter session={session} state={ledger} /></>}
          composerTools={canRun ? <ChatModelMenu contextKey={`${project.id}:${runId ?? "new"}`} label={selectedModelLabel} locked={selectionLocked}>{modelControls}</ChatModelMenu> : null}
          onOpenAISettings={openAISettings}
          onSendMessage={sendMessage}
          costUsage={costUsage}
          onCancel={onCancel}
          onResume={onResume}
          onCompareQuotes={openQuotations}
        />
      )}

      {run?.metadata && !isSupportedProvider(run.metadata.provider) && <p role="status">{t("이전 AI 제공사는 지원이 종료되었습니다. 새 분석을 시작해 주세요.")}</p>}
      {aiSettings}

      {activeStep === "quote" && (
        <QuoteBuilder
          key={project.id}
          session={session}
          project={project}
          permissions={permissions}
          quotationDraft={run?.result?.quotationDraft ?? null}
          quotationDrafts={run?.result?.quotationDrafts ?? []}
          petProfiles={run?.metadata?.petProfiles}
          modelSelection={
            run?.metadata
              ? isSupportedProvider(run.metadata.provider)
                ? { provider: run.metadata.provider, model: run.metadata.model, credentialId: run.metadata.credentialId }
                : null
              : { provider: "OPENAI", model: configuredModelOptions.OPENAI[0] ?? "" }
          }
        />
      )}
      {activeStep === "outcome" && (
        <OutcomeReview session={session} project={project} permissions={permissions} />
      )}
      {editingProject && (
        <ProjectEditDialog
          session={session}
          project={project}
          clients={clients}
          onClose={() => setEditingProject(false)}
          onUpdated={(updated) => {
            onProjectUpdated(updated);
            setEditingProject(false);
          }}
        />
      )}
    </section>
  );
}
