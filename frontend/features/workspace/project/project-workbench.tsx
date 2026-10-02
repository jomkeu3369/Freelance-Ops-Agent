import { useT } from "../../../app/lib/ui-language";
import {
  AuthSession,
  Project,
  Client,
  AgentRunView,
  WorkflowEvent,
  Provider,
  AgentRunUsage,
  getAgentRunUsage,
  ApiError
} from "../../../app/lib/api";
import { AIConnection, listAIConnections } from "../../../app/lib/api";
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
import { AnalysisStep } from "./analysis/analysis-step";
import { QuoteBuilder } from "./quotation/quote-builder";
import { OutcomeReview } from "./outcome/outcome-review";
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
  onRun: (provider: Provider, model: string, credentialId?: string, message?: string) => Promise<boolean>;
  onResetRun: () => void;
  onCancel: () => Promise<void>;
  onResume: (answers: string[]) => Promise<void>;
}

export function ProjectWorkbench({ session, project, clients, run, runId, events, busy, streamState, snapshot, permissions, initialStep, onStepChange, onProjectUpdated, onDelete, onRun, onResetRun, onCancel, onResume }: ProjectWorkbenchProps) {
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
  const deleteDialog = useRef<HTMLElement>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [costUsage, setCostUsage] = useState<AgentRunUsage | null>(null);
  const canRun = permissions.has("agent.run");
  const canRespond = permissions.has("agent.respond");
  const canCancel = permissions.has("agent.cancel");
  const chatModel = credentialId
    ? connection && !connectionError ? { provider: connection.provider, model: connection.model, credentialId: connection.id } : null
    : model.trim() ? { provider, model: model.trim(), credentialId: undefined } : null;

  useEffect(() => {
    if (!canRun) return;
    let cancelled = false;
    listAIConnections(session).then((value) => {
      if (!cancelled) { setConnections(value.connections); setConnectionError(false); }
    }).catch(() => { if (!cancelled) setConnectionError(true); });
    return () => { cancelled = true; };
  }, [canRun, session, runId]);

  useEffect(() => {
    Promise.resolve().then(() => {
      setActiveStep(initialStep);
      setShowDeleteConfirmation(false);
      setDeleteConfirmation("");
      setDeleteError(null);
    });
  }, [initialStep, project.id]);

  const selectStep = (step: WorkbenchStep) => {
    setActiveStep(step);
    onStepChange(step);
  };

  const closeDeleteConfirmation = useCallback(() => {
    if (deletingProject) return;
    setShowDeleteConfirmation(false);
    setDeleteConfirmation("");
    setDeleteError(null);
  }, [deletingProject]);

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

  return (
    <>
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
          onSendMessage={(message) => chatModel ? onRun(chatModel.provider, chatModel.model, chatModel.credentialId, message) : Promise.resolve(false)}
          costUsage={costUsage}
          onCancel={onCancel}
          onResume={onResume}
          onCompareQuotes={openQuotations}
        />
      )}

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
              ? { provider: run.metadata.provider, model: run.metadata.model, credentialId: run.metadata.credentialId }
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
    </>
  );
}
