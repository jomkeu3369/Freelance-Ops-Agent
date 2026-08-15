"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  ArrowLeft,
  ArrowRight,
  AddressBook,
  Archive,
  CheckCircle,
  CaretDown,
  CircleNotch,
  Copy,
  Clock,
  FileText,
  FolderOpen,
  Graph,
  GearSix,
  House,
  Eye,
  EyeSlash,
  MagnifyingGlass,
  Moon,
  PencilSimple,
  Plus,
  Receipt,
  SignOut,
  Sun,
  Trash,
  Warning,
  Waveform,
} from "@phosphor-icons/react";
import { LiveWorkflow, snapshotFromEvents } from "../components/live-workflow";
import { isActiveStreamStatus, nextStreamCursor, streamReconnectDelay } from "../lib/stream-retry.mjs";
import { sessionRefreshDelay } from "../lib/session-timing.mjs";
import { buildWorkspaceSearch, parseWorkspaceLocation } from "../lib/workspace-navigation.mjs";
import { createQuotationDraft, parseQuotationDraft, quotationDraftFingerprint, quotationDraftKey } from "../lib/quotation-draft.mjs";
import { hydrateMissingDraftRates, selectRateCardForDraftItem } from "../lib/rate-card-match.mjs";
import { createInterruptionDraft, interruptionDraftKey, parseInterruptionDraft } from "../lib/interruption-draft.mjs";
import {
  AgentRunView,
  AgentRunUsage,
  AgentQuotationDraft,
  ApiError,
  ActualOutcome,
  AuthSession,
  Client,
  ClientInput,
  EstimationPolicy,
  KnowledgeDocument,
  MeProfile,
  ModelPricing,
  Project,
  ProjectInput,
  ProjectStatus,
  ProposalShare,
  Provider,
  Quotation,
  QuotationItemInput,
  QuotationScenario,
  RateCard,
  RequirementFeature,
  RequirementVersion,
  WorkflowEvent,
  clearSession,
  cancelAgentRun,
  archiveDocument,
  archiveClient,
  createClient,
  createDocument,
  createModelPricing,
  createProposalShare,
  createQuotation,
  createRequirementVersion,
  createProject,
  deleteProject,
  getAgentRun,
  getAgentRunUsage,
  getDocument,
  getEstimationPolicy,
  getMe,
  getOutcome,
  listRateCards,
  listRequirements,
  listQuotations,
  reloadQuotations,
  listDocuments,
  listModelPricing,
  listClients,
  listProjects,
  loadSession,
  login,
  register,
  refreshAuthSession,
  reviseQuotation,
  revokeProposalShare,
  revokeAuthSession,
  resumeAgentRun,
  saveSession,
  saveOutcome,
  saveEstimationPolicy,
  saveRateCard,
  startAgentRun,
  streamRunEvents,
  subscribeToSessionRecovery,
  publishQuotation,
  updateProject,
  updateProjectDetails,
  updateClient,
} from "../lib/api";

type AuthMode = "login" | "register";
type WorkspaceView = "pipeline" | "clients" | "knowledge" | "project" | "settings";
type WorkbenchStep = "intake" | "agent" | "quote" | "outcome";
type StreamState = "idle" | "connecting" | "connected" | "reconnecting" | "settled";

gsap.registerPlugin(useGSAP);

const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "WAITING_FOR_USER"]);

const currencyOptions = [
  { value: "KRW", label: "대한민국 원 (KRW)" },
  { value: "USD", label: "미국 달러 (USD)" },
  { value: "JPY", label: "일본 엔 (JPY)" },
] as const;

function parseModelOptions(value: string | undefined) {
  return [...new Set((value ?? "").split(",").map((model) => model.trim()).filter(Boolean))];
}

const defaultOpenAIModel = process.env.NEXT_PUBLIC_DEFAULT_MODEL?.trim();
const configuredModelOptions: Record<Provider, string[]> = {
  OPENAI: parseModelOptions(process.env.NEXT_PUBLIC_OPENAI_MODELS).length > 0
    ? parseModelOptions(process.env.NEXT_PUBLIC_OPENAI_MODELS)
    : [defaultOpenAIModel || "gpt-5.6-luna", "gpt-5.6-terra"].filter((model, index, models) => models.indexOf(model) === index),
  GEMINI: parseModelOptions(process.env.NEXT_PUBLIC_GEMINI_MODELS),
};

const suggestedModelOptions = [...new Set([...configuredModelOptions.OPENAI, ...configuredModelOptions.GEMINI])];

const subscribeToThemeHydration = () => () => undefined;

export default function WorkspacePage() {
  const themeMounted = useSyncExternalStore(subscribeToThemeHydration, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const isDarkTheme = themeMounted && resolvedTheme === "dark";
  const [session, setSession] = useState<AuthSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const selectedProjectIdRef = useRef<string | null>(null);
  const [run, setRun] = useState<AgentRunView | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [streamRetryCount, setStreamRetryCount] = useState(0);
  const lastEventIdRef = useRef(0);
  const previousRunIdRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [executionRevision, setExecutionRevision] = useState(0);
  const [activeView, setActiveView] = useState<WorkspaceView>("pipeline");
  const [projectStep, setProjectStep] = useState<WorkbenchStep>("intake");
  const runStatus = run?.status;
  const activePermissions = useMemo(
    () => new Set(profile?.workspaces.find((workspace) => workspace.workspaceId === session?.workspaceId)?.effectivePermissions ?? []),
    [profile, session?.workspaceId],
  );
  const canWriteProject = activePermissions.has("project.write");

  const applyWorkspaceLocation = useCallback((projectResult: Project[], permissions: Set<string>, replaceInvalid = false) => {
    const location = parseWorkspaceLocation(window.location.search);
    const viewAllowed = location.view !== "clients" || permissions.has("client.read");
    const knowledgeAllowed = location.view !== "knowledge" || permissions.has("document.read");
    const project = location.view === "project" ? projectResult.find((item) => item.id === location.projectId) ?? null : null;

    if (!viewAllowed || !knowledgeAllowed || (location.view === "project" && !project)) {
      setActiveView("pipeline");
      setProjectStep("intake");
      setSelectedProject((current) => current ?? projectResult[0] ?? null);
      if (replaceInvalid) window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    setActiveView(location.view as WorkspaceView);
    if (project) {
      if (selectedProjectIdRef.current !== project.id) {
        setRun(null);
        setRunId(null);
        setEvents([]);
        setStreamState("idle");
        setStreamRetryCount(0);
      }
      selectedProjectIdRef.current = project.id;
      setSelectedProject(project);
      setProjectStep(location.step as WorkbenchStep);
    } else {
      setSelectedProject((current) => current ?? projectResult[0] ?? null);
      setProjectStep("intake");
    }
  }, []);

  const navigateWorkspace = useCallback((view: WorkspaceView, project?: Project | null, step: WorkbenchStep = "intake", replace = false) => {
    const nextProject = view === "project" ? project ?? selectedProject : null;
    const nextView = view === "project" && !nextProject ? "pipeline" : view;
    const projectChanged = nextView === "project" && nextProject?.id !== selectedProject?.id;
    const search = buildWorkspaceSearch({ view: nextView, projectId: nextProject?.id, step });
    window.history[replace ? "replaceState" : "pushState"](null, "", `${window.location.pathname}${search}`);
    setActiveView(nextView);
    setProjectStep(nextView === "project" ? step : "intake");
    if (nextProject) {
      selectedProjectIdRef.current = nextProject.id;
      setSelectedProject(nextProject);
    }
    if (projectChanged) {
      setRun(null);
      setRunId(null);
      setEvents([]);
      setStreamState("idle");
      setStreamRetryCount(0);
    }
  }, [selectedProject]);

  const refreshProjects = useCallback(async (activeSession: AuthSession) => {
    const profileResult = await getMe(activeSession);
    const workspace = profileResult.workspaces.find((item) => item.workspaceId === activeSession.workspaceId);
    const permissions = new Set(workspace?.effectivePermissions ?? []);
    const [projectResult, clientResult] = await Promise.all([
      permissions.has("project.read") ? listProjects(activeSession) : Promise.resolve([]),
      permissions.has("client.read") ? listClients(activeSession) : Promise.resolve([]),
    ]);
    setProjects(projectResult);
    setClients(clientResult.filter((client) => client.status === "ACTIVE"));
    setProfile(profileResult);
    applyWorkspaceLocation(projectResult, permissions, true);
  }, [applyWorkspaceLocation]);

  useEffect(() => {
    Promise.resolve().then(() => {
      const stored = loadSession();
      if (stored) {
        const restore = async () => {
          try {
            const activeSession = new Date(stored.accessTokenExpiresAt).getTime() <= Date.now() + 30_000
              ? { ...(await refreshAuthSession(stored)), workspaceId: stored.workspaceId }
              : stored;
            if (activeSession !== stored) saveSession(activeSession);
            setSession(activeSession);
            await refreshProjects(activeSession);
          } catch (cause) {
            clearSession();
            setError(cause instanceof Error ? cause.message : "로그인 세션을 복구하지 못했습니다.");
          } finally {
            setHydrated(true);
          }
        };
        void restore();
      } else {
        setSession(null);
        setHydrated(true);
      }
    });
  }, [refreshProjects]);

  useEffect(() => subscribeToSessionRecovery((recoveredSession) => {
    if (recoveredSession) {
      setSession(recoveredSession);
      return;
    }
    setSession(null);
    setProjects([]);
    setClients([]);
    setProfile(null);
    setSelectedProject(null);
    setRun(null);
    setRunId(null);
    setEvents([]);
    setStreamState("idle");
    setStreamRetryCount(0);
    setError("로그인 시간이 만료되었습니다. 다시 로그인해 주세요.");
  }), []);

  useEffect(() => {
    if (!session) return;
    const restoreLocation = () => applyWorkspaceLocation(projects, activePermissions, true);
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [activePermissions, applyWorkspaceLocation, projects, session]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      refreshAuthSession(session)
        .then((nextSession) => {
          const preservedSession = { ...nextSession, workspaceId: session.workspaceId };
          saveSession(preservedSession);
          setSession(preservedSession);
        })
        .catch(() => { clearSession(); setSession(null); setError("로그인 시간이 만료되었습니다. 다시 로그인해 주세요."); });
    }, sessionRefreshDelay(session.accessTokenExpiresAt));
    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    if (previousRunIdRef.current !== runId) {
      previousRunIdRef.current = runId;
      lastEventIdRef.current = 0;
    }
  }, [runId]);

  useEffect(() => {
    if (!session || !runId) return;
    if (!isActiveStreamStatus(runStatus)) {
      Promise.resolve().then(() => {
        setStreamState("settled");
        setStreamRetryCount(0);
      });
      return;
    }

    const controller = new AbortController();
    let retryTimer: number | undefined;
    let attempt = 0;
    let cancelled = false;

    const scheduleReconnect = () => {
      if (cancelled || controller.signal.aborted) return;
      attempt += 1;
      setStreamState("reconnecting");
      setStreamRetryCount(attempt);
      retryTimer = window.setTimeout(() => void connect(), streamReconnectDelay(attempt));
    };

    const connect = async () => {
      if (cancelled || controller.signal.aborted) return;
      setStreamState(attempt === 0 ? "connecting" : "reconnecting");
      try {
        await streamRunEvents(
          session,
          runId,
          (event) => {
            if (cancelled || controller.signal.aborted) return;
            lastEventIdRef.current = nextStreamCursor(lastEventIdRef.current, event.eventId);
            setEvents((current) => current.some((item) => item.eventId === event.eventId) ? current : [...current, event]);
          },
          controller.signal,
          lastEventIdRef.current || undefined,
          () => {
            if (cancelled || controller.signal.aborted) return;
            attempt = 0;
            setStreamState("connected");
            setStreamRetryCount(0);
          },
        );
        scheduleReconnect();
      } catch {
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
  }, [executionRevision, runId, runStatus, session]);

  useEffect(() => {
    if (!session || !runId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const view = await getAgentRun(session, runId);
        if (!cancelled) setRun(view);
        return terminalStatuses.has(view.status);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "실행 상태를 확인하지 못했습니다.");
        return true;
      }
    };
    const timer = window.setInterval(async () => {
      if (await poll()) window.clearInterval(timer);
    }, 2000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [executionRevision, runId, session]);

  const onAuthenticated = async (nextSession: AuthSession, isNewWorkspace = false) => {
    saveSession(nextSession);
    setSession(nextSession);
    setError(null);
    await refreshProjects(nextSession);
    if (isNewWorkspace) navigateWorkspace("settings", null, "intake", true);
  };

  const logout = async () => {
    if (!session) return;
    try {
      await revokeAuthSession(session);
    } finally {
      clearSession();
      setSession(null);
      setProjects([]);
      setClients([]);
      setProfile(null);
      setSelectedProject(null);
      setRun(null);
      setRunId(null);
      setEvents([]);
    }
  };

  const beginRun = async (provider: Provider, model: string) => {
    if (!session || !selectedProject) return;
    setBusy(true);
    setError(null);
    setEvents([]);
    setRun(null);
    try {
      const accepted = await startAgentRun(session, selectedProject, {
        provider,
        model,
        reasoningEffort: "LOW",
      });
      setRunId(accepted.runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent 실행을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const snapshot = useMemo(
    () => snapshotFromEvents(events, run?.status ?? (runId ? "RUNNING" : "IDLE")),
    [events, run?.status, runId],
  );
  if (!hydrated) {
    return <main id="main-content" className="workspace-loading" aria-busy="true"><CircleNotch size={30} className="spin" /><span>업무 공간을 준비하고 있습니다.</span></main>;
  }

  if (!session) return <AuthGate onAuthenticated={onAuthenticated} error={error} setError={setError} />;

  return (
    <main id="main-content" className="workspace-shell">
      <header className="workspace-topbar">
        <button type="button" className="workspace-brand" onClick={() => navigateWorkspace("pipeline")}><House size={18} /> Freelance Ops</button>
        <div className="workspace-live-status" role="status" aria-live="polite">
          <span className={streamState === "connected" ? "connected" : streamState === "reconnecting" ? "reconnecting" : ""} />
          {!runId ? "실행 대기" : streamState === "connected" ? "실시간 연결됨" : streamState === "connecting" ? "실시간 연결 중" : streamState === "reconnecting" ? `재연결 중${streamRetryCount > 1 ? ` · ${streamRetryCount}차` : ""}` : run?.status === "WAITING_FOR_USER" ? "사용자 확인 대기" : "실행 상태 동기화됨"}
        </div>
        <div className="workspace-account-actions">
          {profile && profile.workspaces.length > 1 && <label><span className="sr-only">작업 공간 전환</span><select value={session.workspaceId} onChange={async (event) => {
            const nextSession = { ...session, workspaceId: event.target.value };
            saveSession(nextSession);
            setSession(nextSession);
            setSelectedProject(null);
            setRun(null);
            setRunId(null);
            setEvents([]);
            setError(null);
            navigateWorkspace("pipeline", null, "intake", true);
            try { await refreshProjects(nextSession); } catch (cause) { setError(cause instanceof Error ? cause.message : "작업 공간을 전환하지 못했습니다."); }
          }}>{profile.workspaces.map((workspace) => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.name}</option>)}</select></label>}
          <button type="button" className="icon-button workspace-theme-toggle" aria-label={isDarkTheme ? "라이트 모드로 전환" : "다크 모드로 전환"} title={isDarkTheme ? "라이트 모드" : "다크 모드"} onClick={() => setTheme(isDarkTheme ? "light" : "dark")}>
            {isDarkTheme ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button type="button" className="quiet-button" onClick={() => void logout()}><SignOut size={18} /> 로그아웃</button>
        </div>
      </header>

      <aside className="workspace-sidebar">
        <div className="workspace-nav">
          <button type="button" aria-label="프로젝트 현황" aria-current={activeView === "pipeline" ? "page" : undefined} className={activeView === "pipeline" ? "active" : ""} onClick={() => navigateWorkspace("pipeline")}><House size={18} /><span className="nav-label-desktop">프로젝트 현황</span><span className="nav-label-mobile">현황</span></button>
          {activePermissions.has("client.read") && <button type="button" aria-current={activeView === "clients" ? "page" : undefined} className={activeView === "clients" ? "active" : ""} onClick={() => navigateWorkspace("clients")}><AddressBook size={18} /><span>고객</span></button>}
          {activePermissions.has("document.read") && <button type="button" aria-current={activeView === "knowledge" ? "page" : undefined} className={activeView === "knowledge" ? "active" : ""} onClick={() => navigateWorkspace("knowledge")}><FileText size={18} /><span>근거 자료</span></button>}
          <button type="button" aria-current={activeView === "settings" ? "page" : undefined} className={activeView === "settings" ? "active" : ""} onClick={() => navigateWorkspace("settings")}><GearSix size={18} /><span>설정</span></button>
        </div>
        <div className="sidebar-heading">
          <span>프로젝트</span>
          {canWriteProject && <button type="button" onClick={() => setShowNewProject(true)} aria-label="새 프로젝트 만들기"><Plus size={18} /></button>}
        </div>
        <div className="mobile-project-switcher">
          <label>
            <span className="sr-only">프로젝트 바로가기</span>
            <select
              aria-label="프로젝트 바로가기"
              value={activeView === "project" ? selectedProject?.id ?? "" : ""}
              disabled={projects.length === 0}
              onChange={(event) => {
                const project = projects.find((item) => item.id === event.target.value);
                if (project) navigateWorkspace("project", project);
              }}
            >
              <option value="">{projects.length ? "프로젝트 선택" : "프로젝트 없음"}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title} · {pipelineStatusLabels[project.status] ?? project.status}</option>)}
            </select>
          </label>
          {canWriteProject && <button type="button" onClick={() => setShowNewProject(true)} aria-label="새 프로젝트 만들기"><Plus size={18} /><span>새 프로젝트</span></button>}
        </div>
        <nav aria-label="프로젝트 목록">
          {projects.length === 0 ? (
            <button className="empty-project" type="button" disabled={!canWriteProject} onClick={() => setShowNewProject(true)}>
              <FolderOpen size={24} /><span>첫 프로젝트를 만드세요</span>
            </button>
          ) : projects.map((project) => (
            <button
              type="button"
              key={project.id}
              aria-current={selectedProject?.id === project.id && activeView === "project" ? "page" : undefined}
              className={selectedProject?.id === project.id ? "active" : ""}
              onClick={() => {
                setSelectedProject(project);
                navigateWorkspace("project", project);
                setRun(null);
                setRunId(null);
                setEvents([]);
              }}
            >
              <span>{project.title}</span>
              <small>{pipelineStatusLabels[project.status] ?? project.status}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>작업 공간</span>
          <code>{session.workspaceId.slice(0, 8)}</code>
        </div>
      </aside>

      <section className="workspace-main">
        {error && <div className="error-banner" role="alert"><Warning size={19} /><span>{error}</span><button type="button" onClick={() => setError(null)}>닫기</button></div>}
        {activeView === "pipeline" ? (
          <PipelineBoard
            session={session}
            projects={projects}
            canWrite={canWriteProject}
            onCreate={() => setShowNewProject(true)}
            onSelect={(project) => navigateWorkspace("project", project)}
            onProjectUpdated={(project) => {
              setProjects((current) => current.map((item) => item.id === project.id ? project : item));
              setSelectedProject((current) => current?.id === project.id ? project : current);
            }}
          />
        ) : activeView === "clients" ? (
          <ClientsPanel
            session={session}
            clients={clients}
            projects={projects}
            permissions={activePermissions}
            onCreated={(client) => setClients((current) => [client, ...current])}
            onUpdated={(client) => setClients((current) => current.map((item) => item.id === client.id ? client : item))}
            onArchived={(clientId) => setClients((current) => current.filter((item) => item.id !== clientId))}
          />
        ) : activeView === "knowledge" ? (
          <KnowledgePanel session={session} permissions={activePermissions} />
        ) : activeView === "settings" ? (
          <SettingsPanel
            session={session}
            permissions={activePermissions}
            projectCount={projects.length}
            canCreateProject={canWriteProject}
            onCreateProject={() => setShowNewProject(true)}
            onOpenPipeline={() => navigateWorkspace("pipeline")}
          />
        ) : !selectedProject ? (
          <EmptyWorkspace canCreate={canWriteProject} onCreate={() => setShowNewProject(true)} />
        ) : (
          <ProjectWorkbench
            session={session}
            project={selectedProject}
            clients={clients}
            run={run}
            runId={runId}
            events={events}
            busy={busy}
            snapshot={snapshot}
            permissions={activePermissions}
            initialStep={projectStep}
            onStepChange={(step) => navigateWorkspace("project", selectedProject, step)}
            onProjectUpdated={(project) => {
              setProjects((current) => current.map((item) => item.id === project.id ? project : item));
              setSelectedProject(project);
              setRun(null);
              setRunId(null);
              setEvents([]);
              setStreamState("idle");
              setStreamRetryCount(0);
            }}
            onDelete={async () => {
              const deletedProjectId = selectedProject.id;
              await deleteProject(session, deletedProjectId);
              setProjects((current) => current.filter((project) => project.id !== deletedProjectId));
              selectedProjectIdRef.current = null;
              setSelectedProject(null);
              setRun(null);
              setRunId(null);
              setEvents([]);
              setStreamState("idle");
              setStreamRetryCount(0);
              navigateWorkspace("pipeline", null, "intake", true);
            }}
            onRun={beginRun}
            onResetRun={() => { setRun(null); setRunId(null); setEvents([]); setStreamState("idle"); setStreamRetryCount(0); }}
            onCancel={async () => {
              if (!runId) return;
              setBusy(true);
              setError(null);
              try { setRun(await cancelAgentRun(session, runId)); }
              catch (cause) { setError(cause instanceof Error ? cause.message : "실행을 중단하지 못했습니다."); }
              finally { setBusy(false); }
            }}
            onResume={async (answers) => {
              if (!run?.interruption || !runId) return;
              setBusy(true);
              try {
                await resumeAgentRun(session, runId, run.interruption.interruptionId, answers);
                setRun((current) => current ? { ...current, status: "RUNNING", interruption: null } : current);
                setExecutionRevision((current) => current + 1);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "답변을 전달하지 못했습니다.");
                throw cause;
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </section>

      {showNewProject && canWriteProject && (
        <ProjectDialog
          clients={clients}
          onClose={() => setShowNewProject(false)}
          onCreate={async (input) => {
            setError(null);
            const project = await createProject(session, input);
            setProjects((current) => [project, ...current]);
            setSelectedProject(project);
            navigateWorkspace("project", project);
            setShowNewProject(false);
          }}
        />
      )}
    </main>
  );
}

function AuthGate({
  onAuthenticated,
  error,
  setError,
}: {
  onAuthenticated: (session: AuthSession, isNewWorkspace?: boolean) => Promise<void>;
  error: string | null;
  setError: (message: string | null) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const selectMode = (nextMode: AuthMode) => {
    if (busy) return;
    setMode(nextMode);
    setShowPassword(false);
    setError(null);
  };

  const handleTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!(["ArrowLeft", "ArrowRight", "Home", "End"] as string[]).includes(event.key)) return;
    event.preventDefault();
    const nextMode: AuthMode = event.key === "ArrowLeft" || event.key === "Home" ? "login" : "register";
    selectMode(nextMode);
    document.getElementById(`auth-tab-${nextMode}`)?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    if (mode === "register" && password !== String(data.get("passwordConfirm"))) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      (event.currentTarget.elements.namedItem("passwordConfirm") as HTMLInputElement | null)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = mode === "login"
        ? await login(String(data.get("email")), password)
        : await register({
          email: String(data.get("email")),
          password,
          displayName: String(data.get("displayName")),
          workspaceName: String(data.get("workspaceName")),
        });
      await onAuthenticated(session, mode === "register");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "인증 요청을 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main-content" className="auth-page">
      <Link href="/" className="auth-back"><ArrowLeft size={18} /> 제품 소개로 돌아가기</Link>
      <section className="auth-message">
        <span>Freelance Ops</span>
        <h1>모호한 문의를<br />검토 가능한 작업으로.</h1>
        <p>로그인하면 문의 등록부터 AI 분석, 견적 작성과 결과 확인까지 한곳에서 이어갈 수 있습니다.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-tabs" role="tablist" aria-label="인증 방식">
          <button id="auth-tab-login" type="button" role="tab" aria-controls="auth-panel-login" aria-selected={mode === "login"} tabIndex={mode === "login" ? 0 : -1} disabled={busy} onKeyDown={handleTabKey} onClick={() => selectMode("login")}>로그인</button>
          <button id="auth-tab-register" type="button" role="tab" aria-controls="auth-panel-register" aria-selected={mode === "register"} tabIndex={mode === "register" ? 0 : -1} disabled={busy} onKeyDown={handleTabKey} onClick={() => selectMode("register")}>처음 시작하기</button>
        </div>
        <form id={`auth-panel-${mode}`} role="tabpanel" aria-labelledby={`auth-tab-${mode}`} aria-busy={busy} onSubmit={submit}>
          <fieldset className="auth-fields" disabled={busy}>
            {mode === "register" && <>
              <label>표시 이름<input name="displayName" required maxLength={100} autoComplete="name" /></label>
              <label>Workspace 이름<input name="workspaceName" required maxLength={120} /></label>
            </>}
            <label>이메일<input name="email" type="email" required autoComplete="email" /></label>
            <div className="auth-field">
              <label htmlFor="auth-password">비밀번호</label>
              <div className="password-field">
                <input id="auth-password" name="password" type={showPassword ? "text" : "password"} required minLength={12} maxLength={72} autoComplete={mode === "login" ? "current-password" : "new-password"} aria-describedby={mode === "register" ? "auth-password-hint" : undefined} />
                <button type="button" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}</button>
              </div>
              {mode === "register" && <small id="auth-password-hint">12~72자로 입력하세요.</small>}
            </div>
            {mode === "register" && <div className="auth-field"><label htmlFor="auth-password-confirm">비밀번호 확인</label><input id="auth-password-confirm" name="passwordConfirm" type={showPassword ? "text" : "password"} required minLength={12} maxLength={72} autoComplete="new-password" /></div>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" type="submit">
              {busy ? <CircleNotch size={19} className="spin" /> : <ArrowRight size={19} />}
              {mode === "login" ? "업무 공간 열기" : "Workspace 만들기"}
            </button>
          </fieldset>
        </form>
        <small>AI 결과는 사용자가 검토하기 전까지 확정되지 않습니다.</small>
      </section>
    </main>
  );
}

const pipelineColumns: Array<{ key: string; title: string; caption: string; statuses: ProjectStatus[]; moveTo: ProjectStatus }> = [
  { key: "inquiry", title: "신규 문의", caption: "아직 분류하지 않은 요청", statuses: ["LEAD"], moveTo: "LEAD" },
  { key: "qualifying", title: "정보 확인 중", caption: "범위와 조건 확인", statuses: ["QUALIFYING"], moveTo: "QUALIFYING" },
  { key: "quoting", title: "견적 작성 중", caption: "WBS와 금액 검토", statuses: ["QUOTING"], moveTo: "QUOTING" },
  { key: "negotiating", title: "협상 중", caption: "발행·수정·승인", statuses: ["NEGOTIATING", "ACCEPTED"], moveTo: "NEGOTIATING" },
  { key: "progress", title: "진행 중", caption: "계약된 프로젝트", statuses: ["IN_PROGRESS"], moveTo: "IN_PROGRESS" },
  { key: "review", title: "결과 회고", caption: "실제 공수 기록 필요", statuses: ["COMPLETED"], moveTo: "COMPLETED" },
];

const pipelineStatusLabels: Record<string, string> = {
  LEAD: "신규 문의",
  QUALIFYING: "정보 확인 중",
  QUOTING: "견적 작성 중",
  NEGOTIATING: "협상 중",
  ACCEPTED: "고객 승인됨",
  IN_PROGRESS: "진행 중",
  COMPLETED: "결과 회고",
  CANCELLED: "취소됨",
};

const runStatusLabels: Record<string, string> = {
  QUEUED: "준비 중",
  RUNNING: "분석 중",
  WAITING_FOR_USER: "확인 필요",
  COMPLETED: "분석 완료",
  FAILED: "실행 중단",
  CANCELLED: "사용자 중단",
};

const eventActivityLabels: Record<string, string> = {
  "run.accepted": "분석 요청 접수",
  "run.started": "분석 시작",
  "requirement.updated": "요구사항 정리",
  "clarification.requested": "사용자 확인 요청",
  "clarification.responded": "사용자 답변 반영",
  "tool.started": "자료 확인 시작",
  "tool.completed": "자료 확인 완료",
  "evidence.added": "근거 자료 연결",
  "quotation.draft.created": "견적 초안 준비",
  "approval.requested": "최종 확인 요청",
  "run.completed": "분석 완료",
  "run.failed": "분석 중단",
  "run.cancelled": "사용자 중단",
  "route.selected": "실행 경로 선택",
};

const routeActivityLabels: Record<string, string> = {
  DIRECT_TOOL: "결정적 Tool 실행",
  SIMPLE_LLM: "단일 모델 분석",
  REACT_AGENT: "ReAct Tool 분석",
  SUPERVISOR: "다중 부서 Supervisor",
  HUMAN_REQUIRED: "사용자 판단 우선",
};

const routeReasonLabels: Record<string, string> = {
  DETERMINISTIC_OPERATION: "정해진 작업으로 처리할 수 있는 요청",
  SINGLE_RESPONSE: "한 번의 모델 응답으로 정리 가능한 요청",
  TOOL_WORKFLOW: "자료 조회와 Tool 실행이 필요한 요청",
  MULTI_DOMAIN: "여러 전문 영역을 함께 검토해야 하는 요청",
  APPROVAL_OR_SENSITIVE: "권한 또는 사용자 승인이 필요한 요청",
  INSUFFICIENT_CONTEXT: "판단에 필요한 정보가 부족한 요청",
  PROMPT_MANIPULATION: "안전 검토가 필요한 입력",
  SAFETY_GATE: "안전 정책에 따라 사용자 확인이 필요한 요청",
  POLICY_GATE: "권한과 안전 정책을 먼저 적용",
  LOCAL_RRF: "로컬 진단 경로가 일치",
  LLM_EVALUATOR: "운영 route evaluator가 선택",
  FAIL_CLOSED: "판단 실패 시 안전한 경로를 선택",
};

const routeDecisionSourceLabels: Record<string, string> = {
  LLM_EVALUATOR: "AI 경로 평가",
  POLICY_GATE: "정책 우선 판단",
  LOCAL_RRF: "로컬 경로 판단",
  FAIL_CLOSED: "안전 경로 전환",
};

const toolActivityLabels: Record<string, string> = {
  get_project_context: "프로젝트 맥락 조회",
  web_research: "외부 근거 조사",
};

function eventDataText(event: WorkflowEvent, key: string): string | null {
  const value = event.data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function eventDataTexts(event: WorkflowEvent, key: string): string[] {
  const value = event.data[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function activityPresentation(event: WorkflowEvent, run: AgentRunView | null) {
  if (event.type === "route.selected") {
    const route = eventDataText(event, "route");
    const provider = eventDataText(event, "provider");
    const model = eventDataText(event, "model");
    const decisionSource = eventDataText(event, "decisionSource");
    const reasons = eventDataTexts(event, "reasonCodes").map((reason) => routeReasonLabels[reason] ?? reason);
    return {
      title: `경로 선택 · ${routeActivityLabels[route ?? ""] ?? route ?? "확인 중"}`,
      detail: reasons.join(" · ") || "요청의 범위와 필요한 작업을 기준으로 실행 경로를 선택했습니다.",
      tags: [route, providerLabels[provider ?? ""] ?? provider, model, routeDecisionSourceLabels[decisionSource ?? ""] ?? decisionSource].filter((value): value is string => Boolean(value)),
      tone: "route",
    };
  }
  if (event.type === "tool.completed") {
    const toolName = eventDataText(event, "toolName");
    const department = eventDataText(event, "department");
    return {
      title: `Tool 사용 · ${toolActivityLabels[toolName ?? ""] ?? toolName ?? "업무 도구"}`,
      detail: eventDataText(event, "reason") ?? "선택된 경로에 필요한 정보를 확인했습니다.",
      tags: [toolName, department ? departmentLabels[department] ?? department : null].filter((value): value is string => Boolean(value)),
      tone: "tool",
    };
  }
  if (event.type === "run.started" && run?.metadata) {
    return {
      title: eventActivityLabels[event.type],
      detail: `${providerLabels[run.metadata.provider] ?? run.metadata.provider}의 ${run.metadata.model} 모델로 분석을 시작했습니다.`,
      tags: [run.metadata.promptVersion],
      tone: "model",
    };
  }
  return {
    title: eventActivityLabels[event.type] ?? "분석 진행",
    detail: null,
    tags: [],
    tone: "default",
  };
}

const departmentLabels: Record<string, string> = {
  requirements: "요구사항 정리",
  research: "근거 조사",
  risk: "위험 검토",
  deal_design: "범위와 견적 구성",
};

const providerLabels: Record<string, string> = {
  OPENAI: "OpenAI",
  GEMINI: "Gemini",
};

const costStatusLabels: Record<string, string> = {
  PRICED: "비용 계산 완료",
  UNPRICED: "요금 기준 확인 필요",
  PENDING: "비용 계산 중",
};

const requestTierLabels: Record<string, string> = {
  STANDARD: "일반 실행",
  PREMIUM: "확장 실행",
};

const accountStatusLabels: Record<string, string> = {
  ACTIVE: "사용 중",
  PENDING: "확인 대기",
  SUSPENDED: "사용 중지",
};

const quotationScenarioLabels: Record<QuotationScenario, string> = {
  LEAN: "핵심안",
  RECOMMENDED: "권장안",
  EXPANDED: "확장안",
};

const quotationStatusLabels: Record<string, string> = {
  DRAFT: "작성 중",
  PUBLISHED: "발행 완료",
  SUPERSEDED: "이전 버전",
};

function PipelineBoard({
  session,
  projects,
  canWrite,
  onCreate,
  onSelect,
  onProjectUpdated,
}: {
  session: AuthSession;
  projects: Project[];
  canWrite: boolean;
  onCreate: () => void;
  onSelect: (project: Project) => void;
  onProjectUpdated: (project: Project) => void;
}) {
  const [movingId, setMovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeProjects = projects.filter((project) => project.status !== "CANCELLED");

  const move = async (project: Project, status: ProjectStatus) => {
    if (project.status === status) return;
    setMovingId(project.id);
    setError(null);
    try {
      onProjectUpdated(await updateProject(session, project, status));
    } catch (cause) {
      setError(cause instanceof Error ? `상태 변경이 저장되지 않았습니다. 서버 상태를 다시 확인해 주세요. ${cause.message}` : "상태 변경이 저장되지 않았습니다.");
    } finally {
      setMovingId(null);
    }
  };

  return (
    <section className="pipeline-page">
      <div className="pipeline-heading">
        <div><span>프로젝트 현황</span><h1>지금 확인할 일을 모았습니다.</h1><p>새 문의부터 진행 중인 작업, 마무리할 회고까지 한곳에서 확인하세요.</p></div>
        {canWrite && <button type="button" className="primary-button" onClick={onCreate}><Plus size={18} /> 새 문의 등록</button>}
      </div>
      <div className="pipeline-summary"><div><span>활성 프로젝트</span><strong>{activeProjects.length}</strong></div><div><span>견적 진행</span><strong>{projects.filter((project) => ["QUOTING", "NEGOTIATING"].includes(project.status)).length}</strong></div><div><span>회고 필요</span><strong>{projects.filter((project) => project.status === "COMPLETED").length}</strong></div></div>
      {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
      {activeProjects.length === 0 ? <div className="pipeline-empty"><FolderOpen size={34} /><h2>아직 등록된 문의가 없습니다.</h2><p>{canWrite ? "첫 고객 문의를 등록하면 이곳에서 단계별 진행 상태를 관리할 수 있습니다." : "현재 작업 공간의 프로젝트를 조회할 수 있습니다."}</p>{canWrite && <button type="button" className="primary-button" onClick={onCreate}>첫 문의 등록</button>}</div> : (
        <div className="pipeline-board">
          {pipelineColumns.map((column) => {
            const columnProjects = activeProjects.filter((project) => column.statuses.includes(project.status as ProjectStatus));
            return <section className="pipeline-column" key={column.key} aria-labelledby={`pipeline-${column.key}`}>
              <header><div><h2 id={`pipeline-${column.key}`}>{column.title}</h2><p>{column.caption}</p></div><span>{columnProjects.length}</span></header>
              <div className="pipeline-cards">
                {columnProjects.length === 0 ? <p className="column-empty">이 단계의 프로젝트가 없습니다.</p> : columnProjects.map((project) => <article key={project.id} className={movingId === project.id ? "saving" : ""}>
                  <button type="button" className="pipeline-card-open" onClick={() => onSelect(project)}><span>{project.currency}</span><h3>{project.title}</h3><p>{project.requirementText}</p><small>{project.deadline ? `${project.deadline}까지` : "일정 미정"}</small></button>
                  {canWrite && <label>단계 이동<select value={project.status} aria-label={`${project.title} 상태`} disabled={movingId === project.id} onChange={(event) => void move(project, event.target.value as ProjectStatus)}>{project.status === "ACCEPTED" && <option value="ACCEPTED">{pipelineStatusLabels.ACCEPTED}</option>}{pipelineColumns.map((target) => <option key={target.key} value={target.moveTo}>{target.title}</option>)}</select></label>}
                </article>)}
              </div>
            </section>;
          })}
        </div>
      )}
    </section>
  );
}

function ClientsPanel({
  session,
  clients,
  projects,
  permissions,
  onCreated,
  onUpdated,
  onArchived,
}: {
  session: AuthSession;
  clients: Client[];
  projects: Project[];
  permissions: Set<string>;
  onCreated: (client: Client) => void;
  onUpdated: (client: Client) => void;
  onArchived: (clientId: string) => void;
}) {
  const canWrite = permissions.has("client.write");
  const canDelete = permissions.has("client.delete");
  const [selected, setSelected] = useState<Client | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filtered = clients.filter((client) => !normalizedQuery || [client.name, client.companyName, client.email, client.phone]
    .filter(Boolean)
    .some((value) => value!.toLocaleLowerCase("ko-KR").includes(normalizedQuery)));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const nullable = (name: string) => String(data.get(name) ?? "").trim() || null;
    const input: ClientInput = {
      name: String(data.get("name") ?? "").trim(),
      companyName: nullable("companyName"),
      email: nullable("email"),
      phone: nullable("phone"),
      notes: nullable("notes"),
    };
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      if (selected) {
        const updated = await updateClient(session, selected.id, input);
        onUpdated(updated);
        setSelected(updated);
        setSaved("고객 정보가 저장되었습니다.");
      } else {
        const created = await createClient(session, input);
        onCreated(created);
        setSelected(created);
        setSaved("새 고객이 등록되었습니다. 이제 프로젝트에 연결할 수 있습니다.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "고객 정보를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const archive = async (client: Client) => {
    setBusy(true);
    setError(null);
    try {
      await archiveClient(session, client.id);
      onArchived(client.id);
      setSelected(null);
      setArchiveTarget(null);
      setSaved("고객을 보관했습니다. 기존 프로젝트 연결은 유지됩니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "고객을 보관하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="clients-page">
      <div className="clients-heading">
        <div><span>CLIENT RELATIONSHIPS</span><h1>문의의 맥락을 고객과 연결합니다.</h1><p>연락처와 메모를 한곳에 두고 새 프로젝트를 기존 고객에게 바로 연결하세요.</p></div>
        {canWrite && <button type="button" className="primary-button" onClick={() => { setSelected(null); setSaved(null); setArchiveTarget(null); }}><Plus size={18} /> 새 고객</button>}
      </div>
      {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
      {saved && <div className="settings-saved" role="status"><CheckCircle size={18} />{saved}</div>}
      <div className="clients-layout">
        <section className="client-directory" aria-label="고객 목록">
          <label className="client-search"><MagnifyingGlass size={18} /><span className="sr-only">고객 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 회사, 이메일 검색" /></label>
          <div className="client-list">
            {filtered.length === 0 ? <div className="client-empty"><AddressBook size={30} /><strong>{clients.length === 0 ? "첫 고객을 등록하세요." : "검색 결과가 없습니다."}</strong><span>고객을 등록하면 프로젝트 생성 시 바로 선택할 수 있습니다.</span></div> : filtered.map((client) => {
              const linkedCount = projects.filter((project) => project.clientId === client.id).length;
              return <button type="button" key={client.id} className={selected?.id === client.id ? "active" : ""} onClick={() => { setSelected(client); setSaved(null); setArchiveTarget(null); }}>
                <span><strong>{client.name}</strong><small>{client.companyName || "개인 고객"}</small></span>
                <em>{linkedCount}개 프로젝트</em>
              </button>;
            })}
          </div>
        </section>
        <section className="client-editor" aria-labelledby="client-editor-title">
          <header><div><span>{selected ? "고객 정보" : "새 고객"}</span><h2 id="client-editor-title">{selected ? selected.name : "관계를 먼저 기록하세요."}</h2></div>{selected && <PencilSimple size={24} />}</header>
          <form key={selected?.id ?? "new"} aria-busy={busy} onSubmit={submit}>
            <fieldset className="client-fields" disabled={busy}>
            <div className="form-row"><label>담당자 이름<input name="name" required maxLength={120} readOnly={!canWrite} defaultValue={selected?.name ?? ""} /></label><label>회사명<input name="companyName" maxLength={160} readOnly={!canWrite} defaultValue={selected?.companyName ?? ""} /></label></div>
            <div className="form-row"><label>이메일<input name="email" type="email" maxLength={320} readOnly={!canWrite} defaultValue={selected?.email ?? ""} /></label><label>전화번호<input name="phone" type="tel" maxLength={40} readOnly={!canWrite} defaultValue={selected?.phone ?? ""} /></label></div>
            <label>관계 메모<textarea name="notes" rows={7} maxLength={5000} readOnly={!canWrite} defaultValue={selected?.notes ?? ""} placeholder="선호하는 소통 방식, 의사결정자, 예산 맥락 등을 기록하세요." /></label>
            <div className="client-form-actions">
              {canWrite && <button className="primary-button" type="submit" disabled={busy}>{busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />}{selected ? "변경 저장" : "고객 등록"}</button>}
              {selected && canDelete && (archiveTarget === selected.id ? <div className="archive-confirm"><span>이 고객을 보관할까요?</span><button type="button" disabled={busy} onClick={() => void archive(selected)}>보관</button><button type="button" onClick={() => setArchiveTarget(null)}>취소</button></div> : <button className="quiet-button danger" type="button" onClick={() => setArchiveTarget(selected.id)}><Archive size={18} /> 고객 보관</button>)}
            </div>
            </fieldset>
          </form>
        </section>
      </div>
    </section>
  );
}

async function prepareDocumentUpload(file: File, sourceType: KnowledgeDocument["sourceType"]): Promise<Parameters<typeof createDocument>[1]> {
  const allowedExtensions = new Set(["txt", "md", "markdown", "csv", "json"]);
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
  if (!allowedExtensions.has(extension)) throw new Error("TXT, Markdown, CSV, JSON 문서만 업로드할 수 있습니다.");
  if (file.size > 5 * 1024 * 1024) throw new Error("문서는 5MB 이하의 텍스트 파일만 업로드할 수 있습니다.");
  const content = (await file.text()).trim();
  if (!content) throw new Error("비어 있는 문서는 업로드할 수 없습니다.");
  const chunks = Array.from({ length: Math.ceil(content.length / 18_000) }, (_, index) => {
    const startOffset = index * 18_000;
    const chunkContent = content.slice(startOffset, startOffset + 18_000);
    return { content: chunkContent, embedding: null, embeddingModel: null, startOffset, endOffset: startOffset + chunkContent.length };
  });
  return {
    sourceType,
    title: file.name.slice(0, 300),
    sourceUri: null,
    sourceVersion: `upload-${Date.now()}`,
    jurisdiction: "KR",
    effectiveFrom: null,
    effectiveUntil: null,
    chunks,
  };
}

const sourceTypeLabel: Record<KnowledgeDocument["sourceType"], string> = {
  PAST_PROJECT: "과거 프로젝트",
  POLICY: "내부 정책",
  PLATFORM_TERMS: "플랫폼 약관",
  USER_TEMPLATE: "사용자 자료",
  EXTERNAL_SOURCE: "외부 자료",
};

function KnowledgePanel({ session, permissions }: { session: AuthSession; permissions: Set<string> }) {
  const canWrite = permissions.has("document.write");
  const canDelete = permissions.has("document.delete");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KnowledgeDocument | null>(null);
  const [query, setQuery] = useState("");
  const [sourceType, setSourceType] = useState<"ALL" | KnowledgeDocument["sourceType"]>("ALL");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDocuments(session)
      .then((result) => { if (!cancelled) { setDocuments(result); setSelectedId(result[0]?.id ?? null); } })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "근거 자료를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!selectedId) { Promise.resolve().then(() => setDetail(null)); return; }
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) setDetail(null); });
    getDocument(session, selectedId)
      .then((document) => { if (!cancelled) setDetail(document); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "문서 내용을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [selectedId, session]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filtered = documents.filter((document) => {
    if (sourceType !== "ALL" && document.sourceType !== sourceType) return false;
    return !normalizedQuery || [document.title, document.jurisdiction, document.sourceVersion]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase("ko-KR").includes(normalizedQuery));
  });

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const document = await createDocument(session, await prepareDocumentUpload(file, "USER_TEMPLATE"));
      setDocuments((current) => [document, ...current]);
      setSelectedId(document.id);
      setDetail(document);
      setNotice("자료를 저장했습니다. 다음 AI 분석부터 참고 자료로 활용됩니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자료를 업로드하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const archive = async (documentId: string) => {
    setBusy(true);
    setError(null);
    try {
      await archiveDocument(session, documentId);
      const remaining = documents.filter((document) => document.id !== documentId);
      setDocuments(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDetail(null);
      setArchiveTarget(null);
      setNotice("자료를 보관했습니다. 다음 AI 분석부터 참고 대상에서 제외됩니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자료를 보관하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="knowledge-page">
      <div className="knowledge-heading">
        <div><span>근거 자료</span><h1>분석에 사용할 자료를 모아두세요.</h1><p>과거 프로젝트와 정책, 약관을 등록하고 이번 분석에 활용할 자료를 직접 선택할 수 있습니다.</p></div>
        {canWrite && <label className="primary-button">{uploading ? <CircleNotch className="spin" /> : <Plus size={18} />} 자료 업로드<input type="file" accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label>}
      </div>
      {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
      {notice && <div className="settings-saved" role="status"><CheckCircle size={18} />{notice}</div>}
      <div className="knowledge-toolbar">
        <label><MagnifyingGlass size={18} /><span className="sr-only">근거 자료 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목, 관할권, 버전 검색" /></label>
        <select aria-label="자료 유형 필터" value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)}><option value="ALL">모든 자료 유형</option>{Object.entries(sourceTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <span>{filtered.length} / {documents.length}개 자료</span>
      </div>
      <div className="knowledge-layout">
        <section className="knowledge-list" aria-label="근거 자료 목록">
          {loading ? <div className="section-loading"><CircleNotch className="spin" /> 자료를 확인하고 있습니다.</div> : filtered.length === 0 ? <div className="client-empty"><FileText size={30} /><strong>{documents.length === 0 ? "저장된 자료가 없습니다." : "조건에 맞는 자료가 없습니다."}</strong><span>텍스트 자료를 추가하면 AI 분석에서 필요한 내용을 찾아 활용할 수 있습니다.</span></div> : filtered.map((document) => <button type="button" key={document.id} className={selectedId === document.id ? "active" : ""} onClick={() => { setSelectedId(document.id); setArchiveTarget(null); setNotice(null); }}><span className="document-type">{sourceTypeLabel[document.sourceType]}</span><strong>{document.title}</strong><small>{document.jurisdiction ?? "관할권 미지정"} · {new Date(document.createdAt).toLocaleDateString("ko-KR")}</small></button>)}
        </section>
        <article className="knowledge-detail">
          {!selectedId ? <div className="knowledge-empty"><FileText size={34} /><h2>검토할 자료를 선택하세요.</h2><p>문서의 provenance와 실제 저장 청크를 확인할 수 있습니다.</p></div> : !detail ? <div className="section-loading"><CircleNotch className="spin" /> 문서 내용을 불러오고 있습니다.</div> : <>
            <header><div><span>{sourceTypeLabel[detail.sourceType]}</span><h2>{detail.title}</h2></div><code>{detail.contentSha256.slice(0, 12)}</code></header>
            <dl><div><dt>상태</dt><dd>{detail.status}</dd></div><div><dt>관할권</dt><dd>{detail.jurisdiction ?? "미지정"}</dd></div><div><dt>버전</dt><dd>{detail.sourceVersion ?? "미지정"}</dd></div><div><dt>유효 기간</dt><dd>{detail.effectiveFrom || detail.effectiveUntil ? `${detail.effectiveFrom ?? "시작 미정"} – ${detail.effectiveUntil ?? "종료 미정"}` : "미지정"}</dd></div></dl>
            {detail.sourceUri && <p className="document-origin"><span>출처 위치</span><code>{detail.sourceUri}</code></p>}
            <section className="document-chunks"><div><h3>저장된 내용</h3><span>{detail.chunks.length}개 청크</span></div>{detail.chunks.length === 0 ? <p>표시할 청크가 없습니다.</p> : detail.chunks.slice(0, 4).map((chunk) => <article key={chunk.id}><span>청크 {chunk.chunkIndex + 1}</span><p>{chunk.content.length > 900 ? `${chunk.content.slice(0, 900)}…` : chunk.content}</p></article>)}</section>
            {canDelete && <footer>{archiveTarget === detail.id ? <div className="archive-confirm"><span>이 자료를 검색 범위에서 제외할까요?</span><button type="button" disabled={busy} onClick={() => void archive(detail.id)}>보관</button><button type="button" onClick={() => setArchiveTarget(null)}>취소</button></div> : <button type="button" className="quiet-button danger" onClick={() => setArchiveTarget(detail.id)}><Archive size={18} /> 자료 보관</button>}</footer>}
          </>}
        </article>
      </div>
    </section>
  );
}

function SettingsPanel({
  session,
  permissions,
  projectCount,
  canCreateProject,
  onCreateProject,
  onOpenPipeline,
}: {
  session: AuthSession;
  permissions: Set<string>;
  projectCount: number;
  canCreateProject: boolean;
  onCreateProject: () => void;
  onOpenPipeline: () => void;
}) {
  const canReadQuotation = permissions.has("quotation.read");
  const canWriteQuotation = permissions.has("quotation.write");
  const canReadPricing = permissions.has("audit.read");
  const canManagePricing = permissions.has("workspace.update");
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [policy, setPolicy] = useState<EstimationPolicy | null>(null);
  const [modelPricing, setModelPricing] = useState<ModelPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const onboardingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getMe(session), canReadQuotation ? listRateCards(session) : Promise.resolve([]), canReadQuotation ? getEstimationPolicy(session) : Promise.resolve(null), canReadPricing ? listModelPricing(session) : Promise.resolve([])])
      .then(([profileResult, cardsResult, policyResult, pricingResult]) => {
        if (cancelled) return;
        if (profileResult.status === "fulfilled") setProfile(profileResult.value);
        if (cardsResult.status === "fulfilled") setRateCards(cardsResult.value);
        if (policyResult.status === "fulfilled") setPolicy(policyResult.value);
        if (pricingResult.status === "fulfilled") setModelPricing(pricingResult.value);
        const failed = [profileResult, cardsResult, policyResult, pricingResult].find((result) => result.status === "rejected");
        if (failed?.status === "rejected") setError(failed.reason instanceof Error ? failed.reason.message : "일부 설정을 불러오지 못했습니다.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canReadPricing, canReadQuotation, session]);

  const workspace = profile?.workspaces.find((item) => item.workspaceId === session.workspaceId);
  const hasActiveRateCard = rateCards.some((card) => card.active);
  const setupStates = [Boolean(workspace), hasActiveRateCard, Boolean(policy), projectCount > 0];
  const completedSetupCount = setupStates.filter(Boolean).length;
  const onboardingComplete = completedSetupCount === setupStates.length;
  const setupProgress = Math.round((completedSetupCount / setupStates.length) * 100);

  useGSAP(() => {
    if (loading || !onboardingRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(".onboarding-step", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: .55, stagger: .08, ease: "power3.out" });
    gsap.fromTo(".onboarding-progress-value", { scaleX: 0 }, { scaleX: 1, duration: .8, ease: "power3.out", transformOrigin: "left center" });
  }, { scope: onboardingRef, dependencies: [loading, setupProgress], revertOnUpdate: true });

  if (loading) return <div className="section-loading"><CircleNotch className="spin" /> 작업 공간 설정을 확인하고 있습니다.</div>;

  return (
    <section className="settings-page">
      <div className="settings-heading"><span>작업 공간 설정</span><h1>{onboardingComplete ? "견적 기준을 관리하세요." : hasActiveRateCard && policy ? "첫 고객 문의를 등록하세요." : "먼저 견적 기준을 정해볼까요?"}</h1><p>자주 쓰는 단가와 계산 기준을 저장해 두면 새 견적을 만들 때 바로 불러올 수 있습니다.</p></div>
      {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
      {saved && <div className="settings-saved" role="status"><CheckCircle size={18} />{saved}</div>}
      <div className={`workspace-onboarding${onboardingComplete ? " complete" : ""}`} ref={onboardingRef}>
        <header>
          <div><span>빠른 시작</span><h2 id="workspace-onboarding-title">첫 견적을 만들 준비</h2><p>{onboardingComplete ? "준비가 끝났습니다. 이제 고객 문의를 등록하고 견적을 시작해 보세요." : "필요한 항목을 순서대로 안내해 드립니다. 저장한 내용은 진행 상황에 바로 반영됩니다."}</p></div>
          <strong aria-label={`온보딩 ${completedSetupCount}/${setupStates.length} 완료`}>{completedSetupCount}<small> / {setupStates.length}</small></strong>
        </header>
        <div className="onboarding-progress" role="progressbar" aria-labelledby="workspace-onboarding-title" aria-valuemin={0} aria-valuemax={100} aria-valuenow={setupProgress}><span className="onboarding-progress-value" style={{ width: `${setupProgress}%` }} /></div>
        <div className="onboarding-steps">
          <article className={`onboarding-step${setupStates[0] ? " done" : " current"}`} aria-current={!setupStates[0] ? "step" : undefined}><span>{setupStates[0] ? <CheckCircle weight="fill" /> : "01"}</span><div><strong>작업 공간 확인</strong><p>{setupStates[0] ? workspace?.name : "작업 공간 정보를 확인하고 있습니다."}</p></div></article>
          <article className={`onboarding-step${setupStates[1] ? " done" : !setupStates[0] ? "" : " current"}`} aria-current={!setupStates[1] && setupStates[0] ? "step" : undefined}><span>{setupStates[1] ? <CheckCircle weight="fill" /> : "02"}</span><div><strong>서비스 단가 등록</strong><p>{setupStates[1] ? `${rateCards.filter((card) => card.active).length}개 단가 사용 중` : "견적 계산에 사용할 시간·일·고정 단가를 등록하세요."}</p>{!setupStates[1] && canWriteQuotation && <a href="#rate-cards">단가 등록하기 <ArrowRight /></a>}</div></article>
          <article className={`onboarding-step${setupStates[2] ? " done" : setupStates[1] ? " current" : ""}`} aria-current={!setupStates[2] && setupStates[1] ? "step" : undefined}><span>{setupStates[2] ? <CheckCircle weight="fill" /> : "03"}</span><div><strong>계산 기준 확인</strong><p>{setupStates[2] ? `세율 ${Math.round(policy!.defaultTaxRate * 100)}% · 위험 대비율 ${Math.round(policy!.defaultRiskBufferRate * 100)}%` : "세금과 위험 대비 기준을 확인하세요."}</p>{!setupStates[2] && canWriteQuotation && <a href="#estimation-policy">계산 기준 확인하기 <ArrowRight /></a>}</div></article>
          <article className={`onboarding-step${setupStates[3] ? " done" : setupStates[2] ? " current" : ""}`} aria-current={!setupStates[3] && setupStates[2] ? "step" : undefined}><span>{setupStates[3] ? <CheckCircle weight="fill" /> : "04"}</span><div><strong>첫 문의 등록</strong><p>{setupStates[3] ? `${projectCount}개 프로젝트 연결됨` : "고객 원문을 등록해 실제 업무 흐름을 시작하세요."}</p>{!setupStates[3] && canCreateProject && <button type="button" onClick={onCreateProject}>문의 등록하기 <ArrowRight /></button>}</div></article>
        </div>
        {onboardingComplete && <button type="button" className="secondary-button onboarding-finish" onClick={onOpenPipeline}>프로젝트 현황 보기 <ArrowRight size={17} /></button>}
      </div>
      <div className="settings-grid">
        <aside className="settings-index" aria-label="작업 공간 설정 목차">
          <a href="#workspace-profile"><span>01</span><strong>작업 공간</strong><small>계정과 작업 공간</small></a>
          <a href="#rate-cards"><span>02</span><strong>서비스 단가</strong><small>시간·일·고정 금액</small></a>
          <a href="#estimation-policy"><span>03</span><strong>계산 기준</strong><small>세금·위험·할인 기준</small></a>
          {canReadPricing && <a href="#model-pricing"><span>04</span><strong>AI 사용 비용</strong><small>모델별 요금 기준</small></a>}
        </aside>
        <div className="settings-content">
          <section id="workspace-profile"><header><span>01</span><div><h2>작업 공간</h2><p>현재 로그인한 계정과 작업 공간을 확인합니다.</p></div></header><dl><div><dt>작업 공간</dt><dd>{workspace?.name ?? session.workspaceId}</dd></div><div><dt>사용자</dt><dd>{profile?.displayName ?? profile?.email ?? "-"}</dd></div><div><dt>상태</dt><dd>{profile ? accountStatusLabels[profile.status] ?? "상태 확인 필요" : "-"}</dd></div></dl></section>
          <section id="rate-cards"><header><span>02</span><div><h2>서비스 단가</h2><p>견적 계산에 사용할 시간·일·고정 금액 기준을 등록합니다.</p></div></header>
            <RateCardManager session={session} rateCards={rateCards} canWrite={canWriteQuotation} onChange={setRateCards} />
          </section>
          <section id="estimation-policy"><header><span>03</span><div><h2>견적 계산 기준</h2><p>견적에 기본으로 반영할 세금, 위험 대비율과 할인 한도를 정합니다.</p></div></header>{policy ? canWriteQuotation ? <EstimationPolicyForm session={session} policy={policy} busy={busy} setBusy={setBusy} setError={setError} setSaved={setSaved} onSaved={setPolicy} /> : <dl><div><dt>기본 세율</dt><dd>{Math.round(policy.defaultTaxRate * 100)}%</dd></div><div><dt>위험 대비율</dt><dd>{Math.round(policy.defaultRiskBufferRate * 100)}%</dd></div><div><dt>최대 할인율</dt><dd>{Math.round(policy.maximumDiscountRate * 100)}%</dd></div></dl> : <p>계산 기준을 확인할 수 없는 계정입니다.</p>}</section>
          {canReadPricing && <section id="model-pricing"><header><span>04</span><div><h2>AI 사용 비용</h2><p>AI 분석에 사용되는 모델별 요금을 등록하고 기간별로 관리합니다.</p></div></header>
            <div className="model-pricing-list">{modelPricing.length === 0 ? <p>등록된 AI 요금이 없습니다.</p> : modelPricing.map((pricing) => <article key={pricing.id}><div><span>{pricing.provider}</span><strong>{pricing.model}</strong><small>{pricing.versionLabel}</small></div><dl><div><dt>입력 / 1M</dt><dd>{formatRate(pricing.inputPerMillion, pricing.currency)}</dd></div><div><dt>캐시 / 1M</dt><dd>{formatRate(pricing.cachedInputPerMillion, pricing.currency)}</dd></div><div><dt>출력 / 1M</dt><dd>{formatRate(pricing.outputPerMillion, pricing.currency)}</dd></div></dl><p>{new Date(pricing.validFrom).toLocaleString("ko-KR")}부터{pricing.validUntil ? ` · ${new Date(pricing.validUntil).toLocaleString("ko-KR")}까지` : " · 종료일 없음"}</p></article>)}</div>
            {canManagePricing ? <ModelPricingForm session={session} busy={busy} setBusy={setBusy} setError={setError} setSaved={setSaved} onCreated={(pricing) => setModelPricing((current) => [pricing, ...current])} /> : <p className="permission-note">AI 요금은 관리자만 등록할 수 있습니다.</p>}
          </section>}
        </div>
      </div>
    </section>
  );
}

function EstimationPolicyForm({ session, policy, busy, setBusy, setError, setSaved, onSaved }: { session: AuthSession; policy: EstimationPolicy; busy: boolean; setBusy: (busy: boolean) => void; setError: (message: string | null) => void; setSaved: (message: string | null) => void; onSaved: (policy: EstimationPolicy) => void }) {
  return <form className="settings-form" key={policy.version} aria-busy={busy} onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    const data = new FormData(event.currentTarget);
    try {
      const nextPolicy = await saveEstimationPolicy(session, {
        defaultTaxRate: Number(data.get("taxRate")) / 100,
        defaultRiskBufferRate: Number(data.get("bufferRate")) / 100,
        maximumDiscountRate: Number(data.get("discountRate")) / 100,
      });
      onSaved(nextPolicy);
      setSaved("견적 정책이 저장되었습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "정책을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }}><fieldset className="settings-fields" disabled={busy}><div className="form-row"><label>기본 세율 (%)<input name="taxRate" type="number" min="0" max="100" step="0.1" defaultValue={policy.defaultTaxRate * 100} /></label><label>위험 대비율 (%)<input name="bufferRate" type="number" min="0" max="100" step="0.1" defaultValue={policy.defaultRiskBufferRate * 100} /></label><label>최대 할인율 (%)<input name="discountRate" type="number" min="0" max="100" step="0.1" defaultValue={policy.maximumDiscountRate * 100} /></label></div><button type="submit" className="primary-button" disabled={busy}>{busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 계산 기준 저장</button></fieldset></form>;
}

function ModelPricingForm({ session, busy, setBusy, setError, setSaved, onCreated }: { session: AuthSession; busy: boolean; setBusy: (busy: boolean) => void; setError: (message: string | null) => void; setSaved: (message: string | null) => void; onCreated: (pricing: ModelPricing) => void }) {
  return <form className="settings-form model-pricing-form" aria-busy={busy} onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const validFrom = new Date(String(data.get("validFrom")));
    const validUntilRaw = String(data.get("validUntil"));
    const validUntil = validUntilRaw ? new Date(validUntilRaw) : null;
    setError(null);
    setSaved(null);
    if (validUntil && validUntil <= validFrom) { setError("가격 유효 종료 시점은 시작 시점보다 늦어야 합니다."); return; }
    setBusy(true);
    try {
      const pricing = await createModelPricing(session, {
        provider: String(data.get("provider")) as Provider,
        model: String(data.get("model")).trim(),
        versionLabel: String(data.get("versionLabel")).trim(),
        currency: String(data.get("currency")),
        inputPerMillion: Number(data.get("inputPerMillion")),
        cachedInputPerMillion: Number(data.get("cachedInputPerMillion")),
        outputPerMillion: Number(data.get("outputPerMillion")),
        validFrom: validFrom.toISOString(),
        validUntil: validUntil?.toISOString() ?? null,
      });
      onCreated(pricing);
      setSaved("AI 모델 요금을 등록했습니다.");
      form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "모델 가격을 등록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }}><fieldset className="settings-fields" disabled={busy}><div className="form-row"><label>AI 제공사<select name="provider" defaultValue="OPENAI"><option value="OPENAI">OpenAI</option><option value="GEMINI">Gemini</option></select></label><label>모델<input name="model" list="suggested-models" required maxLength={100} placeholder="목록에서 선택하거나 모델명 입력" /><datalist id="suggested-models">{suggestedModelOptions.map((model) => <option key={model} value={model} />)}</datalist></label><label>요금 기준 이름<input name="versionLabel" required maxLength={100} placeholder="예: 2026년 8월 공식 요금" /></label><label>통화<select name="currency" defaultValue="USD">{currencyOptions.map((currency) => <option key={currency.value} value={currency.value}>{currency.label}</option>)}</select></label></div><div className="form-row"><label>입력 100만 토큰<input name="inputPerMillion" type="number" min="0" step="0.000001" required /></label><label>캐시 입력 100만 토큰<input name="cachedInputPerMillion" type="number" min="0" step="0.000001" required /></label><label>출력 100만 토큰<input name="outputPerMillion" type="number" min="0" step="0.000001" required /></label></div><div className="form-row"><label>적용 시작<input name="validFrom" type="datetime-local" required /></label><label>적용 종료<input name="validUntil" type="datetime-local" /></label></div><button type="submit" className="secondary-button" disabled={busy}>{busy ? <CircleNotch className="spin" /> : <Plus size={18} />} AI 요금 등록</button></fieldset></form>;
}

function RateCardManager({ session, rateCards, canWrite, onChange }: { session: AuthSession; rateCards: RateCard[]; canWrite: boolean; onChange: (cards: RateCard[]) => void }) {
  const [editorId, setEditorId] = useState<string>("new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const selected = rateCards.find((card) => card.id === editorId) ?? null;

  const replaceCard = (card: RateCard) => {
    const exists = rateCards.some((item) => item.id === card.id);
    const next = exists ? rateCards.map((item) => item.id === card.id ? card : item) : [...rateCards, card];
    onChange(next.sort((left, right) => left.name.localeCompare(right.name, "ko")));
  };

  const toggleActive = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const card = await saveRateCard(session, selected.id, {
        name: selected.name,
        unit: selected.unit,
        rate: selected.rate,
        minimumAmount: selected.minimumAmount,
        currency: selected.currency,
        active: !selected.active,
      });
      replaceCard(card);
      setConfirmDeactivate(false);
      setNotice(card.active ? "이 단가를 새 견적에서 다시 사용할 수 있습니다." : "이 단가를 새 견적의 선택 항목에서 제외했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "단가 상태를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rate-card-manager">
      <div className="rate-card-toolbar">
        <p>{rateCards.length === 0 ? "등록된 단가가 없습니다. 첫 단가를 추가하세요." : `${rateCards.filter((card) => card.active).length}개 사용 중 · ${rateCards.length}개 전체`}</p>
        {canWrite && <button type="button" className="secondary-button" onClick={() => { setEditorId("new"); setError(null); setNotice(null); setConfirmDeactivate(false); }}><Plus size={17} /> 새 단가</button>}
      </div>
      {rateCards.length > 0 && <div className="rate-card-list" aria-label="등록된 서비스 단가">{rateCards.map((card) => <button type="button" key={card.id} aria-pressed={editorId === card.id} className={`${editorId === card.id ? "active" : ""}${card.active ? "" : " inactive"}`} onClick={() => { setEditorId(card.id); setError(null); setNotice(null); setConfirmDeactivate(false); }}>
        <div><strong>{card.name}</strong><small>{card.active ? "사용 중" : "비활성 · 기존 견적에는 유지"}</small></div>
        <span>{formatMoney(card.rate, card.currency)} / {card.unit === "HOUR" ? "시간" : card.unit === "DAY" ? "일" : "건"}<small>최소 {formatMoney(card.minimumAmount, card.currency)}</small></span>
      </button>)}</div>}

      {canWrite ? <form className="settings-form rate-card-form" key={selected ? `${selected.id}-${selected.version}` : "new"} aria-busy={busy} onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        const name = String(data.get("name")).trim();
        const rate = Number(data.get("rate"));
        const minimumAmount = Number(data.get("minimumAmount"));
        setError(null);
        setNotice(null);
        if (!name) { setError("서비스 이름을 입력해 주세요."); return; }
        if (!Number.isFinite(rate) || rate < 0 || !Number.isFinite(minimumAmount) || minimumAmount < 0) { setError("기본 단가와 최소 금액은 0 이상의 숫자여야 합니다."); return; }
        setBusy(true);
        try {
          const card = await saveRateCard(session, selected?.id ?? crypto.randomUUID(), {
            name,
            unit: String(data.get("unit")) as RateCard["unit"],
            rate,
            minimumAmount,
            currency: String(data.get("currency")),
            active: selected?.active ?? true,
          });
          replaceCard(card);
          setEditorId(card.id);
          setNotice(selected ? "단가 변경을 저장했습니다." : "새 단가를 등록했습니다.");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "단가를 저장하지 못했습니다.");
        } finally {
          setBusy(false);
        }
      }}>
        <div className="rate-card-form-heading"><div><strong>{selected ? "단가 편집" : "새 단가 등록"}</strong><span>{selected ? `수정 이력 ${selected.version}` : "견적에 사용할 서비스와 금액을 입력하세요."}</span></div>{selected && <span className={selected.active ? "active" : "inactive"}>{selected.active ? "사용 중" : "비활성"}</span>}</div>
        {error && <div className="inline-error" role="alert"><Warning size={17} />{error}</div>}
        {notice && <div className="settings-saved" role="status"><CheckCircle size={17} />{notice}</div>}
        <fieldset disabled={busy}>
          <div className="form-row"><label>서비스 이름<input name="name" required maxLength={120} placeholder="예: 개발 작업" defaultValue={selected?.name ?? ""} /></label><label>단위<select name="unit" defaultValue={selected?.unit ?? "HOUR"}><option value="HOUR">시간</option><option value="DAY">일</option><option value="FIXED">고정</option></select></label><label>통화<select name="currency" defaultValue={selected?.currency ?? "KRW"}><option value="KRW">KRW</option><option value="USD">USD</option><option value="JPY">JPY</option></select></label></div>
          <div className="form-row"><label>기본 단가<input name="rate" type="number" min="0" required step="0.01" defaultValue={selected?.rate ?? ""} /></label><label>최소 금액<input name="minimumAmount" type="number" min="0" required step="0.01" defaultValue={selected?.minimumAmount ?? 0} /></label></div>
          <div className="rate-card-form-actions"><button type="submit" className="primary-button">{busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} {selected ? "변경 저장" : "단가 등록"}</button>{selected && (selected.active ? confirmDeactivate ? <div className="archive-confirm"><span>새 견적에서 이 단가를 숨길까요?</span><button type="button" onClick={() => void toggleActive()}>비활성화</button><button type="button" onClick={() => setConfirmDeactivate(false)}>취소</button></div> : <button type="button" className="quiet-button danger" onClick={() => setConfirmDeactivate(true)}><Archive size={17} /> 비활성화</button> : <button type="button" className="quiet-button" onClick={() => void toggleActive()}><ArrowRight size={17} /> 다시 사용</button>)}</div>
        </fieldset>
      </form> : <p className="permission-note">단가를 변경할 권한이 없습니다. 등록된 단가와 활성 상태만 확인할 수 있습니다.</p>}
    </div>
  );
}

function EmptyWorkspace({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="workspace-empty">
      <FolderOpen size={42} weight="duotone" />
      <h1>{canCreate ? "첫 고객 문의를 등록하세요." : "표시할 프로젝트가 없습니다."}</h1>
      <p>{canCreate ? "프로젝트를 만들면 요구사항 정리와 AI 분석을 바로 시작할 수 있습니다." : "현재 계정에서는 새 프로젝트를 만들 수 없습니다."}</p>
      {canCreate && <button type="button" className="primary-button" onClick={onCreate}><Plus size={18} /> 새 프로젝트</button>}
    </div>
  );
}

function ProjectWorkbench({
  session,
  project,
  clients,
  run,
  runId,
  events,
  busy,
  snapshot,
  permissions,
  initialStep,
  onStepChange,
  onProjectUpdated,
  onDelete,
  onRun,
  onResetRun,
  onCancel,
  onResume,
}: {
  session: AuthSession;
  project: Project;
  clients: Client[];
  run: AgentRunView | null;
  runId: string | null;
  events: WorkflowEvent[];
  busy: boolean;
  snapshot: ReturnType<typeof snapshotFromEvents>;
  permissions: Set<string>;
  initialStep: WorkbenchStep;
  onStepChange: (step: WorkbenchStep) => void;
  onProjectUpdated: (project: Project) => void;
  onDelete: () => Promise<void>;
  onRun: (provider: Provider, model: string) => Promise<void>;
  onResetRun: () => void;
  onCancel: () => Promise<void>;
  onResume: (answers: string[]) => Promise<void>;
}) {
  const [provider, setProvider] = useState<Provider>("OPENAI");
  const [model, setModel] = useState(configuredModelOptions.OPENAI[0] ?? "");
  const [activeStep, setActiveStep] = useState<WorkbenchStep>(initialStep);
  const [editingProject, setEditingProject] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [costUsage, setCostUsage] = useState<AgentRunUsage | null>(null);
  const [reviewFocused, setReviewFocused] = useState(run?.status === "WAITING_FOR_USER");
  const canRun = permissions.has("agent.run");
  const canRespond = permissions.has("agent.respond");
  const canCancel = permissions.has("agent.cancel");

  useEffect(() => {
    Promise.resolve().then(() => {
      setActiveStep(initialStep);
      setShowDeleteConfirmation(false);
      setDeleteConfirmation("");
      setDeleteError(null);
    });
  }, [initialStep, project.id]);

  useEffect(() => {
    Promise.resolve().then(() => setReviewFocused(run?.status === "WAITING_FOR_USER"));
  }, [project.id, run?.status]);

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

  useEffect(() => {
    if (!showDeleteConfirmation) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeDeleteConfirmation();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeDeleteConfirmation, showDeleteConfirmation]);

  useEffect(() => {
    if (!runId || !run || !terminalStatuses.has(run.status) || !permissions.has("audit.read")) {
      Promise.resolve().then(() => setCostUsage(null));
      return;
    }
    let cancelled = false;
    getAgentRunUsage(session, runId)
      .then((usage) => { if (!cancelled) setCostUsage(usage); })
      .catch(() => { if (!cancelled) setCostUsage(null); });
    return () => { cancelled = true; };
  }, [permissions, run, runId, session]);

  return (
    <>
      <div className="project-heading">
        <div>
          <span className="project-status"><i /> {pipelineStatusLabels[project.status] ?? project.status}</span>
          <h1>{project.title}</h1>
          <p>{project.requirementText}</p>
        </div>
        {activeStep !== "agent" && (permissions.has("project.write") || permissions.has("project.delete")) && <div className="project-heading-actions">
          {permissions.has("project.write") && <button type="button" className="secondary-button" onClick={() => setEditingProject(true)}><PencilSimple size={18} /> 프로젝트 정보 수정</button>}
          {permissions.has("project.delete") && <button type="button" className="quiet-button danger" disabled={Boolean(run && !terminalStatuses.has(run.status))} title={run && !terminalStatuses.has(run.status) ? "AI 분석을 중단한 뒤 삭제할 수 있습니다." : undefined} onClick={() => setShowDeleteConfirmation(true)}><Trash size={18} /> 프로젝트 삭제</button>}
        </div>}
        {!runId && activeStep === "agent" && canRun ? (
          <div className="run-controls">
            <label>AI 제공사<select value={provider} onChange={(event) => { const nextProvider = event.target.value as Provider; setProvider(nextProvider); setModel(configuredModelOptions[nextProvider][0] ?? ""); }}><option value="OPENAI">OpenAI</option><option value="GEMINI" disabled={configuredModelOptions.GEMINI.length === 0}>Gemini{configuredModelOptions.GEMINI.length === 0 ? " · 설정 필요" : ""}</option></select></label>
            <label>AI 모델<select value={model} disabled={configuredModelOptions[provider].length === 0} onChange={(event) => setModel(event.target.value)}>{configuredModelOptions[provider].length === 0 ? <option value="">등록된 모델 없음</option> : configuredModelOptions[provider].map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            <button type="button" className="primary-button" disabled={busy || !model.trim()} onClick={() => onRun(provider, model.trim())}>
              {busy ? <CircleNotch className="spin" /> : <Waveform size={19} />} 분석 시작
            </button>
          </div>
        ) : activeStep === "agent" && run && terminalStatuses.has(run.status) && canRun ? <button type="button" className="secondary-button" onClick={onResetRun}><ArrowRight size={18} /> 새 분석 준비</button> : null}
      </div>

      {showDeleteConfirmation && <div className="project-delete-backdrop">
        <section className="project-delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="project-delete-title" aria-describedby="project-delete-description">
          <header>
            <span className="project-delete-icon" aria-hidden="true"><Trash size={22} /></span>
            <div><span>프로젝트 삭제</span><h2 id="project-delete-title">정말 삭제하시겠어요?</h2></div>
            <button type="button" className="project-delete-close" aria-label="삭제 창 닫기" disabled={deletingProject} onClick={closeDeleteConfirmation}>×</button>
          </header>
          <div className="project-delete-copy" id="project-delete-description">
            <p>삭제하면 다음 자료를 다시 복구할 수 없습니다.</p>
            <ul><li>정리된 요구사항</li><li>AI 분석 기록</li><li>견적과 결과 기록</li></ul>
          </div>
          <label><span>확인을 위해 프로젝트명을 입력해 주세요.</span><strong>{project.title}</strong><input autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder="프로젝트명 입력" /></label>
          {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
          <div className="project-delete-actions">
            <button type="button" className="quiet-button" disabled={deletingProject} onClick={closeDeleteConfirmation}>취소</button>
          <button type="button" className="danger-button" disabled={deletingProject || deleteConfirmation !== project.title} onClick={async () => {
            setDeletingProject(true);
            setDeleteError(null);
            try { await onDelete(); }
            catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "프로젝트를 삭제하지 못했습니다."); setDeletingProject(false); }
          }}>{deletingProject ? <CircleNotch size={17} className="spin" /> : <Trash size={17} />} 영구 삭제</button>
          </div>
        </section>
      </div>}

      <nav className="workbench-steps" aria-label="프로젝트 진행 단계">
        {([
          ["intake", "01", "문의"],
          ["agent", "02", "AI 분석"],
          ["quote", "03", "견적"],
          ["outcome", "04", "결과"],
        ] as const).map(([id, number, label]) => (
          <button type="button" key={id} aria-current={activeStep === id ? "step" : undefined} className={activeStep === id ? "active" : ""} onClick={() => selectStep(id)}>
            <span>{number}</span>{label}
          </button>
        ))}
      </nav>

      {activeStep === "intake" && <IntakeReview session={session} project={project} permissions={permissions} onContinue={() => selectStep("agent")} />}

      {activeStep === "agent" && <div className={`workbench-grid${reviewFocused ? " review-focused" : ""}`}>
        <div id="run-execution-graph" className="graph-panel" hidden={reviewFocused}>
          <LiveWorkflow snapshot={snapshot} />
          {runId && canCancel && (!run || ["QUEUED", "RUNNING", "WAITING_FOR_USER"].includes(run.status)) && <div className="run-action-bar"><span>필요하면 현재 실행을 안전하게 중단할 수 있습니다.</span><button type="button" className="quiet-button danger" disabled={busy} onClick={() => void onCancel()}>{busy ? <CircleNotch className="spin" /> : <Warning size={17} />} 실행 중단</button></div>}
          <div className="event-timeline">
            <div className="panel-title"><span>최근 활동</span><small>{events.length ? `${events.length}개 기록` : "기록 없음"}</small></div>
            {events.length === 0 ? (
              <p className="empty-copy">분석을 시작하면 진행 상황이 이곳에 표시됩니다.</p>
            ) : (
              <ol>{events.slice(-8).reverse().map((event) => {
                const activity = activityPresentation(event, run);
                return <li key={event.eventId} className={`event-activity event-activity-${activity.tone}`}>
                  <span className="event-activity-marker" aria-hidden="true" />
                  <div className="event-activity-copy">
                    <strong>{activity.title}</strong>
                    {activity.detail && <p>{activity.detail}</p>}
                    {activity.tags.length > 0 && <div className="event-activity-tags">{activity.tags.map((tag, index) => <code key={`${tag}-${index}`}>{tag}</code>)}</div>}
                  </div>
                  <time>{event.occurredAt ? new Date(event.occurredAt).toLocaleTimeString("ko-KR") : "방금"}</time>
                </li>;
              })}</ol>
            )}
          </div>
        </div>

        <aside className="run-inspector">
          <div className="panel-title inspector-title"><span>분석 결과</span><div>{run && <small className="run-status-chip">{runStatusLabels[run.status] ?? run.status}</small>}<button type="button" className="panel-focus-toggle" aria-controls="run-execution-graph" aria-expanded={!reviewFocused} onClick={() => setReviewFocused((current) => !current)}>{reviewFocused ? <><Graph size={16} /> 진행 상황 보기</> : <>결과 크게 보기 <ArrowRight size={15} /></>}</button></div></div>
          {!run ? (
            <div className="inspector-empty"><Clock size={26} /><p>실행 결과와 확인 질문이 여기에 나타납니다.</p></div>
          ) : run.status === "WAITING_FOR_USER" && run.interruption ? (
            <InterruptionForm
              key={run.interruption.interruptionId}
              interruption={run.interruption}
              draftKey={interruptionDraftKey(session.userId, session.workspaceId, runId ?? run.runId, run.interruption.interruptionId)}
              draftWorkspaceId={session.workspaceId}
              draftRunId={runId ?? run.runId}
              busy={busy}
              canRespond={canRespond}
              onSubmit={onResume}
            />
          ) : ["FAILED", "CANCELLED"].includes(run.status) ? (
            <div className="run-failed"><Warning size={30} /><h3>{run.status === "CANCELLED" ? "사용자가 실행을 중단했습니다." : "실행이 중단되었습니다."}</h3><p>{run.status === "CANCELLED" ? "저장된 프로젝트와 이전 결과는 변경되지 않습니다." : run.errorCode ?? "공개 오류 코드가 없습니다."}</p></div>
          ) : run.result ? (
            <div className="run-result">
              <span className="result-state"><CheckCircle size={17} /> 분석 결과</span>
              <h3>프로젝트 요약</h3>
              <p>{run.result.projectSummary}</p>
              {run.metadata && <details className="run-provenance run-technical-details"><summary>실행 정보</summary><span>{providerLabels[run.metadata.provider] ?? run.metadata.provider} · {run.metadata.model}</span><small>프롬프트 {run.metadata.promptVersion} · 도구 규격 {run.metadata.toolSchemaVersion}</small></details>}
              {run.result.openQuestions.length > 0 && <section className="run-open-questions"><span>아직 확인할 질문</span><ul>{run.result.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul></section>}
              {run.result.quotationDraft && <section className="ai-quote-ready"><div><Receipt size={20} /><span>AI 견적 초안</span><strong>{run.result.quotationDraft.items.length}개 작업 항목을 준비했습니다.</strong><small>단가와 최종 금액은 등록된 기준으로 계산되며 저장 전 직접 확인할 수 있습니다.</small></div><button type="button" className="secondary-button" onClick={() => selectStep("quote")}>견적 검토하기 <ArrowRight size={16} /></button></section>}
              {run.result.departmentResults.length > 0 && <details className="department-results">
                <summary><span>분석 단계별 상세</span><small>{run.result.departmentResults.length}개 결과</small></summary>
                <div>{run.result.departmentResults.map((result) => <article key={result.department}>
                  <strong>{departmentLabels[result.department] ?? "분석 단계"}</strong>
                  <p>{result.summary}</p>
                  <small>근거 {result.evidenceIds.length} · 가정 {result.assumptionIds.length}</small>
                  {result.sources.length > 0 && <details className="run-sources"><summary>검토 가능한 출처 {result.sources.length}개</summary><ul>{result.sources.map((source, index) => {
                    const safeUrl = externalHttpUrl(source.url);
                    return <li key={`${source.url}-${index}`}><div><span>{source.title}</span><small>{source.provider}{source.jurisdiction ? ` · ${source.jurisdiction}` : ""}</small></div>{source.excerpt && <p>{source.excerpt}</p>}{safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">원문 열기 <ArrowRight size={13} /></a> : <code>{source.url}</code>}</li>;
                  })}</ul></details>}
                </article>)}</div>
              </details>}
              {run.usage && <dl className="usage-list"><div><dt>모델 사용</dt><dd>{run.usage.modelCalls}</dd></div><div><dt>도구 사용</dt><dd>{run.usage.toolCalls}</dd></div><div><dt>소요 시간</dt><dd>{Math.round(run.usage.durationMs / 1000)}초</dd></div></dl>}
              {costUsage && <div className="cost-usage"><div><span>AI 사용 비용</span><strong>{costUsage.actualCost != null && costUsage.costCurrency ? formatMoney(costUsage.actualCost, costUsage.costCurrency) : "계산 대기"}</strong></div><dl><div><dt>입력 토큰</dt><dd>{costUsage.inputTokens.toLocaleString()}</dd></div><div><dt>출력 토큰</dt><dd>{costUsage.outputTokens.toLocaleString()}</dd></div><div><dt>검색 사용량</dt><dd>{costUsage.searchCredits}</dd></div><div><dt>비용 반영</dt><dd>{costUsage.billableOutcome ? "예" : "아니오"}</dd></div></dl><small>{costStatusLabels[costUsage.costStatus] ?? "상태 확인 필요"} · {requestTierLabels[costUsage.requestTier] ?? "실행 등급 확인 필요"}</small></div>}
            </div>
          ) : (
            <div className="inspector-empty running"><CircleNotch size={29} className="spin" /><p>결과를 만들고 있습니다. 그래프에서 현재 단계를 확인하세요.</p></div>
          )}
        </aside>
      </div>}

      {activeStep === "quote" && <QuoteBuilder session={session} project={project} permissions={permissions} quotationDraft={run?.result?.quotationDraft ?? null} />}
      {activeStep === "outcome" && <OutcomeReview session={session} project={project} permissions={permissions} />}
      {editingProject && <ProjectEditDialog session={session} project={project} clients={clients} onClose={() => setEditingProject(false)} onUpdated={(updated) => { onProjectUpdated(updated); setEditingProject(false); }} />}
    </>
  );
}

function compactDiffExcerpt(value: string, limit = 520): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  const half = Math.floor((limit - 3) / 2);
  return `${normalized.slice(0, half)} … ${normalized.slice(-half)}`;
}

function requirementTextDelta(previous: string, current: string) {
  if (previous === current) return { changed: false, removed: "", added: "" };
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, current.length);
  while (prefix < maxPrefix && previous[prefix] === current[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(previous.length - prefix, current.length - prefix);
  while (suffix < maxSuffix && previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]) suffix += 1;

  const previousEnd = suffix ? previous.length - suffix : previous.length;
  const currentEnd = suffix ? current.length - suffix : current.length;
  return {
    changed: true,
    removed: compactDiffExcerpt(previous.slice(prefix, previousEnd)),
    added: compactDiffExcerpt(current.slice(prefix, currentEnd)),
  };
}

function IntakeReview({ session, project, permissions, onContinue }: { session: AuthSession; project: Project; permissions: Set<string>; onContinue: () => void }) {
  const canWriteProject = permissions.has("project.write");
  const canReadDocuments = permissions.has("document.read");
  const canWriteDocuments = permissions.has("document.write");
  const [versions, setVersions] = useState<RequirementVersion[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [features, setFeatures] = useState<RequirementFeature[]>([{ title: "", description: "", priority: "MUST", acceptanceCriteria: "" }]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diffRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listRequirements(session, project.id), canReadDocuments ? listDocuments(session) : Promise.resolve([])])
      .then(([result, nextDocuments]) => { if (!cancelled) { setVersions(result); setDocuments(nextDocuments); } })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "요구사항을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canReadDocuments, project.id, session]);

  const latest = versions[0] ?? null;
  const structuredOutdated = Boolean(latest && latest.sourceText.trim() !== project.requirementText.trim());
  const textDelta = useMemo(
    () => latest ? requirementTextDelta(latest.sourceText.trim(), project.requirementText.trim()) : null,
    [latest, project.requirementText],
  );

  useGSAP(() => {
    if (!latest || editing || !diffRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(".requirement-diff-summary > article", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: .48, stagger: .07, ease: "power3.out" });
    gsap.fromTo(".requirement-diff-map > article", { y: 24, scale: .985, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .58, stagger: .1, ease: "power3.out" });
  }, { scope: diffRef, dependencies: [editing, latest?.id, structuredOutdated], revertOnUpdate: true });

  return (
    <section className="intake-review requirement-review">
      <div className="guided-copy">
        <span>사용자 입력 · 원문</span>
        <h2>문의 내용을 먼저 확인합니다.</h2>
        <p>왼쪽 원문과 오른쪽 구조화 결과를 나란히 검토합니다. 저장된 버전은 사용자 확정 결과이며 AI 초안과 구분됩니다.</p>
        <div className="requirement-version-state"><span>{loading ? "불러오는 중" : structuredOutdated ? "문의 변경됨 · 다시 확인 필요" : latest ? `검토 완료 v${latest.versionNumber}` : "정리 전"}</span><small>{latest ? new Date(latest.createdAt).toLocaleString("ko-KR") : "첫 요구사항을 정리해 주세요."}</small></div>
      </div>
      <div className="intake-document">
        <div><FileText size={20} /><strong>고객 문의 원문</strong><small>{project.requirementText.length.toLocaleString()}자</small></div>
        <p>{project.requirementText}</p>
        <dl>
          <div><dt>통화</dt><dd>{project.currency}</dd></div>
          <div><dt>희망 완료일</dt><dd>{project.deadline ?? "미정"}</dd></div>
          <div><dt>예산 범위</dt><dd>{project.budgetMin == null && project.budgetMax == null ? "미정" : `${formatMoney(project.budgetMin ?? 0, project.currency)}–${formatMoney(project.budgetMax ?? 0, project.currency)}`}</dd></div>
        </dl>
        <div className="document-upload-area">
          <div><span>참고 문서</span><small>TXT · Markdown · CSV · JSON, 최대 5MB</small></div>
          {canWriteDocuments && <label className="secondary-button">{uploading ? <CircleNotch className="spin" /> : <Plus size={17} />} 문서 추가<input type="file" accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json" disabled={uploading} onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setUploading(true);
            setError(null);
            try {
              const document = await createDocument(session, await prepareDocumentUpload(file, "EXTERNAL_SOURCE"));
              setDocuments((current) => [document, ...current]);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "문서를 업로드하지 못했습니다.");
            } finally {
              setUploading(false);
            }
          }} /></label>}
          {documents.length > 0 && <ul>{documents.slice(0, 3).map((document) => <li key={document.id}><FileText size={15} /><span>{document.title}</span><small>{document.status}</small></li>)}</ul>}
          <p>업로드한 파일은 이 프로젝트의 참고 자료로 보관되며, AI 분석이 필요한 내용을 찾을 때 활용됩니다.</p>
        </div>
      </div>
      <div className="structured-requirements">
        <header><div><span>구조화된 요구사항</span><h3>{latest ? `검토 완료된 버전 ${latest.versionNumber}` : "아직 확정된 버전이 없습니다."}</h3></div>{canWriteProject && <button type="button" className="secondary-button" onClick={() => {
          if (editing) {
            setEditing(false);
            return;
          }
          setFeatures(latest?.features.map((feature) => ({ ...feature })) ?? [{ title: "", description: "", priority: "MUST", acceptanceCriteria: "" }]);
          setEditing(true);
        }}>{editing ? "편집 닫기" : latest ? "새 버전 만들기" : "직접 정리하기"}</button>}</header>
        {structuredOutdated && <div className="inline-error requirement-stale" role="status"><Warning size={18} />고객 문의가 마지막 검토 이후 변경되었습니다. 요구사항을 다시 확인한 뒤 견적을 작성해 주세요.</div>}
        {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
        {latest && !editing ? <>
          <section className={`requirement-diff${structuredOutdated ? " stale" : " synced"}`} ref={diffRef} aria-labelledby="requirement-diff-title">
            <header><div><span>원문과 구조화 결과 비교</span><h4 id="requirement-diff-title">확정된 정보와 다시 볼 차이</h4></div><strong>{structuredOutdated ? "재검토 필요" : "원문 동기화됨"}</strong></header>
            <div className="requirement-diff-summary" aria-label="구조화 결과 요약">
              <article><span>작업 범위</span><strong>{latest.features.length}</strong><small>기능으로 구조화</small></article>
              <article><span>확인된 가정</span><strong>{latest.assumptions.length}</strong><small>견적 전제에 반영</small></article>
              <article><span>열린 질문</span><strong>{latest.questions.length}</strong><small>추가 확인 필요</small></article>
            </div>
            <div className="requirement-diff-map">
              <article><header><span>현재 고객 원문</span><strong>{project.requirementText.length.toLocaleString()}자</strong></header><p>{compactDiffExcerpt(project.requirementText, 700)}</p><dl><div><dt>희망 완료일</dt><dd>{project.deadline ?? "미정"}</dd></div><div><dt>예산 범위</dt><dd>{project.budgetMin == null && project.budgetMax == null ? "미정" : `${formatMoney(project.budgetMin ?? 0, project.currency)}–${formatMoney(project.budgetMax ?? 0, project.currency)}`}</dd></div></dl></article>
              <article><header><span>사용자 확정 구조</span><strong>v{latest.versionNumber}</strong></header>{latest.features.length ? <ol>{latest.features.slice(0, 4).map((feature, index) => <li key={`${feature.title}-${index}`}><span>{feature.priority}</span><strong>{feature.title}</strong></li>)}</ol> : <p>확정된 기능이 없습니다.</p>}{latest.features.length > 4 && <small>그 외 {latest.features.length - 4}개 기능</small>}</article>
            </div>
            {structuredOutdated && textDelta?.changed ? <details className="requirement-source-delta" open><summary>마지막 확정 원문과 현재 원문의 변경 부분</summary><div><section><span>이전 원문에서 빠진 부분</span><del>{textDelta.removed || "삭제된 내용 없음"}</del></section><section><span>현재 원문에 추가된 부분</span><ins>{textDelta.added || "추가된 내용 없음"}</ins></section></div></details> : <p className="requirement-diff-synced"><CheckCircle size={17} weight="fill" /> 현재 원문이 이 구조화 revision의 기준 원문과 일치합니다.</p>}
            <p className="requirement-diff-note">이 비교는 저장된 원문과 사용자 확정 revision만 보여 줍니다. 자동 의미 추정은 검토 완료로 표시하지 않습니다.</p>
          </section>
          <div className="feature-list">{latest.features.length === 0 ? <p className="empty-copy">등록된 기능이 없습니다.</p> : latest.features.map((feature, index) => <article key={`${feature.title}-${index}`}><span>{feature.priority}</span><div><h4>{feature.title}</h4><p>{feature.description}</p>{feature.acceptanceCriteria && <small>완료 기준 · {feature.acceptanceCriteria}</small>}</div></article>)}</div>
          <div className="requirement-notes"><section><h4>확인된 가정</h4>{latest.assumptions.length ? <ul>{latest.assumptions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>기록된 가정이 없습니다.</p>}</section><section><h4>열린 질문</h4>{latest.questions.length ? <ul>{latest.questions.map((item) => <li key={item.content}>{item.content}<small>{item.status}</small></li>)}</ul> : <p>열린 질문이 없습니다.</p>}</section></div>
        </> : editing ? <form className="requirement-editor" onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          const data = new FormData(event.currentTarget);
          try {
            const version = await createRequirementVersion(session, project.id, {
              sourceText: project.requirementText,
              features,
              assumptions: String(data.get("assumptions")).split("\n").map((item) => item.trim()).filter(Boolean),
              questions: String(data.get("questions")).split("\n").map((item) => item.trim()).filter(Boolean),
            });
            setVersions((current) => [version, ...current]);
            setEditing(false);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "요구사항 버전을 저장하지 못했습니다.");
          } finally {
            setBusy(false);
          }
        }}>
          <div className="editor-label"><span>사용자 확정 입력</span><p>기능마다 설명과 우선순위를 확인하고 저장하세요.</p></div>
          {features.map((feature, index) => <fieldset key={index}><legend>기능 {index + 1}</legend><div className="form-row"><label>기능 이름<input required maxLength={200} value={feature.title} onChange={(event) => setFeatures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></label><label>우선순위<select value={feature.priority} onChange={(event) => setFeatures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, priority: event.target.value as RequirementFeature["priority"] } : item))}><option value="MUST">MUST</option><option value="SHOULD">SHOULD</option><option value="COULD">COULD</option><option value="WONT">WON&apos;T</option></select></label></div><label>설명<textarea required maxLength={5000} rows={3} value={feature.description} onChange={(event) => setFeatures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /></label><label>완료 기준<textarea maxLength={5000} rows={2} value={feature.acceptanceCriteria} onChange={(event) => setFeatures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, acceptanceCriteria: event.target.value } : item))} /></label><button type="button" className="remove-feature" disabled={features.length === 1} onClick={() => setFeatures((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash size={16} /> 이 기능 제거</button></fieldset>)}
          <button type="button" className="add-row" onClick={() => setFeatures((current) => [...current, { title: "", description: "", priority: "SHOULD", acceptanceCriteria: "" }])}><Plus size={17} /> 기능 추가</button>
          <div className="form-row"><label>확인된 가정<textarea name="assumptions" rows={5} placeholder="한 줄에 하나씩 입력" defaultValue={latest?.assumptions.join("\n") ?? ""} /></label><label>열린 질문<textarea name="questions" rows={5} placeholder="한 줄에 하나씩 입력" defaultValue={latest?.questions.map((item) => item.content).join("\n") ?? ""} /></label></div>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 사용자 확정 revision 저장</button>
        </form> : <div className="structured-empty"><p>원문에서 기능, 제약과 열린 질문을 분리하면 견적 항목과 근거를 더 정확하게 연결할 수 있습니다.</p></div>}
        <div className="intake-next"><button type="button" className="primary-button" onClick={onContinue}>AI 분석으로 이동 <ArrowRight size={18} /></button></div>
      </div>
    </section>
  );
}

const emptyQuoteItem = (): QuotationItemInput => ({
  rateCardId: null,
  title: "",
  description: "",
  quantity: 1,
  unit: "HOUR",
  unitRate: 0,
  discountRate: 0,
  basis: {
    type: "ASSUMPTION",
    content: "",
    sourceType: null,
    sourceReference: null,
    sourceTitle: null,
    retrievedAt: null,
  },
});

function quotationItemsAsInput(quotation: Quotation): QuotationItemInput[] {
  return quotation.items.map((item) => ({
    rateCardId: item.rateCardId,
    title: item.title,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitRate: item.unitRate,
    discountRate: item.discountRate,
    basis: { ...item.basis },
  }));
}

function quotationDraftItems(draft: AgentQuotationDraft, rateCards: RateCard[], currency: string): QuotationItemInput[] {
  return draft.items.map((item) => {
    const card = selectRateCardForDraftItem(item, rateCards, currency) as RateCard | null;
    const hasEvidence = item.basis.type === "EVIDENCE" && Boolean(item.basis.sourceReference?.trim());
    return {
      rateCardId: card?.id ?? null,
      title: item.title,
      description: item.description,
      quantity: item.quantity,
      unit: card?.unit ?? item.unit,
      unitRate: card?.rate ?? 0,
      discountRate: 0,
      basis: {
        type: hasEvidence ? "EVIDENCE" : "ASSUMPTION",
        content: item.basis.content,
        sourceType: hasEvidence ? "EXTERNAL_SOURCE" : null,
        sourceReference: hasEvidence ? item.basis.sourceReference : null,
        sourceTitle: hasEvidence ? item.basis.sourceTitle : null,
        retrievedAt: null
      }
    };
  });
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

type QuoteDraftStatus = {
  kind: "generated" | "restored" | "saved" | "unavailable";
  updatedAt: string | null;
};

function QuoteBuilder({ session, project, permissions, quotationDraft }: { session: AuthSession; project: Project; permissions: Set<string>; quotationDraft: AgentQuotationDraft | null }) {
  const canRead = permissions.has("quotation.read");
  const canWrite = permissions.has("quotation.write");
  const canPublish = permissions.has("quotation.publish");
  const [scenario, setScenario] = useState<QuotationScenario>("RECOMMENDED");
  const [items, setItems] = useState<QuotationItemInput[]>([emptyQuoteItem()]);
  const [taxRate, setTaxRate] = useState(0.1);
  const [validUntil, setValidUntil] = useState("");
  const [selectedBasisIndex, setSelectedBasisIndex] = useState(0);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [saved, setSaved] = useState<Quotation | null>(null);
  const [proposalShare, setProposalShare] = useState<(ProposalShare & { url: string }) | null>(null);
  const [shareCopyState, setShareCopyState] = useState<"copied" | "manual" | null>(null);
  const [conflictLatest, setConflictLatest] = useState<Quotation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<QuoteDraftStatus | null>(null);
  const [draftBaseline, setDraftBaseline] = useState<string | null>(null);
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const lastPersistedDraftRef = useRef("");
  const draftStorageKey = quotationDraftKey(session.userId, project.workspaceId, project.id);

  const fingerprint = useCallback((nextScenario: QuotationScenario, baseQuotationId: string | null, nextTaxRate: number, nextValidUntil: string, nextItems: QuotationItemInput[]) => quotationDraftFingerprint({
    scenario: nextScenario,
    baseQuotationId,
    taxRate: nextTaxRate,
    validUntil: nextValidUntil,
    items: nextItems,
  }), []);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    Promise.all([listQuotations(session, project.id), listRateCards(session)])
      .then(([result, nextRateCards]) => {
        if (!cancelled) {
          setDraftStatus(null);
          setQuotations(result);
          const activeRateCards = nextRateCards.filter((card) => card.active);
          setRateCards(activeRateCards);
          const latest = result[0] ?? null;
          const generatedItems = quotationDraft ? quotationDraftItems(quotationDraft, activeRateCards, project.currency) : null;
          const defaultScenario = quotationDraft?.scenario ?? latest?.scenario ?? "RECOMMENDED";
          const defaultItems = generatedItems ?? (latest ? quotationItemsAsInput(latest) : [emptyQuoteItem()]);
          const defaultTaxRate = latest?.taxRate ?? .1;
          const defaultValidUntil = latest?.validUntil ?? "";
          let restored = null;
          if (canWrite) {
            try {
              const rawDraft = window.sessionStorage.getItem(draftStorageKey);
              if (rawDraft) {
                restored = parseQuotationDraft(rawDraft, { workspaceId: project.workspaceId, projectId: project.id });
                if (!restored) window.sessionStorage.removeItem(draftStorageKey);
              }
            } catch {
              setDraftStatus({ kind: "unavailable", updatedAt: null });
            }
          }
          if (restored) {
            const restoredItems = generatedItems ? hydrateMissingDraftRates(restored.items, generatedItems) as QuotationItemInput[] : restored.items;
            const baseQuotation = restored.baseQuotationId
              ? result.find((quotation) => quotation.id === restored.baseQuotationId) ?? null
              : null;
            setSaved(baseQuotation);
            setScenario(restored.scenario);
            setItems(restoredItems);
            setTaxRate(restored.taxRate);
            setValidUntil(restored.validUntil);
            const restoredFingerprint = fingerprint(restored.scenario, restored.baseQuotationId, restored.taxRate, restored.validUntil, restoredItems);
            const baselineItems = baseQuotation ? quotationItemsAsInput(baseQuotation) : [emptyQuoteItem()];
            setDraftBaseline(fingerprint(
              baseQuotation?.scenario ?? "RECOMMENDED",
              baseQuotation?.id ?? null,
              baseQuotation?.taxRate ?? .1,
              baseQuotation?.validUntil ?? "",
              baselineItems,
            ));
            lastPersistedDraftRef.current = restoredFingerprint;
            setDraftStatus({ kind: "restored", updatedAt: restored.updatedAt });
          } else {
            setSaved(latest);
            setScenario(defaultScenario);
            setItems(defaultItems);
            setTaxRate(defaultTaxRate);
            setValidUntil(defaultValidUntil);
            const baseline = fingerprint(defaultScenario, latest?.id ?? null, defaultTaxRate, defaultValidUntil, defaultItems);
            setDraftBaseline(baseline);
            lastPersistedDraftRef.current = baseline;
            if (generatedItems) setDraftStatus({ kind: "generated", updatedAt: null });
          }
          setDraftProjectId(project.id);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "견적 목록을 불러오지 못했습니다.");
      });
    return () => { cancelled = true; };
  }, [canRead, canWrite, draftStorageKey, fingerprint, project.currency, project.id, project.workspaceId, quotationDraft, session]);

  const currentDraftFingerprint = fingerprint(scenario, saved?.id ?? null, taxRate, validUntil, items);
  const hasUnsavedDraft = draftProjectId === project.id && draftBaseline !== null && currentDraftFingerprint !== draftBaseline;

  useEffect(() => {
    if (!canWrite || !hasUnsavedDraft || currentDraftFingerprint === lastPersistedDraftRef.current) return;
    const timer = window.setTimeout(() => {
      const draft = createQuotationDraft({
        workspaceId: project.workspaceId,
        projectId: project.id,
        scenario,
        baseQuotationId: saved?.id ?? null,
        taxRate,
        validUntil,
        items,
      });
      try {
        window.sessionStorage.setItem(draftStorageKey, JSON.stringify(draft));
        lastPersistedDraftRef.current = currentDraftFingerprint;
        setDraftStatus({ kind: "saved", updatedAt: draft.updatedAt });
      } catch {
        setDraftStatus({ kind: "unavailable", updatedAt: null });
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [canWrite, currentDraftFingerprint, draftStorageKey, hasUnsavedDraft, items, project.id, project.workspaceId, saved?.id, scenario, taxRate, validUntil]);

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedDraft]);

  const estimatedSubtotal = items.reduce((sum, item) => sum + item.quantity * item.unitRate * (1 - item.discountRate), 0);
  const canSave = canWrite && items.length > 0 && items.every((item) => item.title.trim()
    && item.quantity > 0
    && item.unitRate > 0
    && item.basis.content.trim()
    && (item.basis.type === "ASSUMPTION" || Boolean(item.basis.sourceType && item.basis.sourceReference?.trim())));
  const selectedBasis = items[Math.min(selectedBasisIndex, items.length - 1)]?.basis ?? null;
  const latestByScenario = useMemo(() => Object.fromEntries(
    (["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => [value, quotations.find((quotation) => quotation.scenario === value) ?? null]),
  ) as Record<QuotationScenario, Quotation | null>, [quotations]);

  const updateItem = (index: number, update: (item: QuotationItemInput) => QuotationItemInput) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? update(item) : item));
  };

  const clearStoredDraft = () => {
    try {
      window.sessionStorage.removeItem(draftStorageKey);
    } catch {
      // The editor remains usable when browser storage is unavailable.
    }
    setDraftStatus(null);
  };

  const applyQuotation = (quotation: Quotation) => {
    const nextItems = quotationItemsAsInput(quotation);
    setSaved(quotation);
    setScenario(quotation.scenario);
    setItems(nextItems);
    setSelectedBasisIndex(0);
    setTaxRate(quotation.taxRate);
    setValidUntil(quotation.validUntil ?? "");
    setProposalShare(null);
    setShareCopyState(null);
    setConflictLatest(null);
    setError(null);
    const baseline = fingerprint(quotation.scenario, quotation.id, quotation.taxRate, quotation.validUntil ?? "", nextItems);
    setDraftBaseline(baseline);
    lastPersistedDraftRef.current = baseline;
    clearStoredDraft();
  };

  const loadQuotation = (quotation: Quotation) => {
    if (hasUnsavedDraft && !window.confirm("작성 중인 내용을 버리고 선택한 견적안을 불러올까요?")) return;
    applyQuotation(quotation);
  };

  const resetQuotation = (force = false) => {
    if (!force && hasUnsavedDraft && !window.confirm("작성 중인 내용을 버리고 새 견적안을 시작할까요?")) return;
    const nextItems = [emptyQuoteItem()];
    setSaved(null);
    setScenario("RECOMMENDED");
    setItems(nextItems);
    setSelectedBasisIndex(0);
    setTaxRate(.1);
    setValidUntil("");
    setProposalShare(null);
    setShareCopyState(null);
    setConflictLatest(null);
    setError(null);
    const baseline = fingerprint("RECOMMENDED", null, .1, "", nextItems);
    setDraftBaseline(baseline);
    lastPersistedDraftRef.current = baseline;
    clearStoredDraft();
  };

  const discardDraft = () => {
    if (!window.confirm("임시 저장한 내용을 버리고 마지막으로 저장한 견적으로 돌아갈까요?")) return;
    if (saved) applyQuotation(saved);
    else resetQuotation(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const input = {
        scenario,
        currency: project.currency,
        taxRate,
        applyDefaultRiskBuffer: true,
        validUntil: validUntil || null,
        items,
      };
      const quotation = saved
        ? await reviseQuotation(session, saved.id, input)
        : await createQuotation(session, project.id, input);
      const savedItems = quotationItemsAsInput(quotation);
      setSaved(quotation);
      setItems(savedItems);
      setQuotations((current) => [quotation, ...current]);
      setConflictLatest(null);
      const baseline = fingerprint(quotation.scenario, quotation.id, quotation.taxRate, quotation.validUntil ?? "", savedItems);
      setDraftBaseline(baseline);
      lastPersistedDraftRef.current = baseline;
      clearStoredDraft();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && saved) {
        try {
          const refreshed = await reloadQuotations(session, project.id);
          setQuotations(refreshed);
          setConflictLatest(refreshed.find((quotation) => quotation.seriesId === saved.seriesId) ?? refreshed[0] ?? null);
          setError(null);
        } catch {
          setError("다른 사용자가 새 견적안을 먼저 저장했습니다. 최신 목록을 불러오지 못했으니 잠시 후 다시 확인해 주세요.");
        }
      } else {
        setError(cause instanceof Error ? cause.message : "견적을 저장하지 못했습니다.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!canRead) return <div className="workspace-empty"><Receipt size={38} /><h2>이 견적을 볼 수 없습니다.</h2><p>견적 조회가 필요하다면 작업 공간 관리자에게 문의해 주세요.</p></div>;

  return (
    <section className="quote-builder">
      <div className="quote-toolbar">
        <div>
          <span>{quotationDraft ? "AI 초안 검토" : "견적 직접 작성"}</span>
          <h2>{quotationDraft ? "AI가 정리한 작업과 공수를 확인하세요." : "항목별 공수와 근거를 함께 기록하세요."}</h2>
        </div>
        <div className="scenario-switch" role="group" aria-label="견적 시나리오">
          {(["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => <button type="button" key={value} disabled={!canWrite} className={scenario === value ? "active" : ""} onClick={() => setScenario(value)}>{value === "LEAN" ? "핵심" : value === "RECOMMENDED" ? "권장" : "확장"}</button>)}
        </div>
        {canWrite && <button type="button" className="quiet-button" onClick={() => resetQuotation()}>새 견적안</button>}
      </div>

      {draftStatus && <div className={`quote-draft-state ${draftStatus.kind}`} role={draftStatus.kind === "unavailable" ? "alert" : "status"} aria-live="polite">
        <Clock size={19} />
        <div><strong>{draftStatus.kind === "generated" ? "AI가 견적 초안을 채웠습니다." : draftStatus.kind === "restored" ? "작성 중이던 견적을 불러왔습니다." : draftStatus.kind === "saved" ? "작성 중인 견적을 이 탭에 임시 저장했습니다." : "현재 브라우저에서는 임시 저장을 사용할 수 없습니다."}</strong><small>{draftStatus.kind === "generated" ? "작업과 공수에 맞는 등록 단가를 자동으로 연결했습니다. 저장 전에 단가와 가정을 확인해 주세요." : draftStatus.kind === "unavailable" ? "초안을 저장하기 전에는 화면을 닫거나 다른 곳으로 이동하지 마세요." : `${draftStatus.updatedAt ? new Date(draftStatus.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "방금"} 저장 · 다른 브라우저에서는 이어서 볼 수 없습니다.`}</small></div>
        {draftStatus.kind !== "unavailable" && <button type="button" className="quiet-button" onClick={discardDraft}>임시저장 버리기</button>}
      </div>}

      {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
      {conflictLatest && <section className="quote-conflict" role="alert"><div><Warning size={21} /><div><strong>다른 사용자가 새 견적안을 먼저 저장했습니다.</strong><p>작성 중인 내용은 그대로 남아 있습니다. 최신 v{conflictLatest.versionNumber}을 불러오거나 현재 내용을 새 견적안으로 저장할 수 있습니다.</p></div></div><div><button type="button" className="secondary-button" onClick={() => loadQuotation(conflictLatest)}>최신 견적안 불러오기</button><button type="button" className="quiet-button" onClick={() => { setSaved(null); setConflictLatest(null); }}>현재 내용으로 계속</button></div></section>}

      <section className="scenario-comparison" aria-label="견적 시나리오 비교">
        <header><div><span>견적안 비교</span><strong>핵심안·권장안·확장안을 한눈에 비교하세요.</strong></div><small>카드를 선택하면 해당 견적안을 이어서 편집할 수 있습니다.</small></header>
        <div>{(["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => {
          const quotation = latestByScenario[value];
          return <button type="button" key={value} className={saved?.id === quotation?.id ? "active" : ""} disabled={!quotation} onClick={() => quotation && loadQuotation(quotation)}><span>{value === "LEAN" ? "핵심" : value === "RECOMMENDED" ? "권장" : "확장"}</span>{quotation ? <><strong>{formatMoney(quotation.total, quotation.currency)}</strong><small>v{quotation.versionNumber} · {quotationStatusLabels[quotation.status] ?? "상태 확인 필요"}</small></> : <><strong>작성 전</strong><small>저장된 견적 없음</small></>}</button>;
        })}</div>
      </section>

      <div className="quote-layout">
        <div className="quote-sheet" role="table" aria-label="견적 항목">
          <div className="quote-row quote-head" role="row"><span>작업 항목</span><span>수량</span><span>단위</span><span>단가</span><span>할인</span><span>예상 금액</span><span /></div>
          {items.map((item, index) => (
            <div className={`quote-item-block${selectedBasisIndex === index ? " selected" : ""}`} key={index} onFocusCapture={() => setSelectedBasisIndex(index)}>
              <div className="quote-row" role="row">
                <label><span className="sr-only">작업 항목</span><input value={item.title} readOnly={!canWrite} maxLength={200} placeholder="예: 결제 플로우 구현" onChange={(event) => updateItem(index, (current) => ({ ...current, title: event.target.value }))} /></label>
                <label><span className="sr-only">수량</span><input type="number" min="0.1" step="0.5" readOnly={!canWrite} value={item.quantity} onChange={(event) => updateItem(index, (current) => ({ ...current, quantity: Number(event.target.value) }))} /></label>
                <label><span className="sr-only">단위</span><select value={item.unit} disabled={!canWrite || Boolean(item.rateCardId)} onChange={(event) => updateItem(index, (current) => ({ ...current, unit: event.target.value as QuotationItemInput["unit"] }))}><option value="HOUR">시간</option><option value="DAY">일</option><option value="FIXED">고정</option></select></label>
                <label><span className="sr-only">단가</span><input type="number" min="0" step="1000" readOnly={!canWrite || Boolean(item.rateCardId)} value={item.unitRate} onChange={(event) => updateItem(index, (current) => ({ ...current, unitRate: Number(event.target.value) }))} /></label>
                <label><span className="sr-only">할인율</span><input type="number" min="0" max="100" step="1" readOnly={!canWrite} value={Math.round(item.discountRate * 100)} onChange={(event) => updateItem(index, (current) => ({ ...current, discountRate: Number(event.target.value) / 100 }))} /></label>
                <strong>{formatMoney(item.quantity * item.unitRate * (1 - item.discountRate), project.currency)}</strong>
                <button type="button" className="remove-item" aria-label={`${index + 1}번 항목 삭제`} disabled={!canWrite || items.length === 1} onClick={() => { setItems((current) => current.filter((_, itemIndex) => itemIndex !== index)); setSelectedBasisIndex((current) => Math.max(0, Math.min(current, items.length - 2))); }}><Trash size={17} /></button>
              </div>
              <div className="basis-row">
                <label className="quote-select-control"><span>단가 기준</span><div><select aria-label="서비스 단가표" value={item.rateCardId ?? ""} disabled={!canWrite} onChange={(event) => { const card = rateCards.find((candidate) => candidate.id === event.target.value); updateItem(index, (current) => card ? { ...current, rateCardId: card.id, unit: card.unit, unitRate: card.rate } : { ...current, rateCardId: null }); }}><option value="">직접 입력</option>{rateCards.filter((card) => card.currency === project.currency).map((card) => <option key={card.id} value={card.id}>{card.name} · {formatMoney(card.rate, card.currency)}</option>)}</select><CaretDown size={16} aria-hidden="true" /></div><small>{item.rateCardId ? "등록된 단가가 적용되었습니다." : "적합한 단가를 선택하거나 직접 입력하세요."}</small></label>
                <label className="quote-select-control"><span>산정 근거</span><div><select aria-label="근거 유형" value={item.basis.type} disabled={!canWrite} onChange={(event) => updateItem(index, (current) => ({ ...current, basis: event.target.value === "ASSUMPTION" ? { type: "ASSUMPTION", content: current.basis.content, sourceType: null, sourceReference: null, sourceTitle: null, retrievedAt: null } : { ...current.basis, type: "EVIDENCE" } }))}><option value="ASSUMPTION">확인이 필요한 가정</option><option value="EVIDENCE">검증된 근거</option></select><CaretDown size={16} aria-hidden="true" /></div><small>{item.basis.type === "ASSUMPTION" ? "저장 전 확인이 필요한 조건입니다." : "출처 정보와 함께 저장됩니다."}</small></label>
                <label className="basis-copy"><span>{item.basis.type === "ASSUMPTION" ? "가정 내용" : "근거 내용"}</span><textarea rows={3} value={item.basis.content} readOnly={!canWrite} maxLength={3000} placeholder="이 공수와 단가를 정한 근거 또는 아직 확인되지 않은 가정을 입력하세요." onChange={(event) => updateItem(index, (current) => ({ ...current, basis: { ...current.basis, content: event.target.value } }))} /></label>
                {item.basis.type === "EVIDENCE" && <div className="evidence-fields"><label><span>출처 유형</span><select required aria-label="출처 유형" value={item.basis.sourceType ?? ""} disabled={!canWrite} onChange={(event) => updateItem(index, (current) => ({ ...current, basis: { ...current.basis, sourceType: event.target.value as NonNullable<QuotationItemInput["basis"]["sourceType"]> } }))}><option value="">선택</option><option value="PAST_PROJECT">과거 프로젝트</option><option value="POLICY">내부 정책</option><option value="PLATFORM_TERMS">플랫폼 약관</option><option value="USER_TEMPLATE">사용자 자료</option><option value="EXTERNAL_SOURCE">외부 자료</option></select></label><label><span>출처 참조</span><input required maxLength={1000} readOnly={!canWrite} value={item.basis.sourceReference ?? ""} placeholder="문서 ID 또는 원문 URL" onChange={(event) => updateItem(index, (current) => ({ ...current, basis: { ...current.basis, sourceReference: event.target.value } }))} /></label><label><span>출처 제목</span><input maxLength={300} readOnly={!canWrite} value={item.basis.sourceTitle ?? ""} onChange={(event) => updateItem(index, (current) => ({ ...current, basis: { ...current.basis, sourceTitle: event.target.value || null } }))} /></label><label><span>조회 시점</span><input type="datetime-local" readOnly={!canWrite} value={toDateTimeLocal(item.basis.retrievedAt)} onChange={(event) => updateItem(index, (current) => ({ ...current, basis: { ...current.basis, retrievedAt: event.target.value ? new Date(event.target.value).toISOString() : null } }))} /></label></div>}
              </div>
            </div>
          ))}
          {canWrite && <button type="button" className="add-row" onClick={() => setItems((current) => [...current, emptyQuoteItem()])}><Plus size={17} /> 작업 항목 추가</button>}
        </div>

        <aside className="quote-summary">
          <span><Receipt size={18} /> 계산 미리보기</span>
          <dl><div><dt>항목 합계</dt><dd>{formatMoney(estimatedSubtotal, project.currency)}</dd></div><div><dt>부가세</dt><dd>{formatMoney(estimatedSubtotal * taxRate, project.currency)}</dd></div><div className="quote-total"><dt>예상 합계</dt><dd>{formatMoney(estimatedSubtotal * (1 + taxRate), project.currency)}</dd></div></dl>
          <label>세율<input type="number" min="0" max="100" step="1" readOnly={!canWrite} value={Math.round(taxRate * 100)} onChange={(event) => setTaxRate(Number(event.target.value) / 100)} /><small>%</small></label>
          <label>유효 기간<input type="date" readOnly={!canWrite} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
          <p>저장할 때 위험 대비 금액과 세금까지 반영한 최종 합계를 다시 확인합니다.</p>
          {selectedBasis && <section className="evidence-inspector"><span>선택 항목 근거</span><strong>{selectedBasis.type === "EVIDENCE" ? selectedBasis.sourceTitle || "제목 없는 근거" : "확인할 가정"}</strong><p>{selectedBasis.content || "근거 또는 가정 내용을 입력하세요."}</p>{selectedBasis.type === "EVIDENCE" && <dl><div><dt>유형</dt><dd>{selectedBasis.sourceType ? sourceTypeLabel[selectedBasis.sourceType] : "미선택"}</dd></div><div><dt>참조</dt><dd>{selectedBasis.sourceReference || "미입력"}</dd></div><div><dt>조회</dt><dd>{selectedBasis.retrievedAt ? new Date(selectedBasis.retrievedAt).toLocaleString("ko-KR") : "미지정"}</dd></div></dl>}</section>}
          {canWrite ? <button type="button" className="primary-button" disabled={busy || !canSave} onClick={() => void save()}>{busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 검토용 초안 저장</button> : <small className="validation-hint">읽기 전용 견적입니다.</small>}
          {canWrite && !canSave && <small className="validation-hint">모든 항목에 이름, 수량, 단가와 근거 또는 가정을 입력하세요. 근거는 출처 유형과 참조가 필수입니다.</small>}
        </aside>
      </div>

      {saved && <article className="saved-quote" aria-live="polite">
        <div><span>견적 저장 완료 · {quotationStatusLabels[saved.status] ?? "상태 확인 필요"}</span><h3>{quotationScenarioLabels[saved.scenario]} v{saved.versionNumber}</h3><p>총액 {formatMoney(saved.total, saved.currency)} · 위험 대비율 {Math.round(saved.riskBufferRate * 100)}% · 세금 {formatMoney(saved.taxAmount, saved.currency)}</p></div>
        <div className="saved-quote-actions">
          {saved.status === "DRAFT" && canPublish && <button type="button" className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { const published = await publishQuotation(session, saved.id); setSaved(published); setQuotations((current) => current.map((quotation) => quotation.id === published.id ? published : quotation)); } catch (cause) { setError(cause instanceof Error ? cause.message : "견적을 발행하지 못했습니다."); } finally { setBusy(false); } }}>발행하기 <ArrowRight size={17} /></button>}
          {saved.status === "PUBLISHED" && canPublish && !proposalShare && <button type="button" className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { const share = await createProposalShare(session, saved.id); const url = new URL(`/proposal/${share.token}`, window.location.origin).toString(); setProposalShare({ ...share, url }); setShareCopyState(await copyToClipboard(url) ? "copied" : "manual"); } catch (cause) { setError(cause instanceof Error ? cause.message : "공유 링크를 만들지 못했습니다."); } finally { setBusy(false); } }}>고객 링크 만들기 <ArrowRight size={17} /></button>}
        </div>
      </article>}
      {proposalShare && <div className="share-link" role="status"><div><span>{shareCopyState === "copied" ? "고객 제안서 링크를 만들고 복사했습니다." : "고객 제안서 링크를 만들었습니다."}</span><small>{shareCopyState === "manual" ? "자동 복사가 차단되었습니다. 아래 링크를 직접 복사하세요." : `${new Date(proposalShare.expiresAt).toLocaleDateString("ko-KR")}까지 유효`}</small></div><a href={proposalShare.url} target="_blank" rel="noopener noreferrer">{proposalShare.url}</a><div className="share-link-actions"><button type="button" className="quiet-button" disabled={busy} onClick={async () => setShareCopyState(await copyToClipboard(proposalShare.url) ? "copied" : "manual")}><Copy size={17} /> 링크 복사</button><button type="button" className="quiet-button danger" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await revokeProposalShare(session, proposalShare.shareId); setProposalShare(null); setShareCopyState(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "공유 링크를 비활성화하지 못했습니다."); } finally { setBusy(false); } }}><Archive size={17} /> 링크 비활성화</button></div></div>}

      {quotations.length > 0 && <div className="quote-history"><span>견적 이력</span>{quotations.map((quotation) => <button type="button" key={quotation.id} onClick={() => loadQuotation(quotation)}><strong>{quotationScenarioLabels[quotation.scenario]} v{quotation.versionNumber}</strong><small>{quotationStatusLabels[quotation.status] ?? "상태 확인 필요"}</small><span>{formatMoney(quotation.total, quotation.currency)}</span></button>)}</div>}
    </section>
  );
}

function OutcomeReview({ session, project, permissions }: { session: AuthSession; project: Project; permissions: Set<string> }) {
  const canRead = permissions.has("outcome.read");
  const canWrite = permissions.has("outcome.write");
  const canReadQuotations = permissions.has("quotation.read");
  const [outcome, setOutcome] = useState<ActualOutcome | null>(null);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [workItems, setWorkItems] = useState<Array<{ title: string; actualHours: number; actualCost: number; notes: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    Promise.all([getOutcome(session, project.id), canReadQuotations ? listQuotations(session, project.id) : Promise.resolve([])])
      .then(([result, nextQuotations]) => { if (!cancelled) { setOutcome(result); setQuotations(nextQuotations); setWorkItems(result?.workItems.map((item) => ({ title: item.title, actualHours: item.actualHours, actualCost: item.actualCost, notes: item.notes ?? "" })) ?? []); } })
      .catch((cause: unknown) => {
        if (!cancelled && cause instanceof Error && !cause.message.includes("찾")) setError(cause.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canRead, canReadQuotations, project.id, session]);

  if (!canRead) return <div className="workspace-empty"><Graph size={38} /><h2>프로젝트 결과를 볼 수 없습니다.</h2><p>결과 조회가 필요하다면 작업 공간 관리자에게 문의해 주세요.</p></div>;
  if (loading) return <div className="section-loading"><CircleNotch className="spin" /> 결과 기록을 확인하고 있습니다.</div>;
  const approvedQuotation = outcome?.approvedQuotationId ? quotations.find((quotation) => quotation.id === outcome.approvedQuotationId) ?? null : null;
  const quotedHours = approvedQuotation?.items.filter((item) => item.unit === "HOUR").reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const revenueVariance = outcome && approvedQuotation ? outcome.totalRevenue - approvedQuotation.total : null;
  const hoursVariance = outcome && quotedHours > 0 ? outcome.actualHours - quotedHours : null;

  return (
    <section className="outcome-review">
      <div className="guided-copy"><span>프로젝트 회고</span><h2>끝난 프로젝트를 다음 견적의 근거로 남기세요.</h2><p>실제 공수와 비용을 직접 확정해 두면 이후 유사한 프로젝트의 참고 자료로 활용할 수 있습니다.</p></div>
      {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
      {outcome && <div className="outcome-snapshot"><Graph size={25} /><div><span>확정된 결과</span><strong>이익률 {Math.round(outcome.profitMargin * 100)}%</strong></div><dl><div><dt>매출</dt><dd>{formatMoney(outcome.totalRevenue, project.currency)}</dd></div><div><dt>실제 비용</dt><dd>{formatMoney(outcome.actualCost, project.currency)}</dd></div><div><dt>실제 공수</dt><dd>{outcome.actualHours}시간</dd></div></dl></div>}
      {outcome && approvedQuotation && <section className="outcome-variance"><header><span>예상 대비 오차</span><strong>{approvedQuotation.scenario} v{approvedQuotation.versionNumber}</strong></header><dl><div><dt>견적 대비 계약 금액</dt><dd className={revenueVariance != null && revenueVariance >= 0 ? "positive" : "negative"}>{revenueVariance == null ? "-" : `${revenueVariance >= 0 ? "+" : ""}${formatMoney(revenueVariance, project.currency)}`}</dd><small>견적 {formatMoney(approvedQuotation.total, approvedQuotation.currency)} → 실제 {formatMoney(outcome.totalRevenue, project.currency)}</small></div><div><dt>시간 공수 오차</dt><dd className={hoursVariance != null && hoursVariance <= 0 ? "positive" : "negative"}>{hoursVariance == null ? "비교 불가" : `${hoursVariance >= 0 ? "+" : ""}${hoursVariance.toLocaleString()}시간`}</dd><small>{quotedHours > 0 ? `시간 단위 견적 ${quotedHours.toLocaleString()}시간 → 실제 ${outcome.actualHours.toLocaleString()}시간` : "시간 단위 견적 항목이 없습니다."}</small></div></dl></section>}
      <form className="outcome-form" aria-busy={busy} onSubmit={async (event) => {
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
            workItems: workItems.map((item) => ({ quotationItemId: null, ...item })),
          });
          setOutcome(savedOutcome);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "결과를 저장하지 못했습니다.");
        } finally {
          setBusy(false);
        }
      }}>
        <fieldset className="outcome-fields" disabled={busy}>
        <div className="form-row"><label>기준 견적<select name="approvedQuotationId" disabled={!canWrite} defaultValue={outcome?.approvedQuotationId ?? ""}><option value="">연결하지 않음</option>{quotations.filter((quotation) => quotation.status === "PUBLISHED").map((quotation) => <option key={quotation.id} value={quotation.id}>{quotationScenarioLabels[quotation.scenario]} v{quotation.versionNumber} · {formatMoney(quotation.total, quotation.currency)}</option>)}</select></label><label>최종 계약 금액<input name="totalRevenue" type="number" min="0" required readOnly={!canWrite} defaultValue={outcome?.totalRevenue ?? ""} /></label><label>실제 비용<input name="actualCost" type="number" min="0" required readOnly={!canWrite} defaultValue={outcome?.actualCost ?? ""} /></label><label>실제 공수(시간)<input name="actualHours" type="number" min="0" step="0.5" required readOnly={!canWrite} defaultValue={outcome?.actualHours ?? ""} /></label><label>완료일<input name="completedOn" type="date" readOnly={!canWrite} defaultValue={outcome?.completedOn ?? ""} /></label></div>
        <div className="actual-work-items"><div><span>항목별 실제 결과</span>{canWrite && <button type="button" className="secondary-button" onClick={() => setWorkItems((current) => [...current, { title: "", actualHours: 0, actualCost: 0, notes: "" }])}><Plus size={16} /> 항목 추가</button>}</div>{workItems.length === 0 ? <p>필요하면 작업 항목별 실제 공수와 비용을 추가하세요.</p> : workItems.map((item, index) => <fieldset key={index} disabled={!canWrite}><legend>실제 작업 {index + 1}</legend><div className="form-row"><label>작업명<input required maxLength={200} value={item.title} onChange={(event) => setWorkItems((current) => current.map((currentItem, itemIndex) => itemIndex === index ? { ...currentItem, title: event.target.value } : currentItem))} /></label><label>공수(시간)<input type="number" min="0" step="0.5" value={item.actualHours} onChange={(event) => setWorkItems((current) => current.map((currentItem, itemIndex) => itemIndex === index ? { ...currentItem, actualHours: Number(event.target.value) } : currentItem))} /></label><label>비용<input type="number" min="0" step="1000" value={item.actualCost} onChange={(event) => setWorkItems((current) => current.map((currentItem, itemIndex) => itemIndex === index ? { ...currentItem, actualCost: Number(event.target.value) } : currentItem))} /></label></div><label>메모<textarea rows={2} maxLength={3000} value={item.notes} onChange={(event) => setWorkItems((current) => current.map((currentItem, itemIndex) => itemIndex === index ? { ...currentItem, notes: event.target.value } : currentItem))} /></label>{canWrite && <button type="button" className="remove-feature" onClick={() => setWorkItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash size={16} /> 항목 제거</button>}</fieldset>)}</div>
        <label>범위 변경과 예상 차이<textarea name="changeReason" rows={6} maxLength={5000} readOnly={!canWrite} defaultValue={outcome?.changeReason ?? ""} placeholder="추가된 범위, 줄어든 작업, 예상보다 오래 걸린 이유를 기록하세요." /></label>
        {canWrite ? <button type="submit" className="primary-button" disabled={busy}>{busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 사용자 확정 결과 저장</button> : <p className="permission-note">읽기 전용 결과입니다.</p>}
        </fieldset>
      </form>
    </section>
  );
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function formatRate(value: number, currency: string): string {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 6 }).format(value);
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function externalHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function InterruptionForm({ interruption, draftKey, draftWorkspaceId, draftRunId, busy, canRespond, onSubmit }: {
  interruption: NonNullable<AgentRunView["interruption"]>;
  draftKey: string;
  draftWorkspaceId: string;
  draftRunId: string;
  busy: boolean;
  canRespond: boolean;
  onSubmit: (answers: string[]) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState<string[]>(() => {
    if (typeof window === "undefined") return interruption.questions.map(() => "");
    try {
      const raw = window.sessionStorage.getItem(draftKey);
      const draft = raw ? parseInterruptionDraft(raw, { workspaceId: draftWorkspaceId, runId: draftRunId, interruptionId: interruption.interruptionId, questions: interruption.questions }) : null;
      return (draft?.answers as string[] | undefined) ?? interruption.questions.map(() => "");
    } catch {
      return interruption.questions.map(() => "");
    }
  });
  const hasDraft = answers.some((answer) => answer.length > 0);
  const pending = busy || submitting;

  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.from(formRef.current?.querySelectorAll("label") ?? [], { opacity: 0, y: 10, duration: .38, stagger: .06, ease: "power2.out", clearProps: "all" });
  }, { scope: formRef, dependencies: [interruption.interruptionId] });

  useEffect(() => {
    try {
      if (!hasDraft) {
        window.sessionStorage.removeItem(draftKey);
        return;
      }
      window.sessionStorage.setItem(draftKey, JSON.stringify(createInterruptionDraft({
        workspaceId: draftWorkspaceId,
        runId: draftRunId,
        interruptionId: interruption.interruptionId,
        questions: interruption.questions,
        answers,
      })));
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }, [answers, draftKey, draftRunId, draftWorkspaceId, hasDraft, interruption.interruptionId, interruption.questions]);

  const submitAnswers = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSubmitting(true);
    try {
      await onSubmit(answers.map((answer) => answer.trim()));
      try { window.sessionStorage.removeItem(draftKey); } catch { /* no-op */ }
    } catch {
      // The parent exposes the API error; retaining the draft is the recovery path.
    } finally {
      setSubmitting(false);
    }
  };

  const clearDraft = () => {
    setAnswers(interruption.questions.map(() => ""));
    try { window.sessionStorage.removeItem(draftKey); } catch { /* no-op */ }
  };

  return (
    <form ref={formRef} className="interruption-form" aria-busy={pending} onSubmit={(event) => void submitAnswers(event)}>
      <span>사용자 확인 필요</span>
      <h3>다음 내용을 확인해 주세요.</h3>
      {interruption.questions.map((question, index) => <label key={question}>{question}<textarea required readOnly={!canRespond} value={answers[index]} onChange={(event) => setAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? event.target.value : answer))} /></label>)}
      {canRespond ? <div className="interruption-actions"><div aria-live="polite">{hasDraft ? "작성 중인 답변은 이 탭에 임시 저장됩니다." : "답변을 입력하면 이 탭에 임시 저장됩니다."}</div><span><button type="button" className="quiet-button" disabled={pending || !hasDraft} onClick={clearDraft}><Trash size={16} /> 답변 지우기</button><button type="submit" className="primary-button" disabled={pending || answers.some((answer) => !answer.trim())}>{pending ? <CircleNotch className="spin" /> : <ArrowRight />} 답변하고 계속</button></span></div> : <p className="permission-note">이 실행에 답변할 권한이 없습니다.</p>}
    </form>
  );
}

function useDialogFocusTrap(dialogRef: RefObject<HTMLElement | null>, onClose: () => void, closeDisabled = false) {
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    closeRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])")?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabledRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, textarea, select, [href], [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [dialogRef]);
}

function ProjectEditDialog({
  session,
  project,
  clients,
  onClose,
  onUpdated,
}: {
  session: AuthSession;
  project: Project;
  clients: Client[];
  onClose: () => void;
  onUpdated: (project: Project) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogFocusTrap(dialogRef, onClose, busy);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const budgetMin = data.get("budgetMin") ? Number(data.get("budgetMin")) : null;
    const budgetMax = data.get("budgetMax") ? Number(data.get("budgetMax")) : null;
    if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) {
      setError("최소 예산은 최대 예산보다 클 수 없습니다.");
      return;
    }
    const input: ProjectInput = {
      clientId: String(data.get("clientId")) || null,
      title: String(data.get("title")).trim(),
      requirementText: String(data.get("requirementText")).trim(),
      currency: String(data.get("currency")),
      deadline: String(data.get("deadline")) || null,
      budgetMin,
      budgetMax,
    };
    setBusy(true);
    setError(null);
    try {
      onUpdated(await updateProjectDetails(session, project, input));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "프로젝트 정보를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} className="project-dialog project-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="project-edit-title">
        <div><span>프로젝트 정보</span><button type="button" disabled={busy} onClick={onClose} aria-label="닫기">×</button></div>
        <h2 id="project-edit-title">문의 조건을 최신 상태로 맞추세요.</h2>
        <p>변경한 내용은 다음 AI 분석과 새 견적부터 반영됩니다. 이미 고객에게 보낸 견적은 그대로 유지됩니다.</p>
        {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
        <form aria-busy={busy} onSubmit={submit}>
          <fieldset className="dialog-fields" disabled={busy}>
            <div className="form-row"><label>고객 연결<select name="clientId" defaultValue={project.clientId ?? ""}><option value="">연결하지 않음</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.companyName ? ` · ${client.companyName}` : ""}</option>)}</select></label><label>통화<select name="currency" defaultValue={project.currency}><option value="KRW">KRW</option><option value="USD">USD</option><option value="JPY">JPY</option></select></label></div>
            <label>프로젝트 이름<input data-autofocus name="title" required maxLength={200} defaultValue={project.title} /></label>
            <label>고객 문의 원문<textarea name="requirementText" required maxLength={50000} rows={8} defaultValue={project.requirementText} /></label>
            <div className="form-row"><label>희망 완료일<input name="deadline" type="date" defaultValue={project.deadline ?? ""} /></label><label>최소 예산<input name="budgetMin" type="number" min="0" step="10000" defaultValue={project.budgetMin ?? ""} /></label><label>최대 예산<input name="budgetMax" type="number" min="0" step="10000" defaultValue={project.budgetMax ?? ""} /></label></div>
            <div className="dialog-actions"><button type="button" className="quiet-button" onClick={onClose}>취소</button><button type="submit" className="primary-button">{busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 변경 저장</button></div>
          </fieldset>
        </form>
      </section>
    </div>
  );
}

function ProjectDialog({ clients, onClose, onCreate }: { clients: Client[]; onClose: () => void; onCreate: (input: { clientId: string | null; title: string; requirementText: string; currency: string; deadline: string | null; budgetMin: number | null; budgetMax: number | null }) => Promise<void> }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogFocusTrap(dialogRef, onClose, busy);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <div><span>새 고객 문의</span><button type="button" disabled={busy} onClick={onClose} aria-label="닫기">×</button></div>
        <h2 id="project-dialog-title">먼저 알고 있는 내용을 적어주세요.</h2>
        <p>모호해도 괜찮습니다. 확인되지 않은 내용은 다음 단계에서 질문으로 분리합니다.</p>
        {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
        <form aria-busy={busy} onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const data = new FormData(event.currentTarget);
          const budgetMin = data.get("budgetMin") ? Number(data.get("budgetMin")) : null;
          const budgetMax = data.get("budgetMax") ? Number(data.get("budgetMax")) : null;
          if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) {
            setError("최소 예산은 최대 예산보다 클 수 없습니다.");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await onCreate({
            clientId: String(data.get("clientId")) || null,
            title: String(data.get("title")).trim(),
            requirementText: String(data.get("requirementText")).trim(),
            currency: String(data.get("currency")),
            deadline: String(data.get("deadline")) || null,
            budgetMin,
            budgetMax,
            });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "프로젝트를 만들지 못했습니다.");
          } finally {
            setBusy(false);
          }
        }}>
          <fieldset className="dialog-fields" disabled={busy}>
            <label>고객 연결<select name="clientId" defaultValue=""><option value="">아직 고객을 연결하지 않음</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.companyName ? ` · ${client.companyName}` : ""}</option>)}</select><small>{clients.length === 0 ? "고객 메뉴에서 연락처를 먼저 등록할 수 있습니다." : "선택한 고객은 프로젝트와 함께 저장됩니다."}</small></label>
            <label>프로젝트 이름<input data-autofocus name="title" required maxLength={200} placeholder="예: 브랜드 사이트 리뉴얼" /></label>
            <label>고객 문의 원문<textarea name="requirementText" required maxLength={50000} rows={8} placeholder="고객이 보낸 메시지나 현재 알고 있는 요구사항을 붙여 넣으세요." /></label>
            <div className="form-row"><label>통화<select name="currency" defaultValue="KRW">{currencyOptions.map((currency) => <option key={currency.value} value={currency.value}>{currency.label}</option>)}</select></label><label>희망 완료일<input name="deadline" type="date" /></label><label>예산 범위<div className="budget-range"><input name="budgetMin" type="number" min="0" step="10000" aria-label="최소 예산" placeholder="최소" /><span>–</span><input name="budgetMax" type="number" min="0" step="10000" aria-label="최대 예산" placeholder="최대" /></div></label></div>
            <button className="primary-button" type="submit">{busy ? <CircleNotch className="spin" /> : <ArrowRight size={18} />} {busy ? "프로젝트를 만들고 있습니다." : "프로젝트 만들기"}</button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
