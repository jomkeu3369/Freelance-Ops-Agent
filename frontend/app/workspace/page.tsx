"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  AddressBook,
  Archive,
  CheckCircle,
  CircleNotch,
  Copy,
  Clock,
  FileText,
  FolderOpen,
  Graph,
  GearSix,
  House,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Receipt,
  SignOut,
  Trash,
  Warning,
  Waveform,
} from "@phosphor-icons/react";
import { LiveWorkflow, snapshotFromEvents } from "../components/live-workflow";
import { isActiveStreamStatus, nextStreamCursor, streamReconnectDelay } from "../lib/stream-retry.mjs";
import { sessionRefreshDelay } from "../lib/session-timing.mjs";
import { buildWorkspaceSearch, parseWorkspaceLocation } from "../lib/workspace-navigation.mjs";
import { createQuotationDraft, parseQuotationDraft, quotationDraftFingerprint, quotationDraftKey } from "../lib/quotation-draft.mjs";
import {
  AgentRunView,
  AgentRunUsage,
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

const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "WAITING_FOR_USER"]);

export default function WorkspacePage() {
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

  const onAuthenticated = async (nextSession: AuthSession) => {
    saveSession(nextSession);
    setSession(nextSession);
    setError(null);
    await refreshProjects(nextSession);
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
          {profile && profile.workspaces.length > 1 && <label><span className="sr-only">Workspace 전환</span><select value={session.workspaceId} onChange={async (event) => {
            const nextSession = { ...session, workspaceId: event.target.value };
            saveSession(nextSession);
            setSession(nextSession);
            setSelectedProject(null);
            setRun(null);
            setRunId(null);
            setEvents([]);
            setError(null);
            navigateWorkspace("pipeline", null, "intake", true);
            try { await refreshProjects(nextSession); } catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace를 전환하지 못했습니다."); }
          }}>{profile.workspaces.map((workspace) => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.name}</option>)}</select></label>}
          <button type="button" className="quiet-button" onClick={() => void logout()}><SignOut size={18} /> 로그아웃</button>
        </div>
      </header>

      <aside className="workspace-sidebar">
        <div className="workspace-nav">
          <button type="button" aria-current={activeView === "pipeline" ? "page" : undefined} className={activeView === "pipeline" ? "active" : ""} onClick={() => navigateWorkspace("pipeline")}><House size={18} /><span>Pipeline</span></button>
          {activePermissions.has("client.read") && <button type="button" aria-current={activeView === "clients" ? "page" : undefined} className={activeView === "clients" ? "active" : ""} onClick={() => navigateWorkspace("clients")}><AddressBook size={18} /><span>고객</span></button>}
          {activePermissions.has("document.read") && <button type="button" aria-current={activeView === "knowledge" ? "page" : undefined} className={activeView === "knowledge" ? "active" : ""} onClick={() => navigateWorkspace("knowledge")}><FileText size={18} /><span>근거 자료</span></button>}
          <button type="button" aria-current={activeView === "settings" ? "page" : undefined} className={activeView === "settings" ? "active" : ""} onClick={() => navigateWorkspace("settings")}><GearSix size={18} /><span>설정</span></button>
        </div>
        <div className="sidebar-heading">
          <span>프로젝트</span>
          {canWriteProject && <button type="button" onClick={() => setShowNewProject(true)} aria-label="새 프로젝트 만들기"><Plus size={18} /></button>}
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
              <small>{project.status}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>Workspace</span>
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
          <SettingsPanel session={session} permissions={activePermissions} />
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
  onAuthenticated: (session: AuthSession) => Promise<void>;
  error: string | null;
  setError: (message: string | null) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);

  const handleTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!(["ArrowLeft", "ArrowRight", "Home", "End"] as string[]).includes(event.key)) return;
    event.preventDefault();
    const nextMode: AuthMode = event.key === "ArrowLeft" || event.key === "Home" ? "login" : "register";
    setMode(nextMode);
    document.getElementById(`auth-tab-${nextMode}`)?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const session = mode === "login"
        ? await login(String(data.get("email")), String(data.get("password")))
        : await register({
          email: String(data.get("email")),
          password: String(data.get("password")),
          displayName: String(data.get("displayName")),
          workspaceName: String(data.get("workspaceName")),
        });
      await onAuthenticated(session);
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
        <p>로그인하면 프로젝트 생성부터 실시간 Agent 실행, 확인 질문과 결과 검토까지 한 화면에서 이어집니다.</p>
        <div className="auth-flow" aria-hidden="true"><i /><i /><i /><i /></div>
      </section>
      <section className="auth-panel">
        <div className="auth-tabs" role="tablist" aria-label="인증 방식">
          <button id="auth-tab-login" type="button" role="tab" aria-controls="auth-panel-login" aria-selected={mode === "login"} tabIndex={mode === "login" ? 0 : -1} onKeyDown={handleTabKey} onClick={() => setMode("login")}>로그인</button>
          <button id="auth-tab-register" type="button" role="tab" aria-controls="auth-panel-register" aria-selected={mode === "register"} tabIndex={mode === "register" ? 0 : -1} onKeyDown={handleTabKey} onClick={() => setMode("register")}>처음 시작하기</button>
        </div>
        <form id={`auth-panel-${mode}`} role="tabpanel" aria-labelledby={`auth-tab-${mode}`} aria-busy={busy} onSubmit={submit}>
          {mode === "register" && <>
            <label>표시 이름<input name="displayName" required maxLength={100} autoComplete="name" /></label>
            <label>Workspace 이름<input name="workspaceName" required maxLength={120} /></label>
          </>}
          <label>이메일<input name="email" type="email" required autoComplete="email" /></label>
          <label>비밀번호<input name="password" type="password" required minLength={12} maxLength={72} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={busy}>
            {busy ? <CircleNotch size={19} className="spin" /> : <ArrowRight size={19} />}
            {mode === "login" ? "업무 공간 열기" : "Workspace 만들기"}
          </button>
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
        <div><span>WORKSPACE PIPELINE</span><h1>다음에 할 일을 한눈에.</h1><p>문의부터 회고까지 실제 프로젝트 상태를 기준으로 정리합니다.</p></div>
        {canWrite && <button type="button" className="primary-button" onClick={onCreate}><Plus size={18} /> 새 문의 등록</button>}
      </div>
      <div className="pipeline-summary"><div><span>활성 프로젝트</span><strong>{activeProjects.length}</strong></div><div><span>견적 진행</span><strong>{projects.filter((project) => ["QUOTING", "NEGOTIATING"].includes(project.status)).length}</strong></div><div><span>회고 필요</span><strong>{projects.filter((project) => project.status === "COMPLETED").length}</strong></div></div>
      {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
      {activeProjects.length === 0 ? <div className="pipeline-empty"><FolderOpen size={34} /><h2>아직 등록된 문의가 없습니다.</h2><p>{canWrite ? "첫 고객 문의를 등록하면 이곳에서 단계별 진행 상태를 관리할 수 있습니다." : "이 Workspace에서는 프로젝트를 읽기 전용으로 확인할 수 있습니다."}</p>{canWrite && <button type="button" className="primary-button" onClick={onCreate}>첫 문의 등록</button>}</div> : (
        <div className="pipeline-board">
          {pipelineColumns.map((column) => {
            const columnProjects = activeProjects.filter((project) => column.statuses.includes(project.status as ProjectStatus));
            return <section className="pipeline-column" key={column.key} aria-labelledby={`pipeline-${column.key}`}>
              <header><div><h2 id={`pipeline-${column.key}`}>{column.title}</h2><p>{column.caption}</p></div><span>{columnProjects.length}</span></header>
              <div className="pipeline-cards">
                {columnProjects.length === 0 ? <p className="column-empty">이 단계의 프로젝트가 없습니다.</p> : columnProjects.map((project) => <article key={project.id} className={movingId === project.id ? "saving" : ""}>
                  <button type="button" className="pipeline-card-open" onClick={() => onSelect(project)}><span>{project.currency}</span><h3>{project.title}</h3><p>{project.requirementText}</p><small>{project.deadline ? `${project.deadline}까지` : "일정 미정"}</small></button>
                  {canWrite && <label>단계 이동<select value={column.moveTo} disabled={movingId === project.id} onChange={(event) => void move(project, event.target.value as ProjectStatus)}>{pipelineColumns.map((target) => <option key={target.key} value={target.moveTo}>{target.title}</option>)}</select></label>}
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
      setNotice("자료가 저장되었습니다. Agent 검색 범위에서 사용할 수 있습니다.");
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
      setNotice("자료를 보관했습니다. 이후 Agent 검색에서는 제외됩니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자료를 보관하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="knowledge-page">
      <div className="knowledge-heading">
        <div><span>EVIDENCE LIBRARY</span><h1>Agent가 참고할 자료를 직접 관리합니다.</h1><p>과거 프로젝트, 정책, 약관과 사용자 자료를 Workspace 경계 안에서 검토하고 검색 범위를 통제하세요.</p></div>
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
          {loading ? <div className="section-loading"><CircleNotch className="spin" /> 자료를 확인하고 있습니다.</div> : filtered.length === 0 ? <div className="client-empty"><FileText size={30} /><strong>{documents.length === 0 ? "저장된 자료가 없습니다." : "조건에 맞는 자료가 없습니다."}</strong><span>텍스트 자료를 추가하면 Agent가 허용된 검색 도구로 참조할 수 있습니다.</span></div> : filtered.map((document) => <button type="button" key={document.id} className={selectedId === document.id ? "active" : ""} onClick={() => { setSelectedId(document.id); setArchiveTarget(null); setNotice(null); }}><span className="document-type">{sourceTypeLabel[document.sourceType]}</span><strong>{document.title}</strong><small>{document.jurisdiction ?? "관할권 미지정"} · {new Date(document.createdAt).toLocaleDateString("ko-KR")}</small></button>)}
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

function SettingsPanel({ session, permissions }: { session: AuthSession; permissions: Set<string> }) {
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

  if (loading) return <div className="section-loading"><CircleNotch className="spin" /> Workspace 설정을 확인하고 있습니다.</div>;

  const workspace = profile?.workspaces.find((item) => item.workspaceId === session.workspaceId);
  const onboardingComplete = rateCards.some((card) => card.active) && Boolean(policy);

  return (
    <section className="settings-page">
      <div className="settings-heading"><span>WORKSPACE SETTINGS</span><h1>{onboardingComplete ? "견적 기준을 관리합니다." : "첫 견적 기준을 설정하세요."}</h1><p>금액 계산에 쓰이는 단가와 정책은 Spring이 소유하며 모든 견적에 결정적으로 적용됩니다.</p></div>
      {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
      {saved && <div className="settings-saved" role="status"><CheckCircle size={18} />{saved}</div>}
      <div className="settings-grid">
        <aside className="settings-index"><a href="#workspace-profile">Workspace</a><a href="#rate-cards">단가표</a><a href="#estimation-policy">견적 정책</a>{canReadPricing && <a href="#model-pricing">AI 원가표</a>}<a href="#permissions">권한·데이터</a></aside>
        <div className="settings-content">
          <section id="workspace-profile"><header><div><h2>Workspace profile</h2><p>현재 인증된 사용자와 Workspace 정보입니다.</p></div></header><dl><div><dt>Workspace</dt><dd>{workspace?.name ?? session.workspaceId}</dd></div><div><dt>사용자</dt><dd>{profile?.displayName ?? profile?.email ?? "-"}</dd></div><div><dt>상태</dt><dd>{profile?.status ?? "-"}</dd></div></dl></section>
          <section id="rate-cards"><header><div><h2>서비스 단가</h2><p>시간·일·고정 금액 기준을 등록합니다.</p></div></header>
            <RateCardManager session={session} rateCards={rateCards} canWrite={canWriteQuotation} onChange={setRateCards} />
          </section>
          <section id="estimation-policy"><header><div><h2>견적 정책</h2><p>세금, 위험 buffer와 최대 할인율을 설정합니다.</p></div></header>{policy ? canWriteQuotation ? <EstimationPolicyForm session={session} policy={policy} busy={busy} setBusy={setBusy} setError={setError} setSaved={setSaved} onSaved={setPolicy} /> : <dl><div><dt>기본 세율</dt><dd>{Math.round(policy.defaultTaxRate * 100)}%</dd></div><div><dt>위험 buffer</dt><dd>{Math.round(policy.defaultRiskBufferRate * 100)}%</dd></div><div><dt>최대 할인율</dt><dd>{Math.round(policy.maximumDiscountRate * 100)}%</dd></div></dl> : <p>현재 계정에는 견적 정책을 조회할 권한이 없습니다.</p>}</section>
          {canReadPricing && <section id="model-pricing"><header><div><h2>AI 모델 원가표</h2><p>Agent 실행 비용 계산에 쓰이는 불변 가격 스냅샷입니다.</p></div></header>
            <div className="model-pricing-list">{modelPricing.length === 0 ? <p>등록된 가격 스냅샷이 없습니다.</p> : modelPricing.map((pricing) => <article key={pricing.id}><div><span>{pricing.provider}</span><strong>{pricing.model}</strong><small>{pricing.versionLabel}</small></div><dl><div><dt>입력 / 1M</dt><dd>{formatRate(pricing.inputPerMillion, pricing.currency)}</dd></div><div><dt>캐시 / 1M</dt><dd>{formatRate(pricing.cachedInputPerMillion, pricing.currency)}</dd></div><div><dt>출력 / 1M</dt><dd>{formatRate(pricing.outputPerMillion, pricing.currency)}</dd></div></dl><p>{new Date(pricing.validFrom).toLocaleString("ko-KR")}부터{pricing.validUntil ? ` · ${new Date(pricing.validUntil).toLocaleString("ko-KR")}까지` : " · 종료일 없음"}</p></article>)}</div>
            {canManagePricing ? <ModelPricingForm session={session} busy={busy} setBusy={setBusy} setError={setError} setSaved={setSaved} onCreated={(pricing) => setModelPricing((current) => [pricing, ...current])} /> : <p className="permission-note">가격 스냅샷을 등록하려면 workspace.update 권한이 필요합니다.</p>}
          </section>}
          <section id="permissions"><header><div><h2>권한과 데이터 경계</h2><p>화면 숨김이 아니라 Spring permission 검사가 최종 보안 경계입니다.</p></div></header><div className="permission-list">{workspace?.effectivePermissions.map((permission) => <code key={permission}>{permission}</code>) ?? <p>표시할 effective permission이 없습니다.</p>}</div><p className="data-note">인증 정보는 현재 브라우저 탭의 sessionStorage에만 유지됩니다. Agent는 이 사용자의 위임된 권한을 넘을 수 없습니다.</p></section>
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
  }}><fieldset className="settings-fields" disabled={busy}><div className="form-row"><label>기본 세율 (%)<input name="taxRate" type="number" min="0" max="100" step="0.1" defaultValue={policy.defaultTaxRate * 100} /></label><label>위험 buffer (%)<input name="bufferRate" type="number" min="0" max="100" step="0.1" defaultValue={policy.defaultRiskBufferRate * 100} /></label><label>최대 할인율 (%)<input name="discountRate" type="number" min="0" max="100" step="0.1" defaultValue={policy.maximumDiscountRate * 100} /></label></div><button type="submit" className="primary-button" disabled={busy}>{busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 정책 저장</button></fieldset></form>;
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
      setSaved("AI 모델 가격 스냅샷이 등록되었습니다.");
      form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "모델 가격을 등록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }}><fieldset className="settings-fields" disabled={busy}><div className="form-row"><label>Provider<select name="provider" defaultValue="OPENAI"><option value="OPENAI">OpenAI</option><option value="GEMINI">Gemini</option></select></label><label>모델<input name="model" required maxLength={100} placeholder="예: gpt-5.4-mini" /></label><label>버전 라벨<input name="versionLabel" required maxLength={100} placeholder="예: 2026-08 공식 가격" /></label><label>통화<select name="currency" defaultValue="USD"><option value="USD">USD</option><option value="KRW">KRW</option><option value="JPY">JPY</option></select></label></div><div className="form-row"><label>입력 / 1M<input name="inputPerMillion" type="number" min="0" step="0.000001" required /></label><label>캐시 입력 / 1M<input name="cachedInputPerMillion" type="number" min="0" step="0.000001" required /></label><label>출력 / 1M<input name="outputPerMillion" type="number" min="0" step="0.000001" required /></label></div><div className="form-row"><label>유효 시작<input name="validFrom" type="datetime-local" required /></label><label>유효 종료<input name="validUntil" type="datetime-local" /></label></div><button type="submit" className="secondary-button" disabled={busy}>{busy ? <CircleNotch className="spin" /> : <Plus size={18} />} 가격 스냅샷 등록</button></fieldset></form>;
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
        <div className="rate-card-form-heading"><div><strong>{selected ? "단가 편집" : "새 단가 등록"}</strong><span>{selected ? `서버 버전 ${selected.version}` : "견적 계산에 사용할 기준을 입력하세요."}</span></div>{selected && <span className={selected.active ? "active" : "inactive"}>{selected.active ? "사용 중" : "비활성"}</span>}</div>
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
      <p>{canCreate ? "프로젝트를 만들면 요구사항 정리와 Agent 실행 흐름을 시작할 수 있습니다." : "현재 역할에는 프로젝트 생성 권한이 없습니다."}</p>
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
  onRun: (provider: Provider, model: string) => Promise<void>;
  onResetRun: () => void;
  onCancel: () => Promise<void>;
  onResume: (answers: string[]) => Promise<void>;
}) {
  const [provider, setProvider] = useState<Provider>("OPENAI");
  const [model, setModel] = useState(process.env.NEXT_PUBLIC_DEFAULT_MODEL ?? "");
  const [activeStep, setActiveStep] = useState<WorkbenchStep>(initialStep);
  const [editingProject, setEditingProject] = useState(false);
  const [costUsage, setCostUsage] = useState<AgentRunUsage | null>(null);
  const canRun = permissions.has("agent.run");
  const canRespond = permissions.has("agent.respond");
  const canCancel = permissions.has("agent.cancel");

  useEffect(() => {
    Promise.resolve().then(() => setActiveStep(initialStep));
  }, [initialStep, project.id]);

  const selectStep = (step: WorkbenchStep) => {
    setActiveStep(step);
    onStepChange(step);
  };

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
          <span className="project-status"><i /> {project.status}</span>
          <h1>{project.title}</h1>
          <p>{project.requirementText}</p>
        </div>
        {permissions.has("project.write") && activeStep !== "agent" && <button type="button" className="secondary-button" onClick={() => setEditingProject(true)}><PencilSimple size={18} /> 프로젝트 정보 수정</button>}
        {!runId && activeStep === "agent" && canRun ? (
          <div className="run-controls">
            <label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}><option value="OPENAI">OpenAI</option><option value="GEMINI">Gemini</option></select></label>
            <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="사용 가능한 모델명" /></label>
            <button type="button" className="primary-button" disabled={busy || !model.trim()} onClick={() => onRun(provider, model.trim())}>
              {busy ? <CircleNotch className="spin" /> : <Waveform size={19} />} 분석 시작
            </button>
          </div>
        ) : activeStep === "agent" && run && terminalStatuses.has(run.status) && canRun ? <button type="button" className="secondary-button" onClick={onResetRun}><ArrowRight size={18} /> 새 분석 준비</button> : null}
      </div>

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

      {activeStep === "agent" && <div className="workbench-grid">
        <div className="graph-panel">
          <LiveWorkflow snapshot={snapshot} />
          {runId && canCancel && (!run || ["QUEUED", "RUNNING", "WAITING_FOR_USER"].includes(run.status)) && <div className="run-action-bar"><span>필요하면 현재 실행을 안전하게 중단할 수 있습니다.</span><button type="button" className="quiet-button danger" disabled={busy} onClick={() => void onCancel()}>{busy ? <CircleNotch className="spin" /> : <Warning size={17} />} 실행 중단</button></div>}
          <div className="event-timeline">
            <div className="panel-title"><span>최근 실행 신호</span><small>{events.length ? `${events.length}개 수신` : "아직 신호 없음"}</small></div>
            {events.length === 0 ? (
              <p className="empty-copy">분석을 시작하면 실제 서버 이벤트가 이곳에 표시됩니다.</p>
            ) : (
              <ol>{events.slice(-6).reverse().map((event) => <li key={event.eventId}><span>{event.type}</span><time>{event.occurredAt ? new Date(event.occurredAt).toLocaleTimeString("ko-KR") : "방금"}</time></li>)}</ol>
            )}
          </div>
        </div>

        <aside className="run-inspector">
          <div className="panel-title"><span>검토 패널</span>{run && <small>{run.status}</small>}</div>
          {!run ? (
            <div className="inspector-empty"><Clock size={26} /><p>실행 결과와 확인 질문이 여기에 나타납니다.</p></div>
          ) : run.status === "WAITING_FOR_USER" && run.interruption ? (
            <InterruptionForm interruption={run.interruption} busy={busy} canRespond={canRespond} onSubmit={onResume} />
          ) : ["FAILED", "CANCELLED"].includes(run.status) ? (
            <div className="run-failed"><Warning size={30} /><h3>{run.status === "CANCELLED" ? "사용자가 실행을 중단했습니다." : "실행이 중단되었습니다."}</h3><p>{run.status === "CANCELLED" ? "저장된 프로젝트와 이전 결과는 변경되지 않습니다." : run.errorCode ?? "공개 오류 코드가 없습니다."}</p></div>
          ) : run.result ? (
            <div className="run-result">
              <span className="result-state"><CheckCircle size={17} /> 분석 결과</span>
              <h3>프로젝트 요약</h3>
              <p>{run.result.projectSummary}</p>
              {run.metadata && <div className="run-provenance"><span>{run.metadata.provider} · {run.metadata.model}</span><small>Prompt {run.metadata.promptVersion} · Tool schema {run.metadata.toolSchemaVersion}</small></div>}
              {run.result.openQuestions.length > 0 && <section className="run-open-questions"><span>아직 확인할 질문</span><ul>{run.result.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul></section>}
              {run.result.departmentResults.map((result) => <article key={result.department}>
                <strong>{result.department}</strong>
                <p>{result.summary}</p>
                <small>근거 {result.evidenceIds.length} · 가정 {result.assumptionIds.length}</small>
                {result.sources.length > 0 && <details className="run-sources"><summary>검토 가능한 출처 {result.sources.length}개</summary><ul>{result.sources.map((source, index) => {
                  const safeUrl = externalHttpUrl(source.url);
                  return <li key={`${source.url}-${index}`}><div><span>{source.title}</span><small>{source.provider}{source.jurisdiction ? ` · ${source.jurisdiction}` : ""}</small></div>{source.excerpt && <p>{source.excerpt}</p>}{safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">원문 열기 <ArrowRight size={13} /></a> : <code>{source.url}</code>}</li>;
                })}</ul></details>}
              </article>)}
              {run.usage && <dl className="usage-list"><div><dt>Model 호출</dt><dd>{run.usage.modelCalls}</dd></div><div><dt>Tool 호출</dt><dd>{run.usage.toolCalls}</dd></div><div><dt>소요 시간</dt><dd>{Math.round(run.usage.durationMs / 1000)}초</dd></div></dl>}
              {costUsage && <div className="cost-usage"><div><span>서버 원가 기록</span><strong>{costUsage.actualCost != null && costUsage.costCurrency ? formatMoney(costUsage.actualCost, costUsage.costCurrency) : "계산 대기"}</strong></div><dl><div><dt>입력 Token</dt><dd>{costUsage.inputTokens.toLocaleString()}</dd></div><div><dt>출력 Token</dt><dd>{costUsage.outputTokens.toLocaleString()}</dd></div><div><dt>검색 Credit</dt><dd>{costUsage.searchCredits}</dd></div><div><dt>과금 가능 결과</dt><dd>{costUsage.billableOutcome ? "예" : "아니오"}</dd></div></dl><small>{costUsage.costStatus} · {costUsage.requestTier}</small></div>}
            </div>
          ) : (
            <div className="inspector-empty running"><CircleNotch size={29} className="spin" /><p>결과를 만들고 있습니다. 그래프에서 현재 단계를 확인하세요.</p></div>
          )}
        </aside>
      </div>}

      {activeStep === "quote" && <QuoteBuilder session={session} project={project} permissions={permissions} />}
      {activeStep === "outcome" && <OutcomeReview session={session} project={project} permissions={permissions} />}
      {editingProject && <ProjectEditDialog session={session} project={project} clients={clients} onClose={() => setEditingProject(false)} onUpdated={(updated) => { onProjectUpdated(updated); setEditingProject(false); }} />}
    </>
  );
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

  return (
    <section className="intake-review requirement-review">
      <div className="guided-copy">
        <span>사용자 입력 · 원문</span>
        <h2>문의 내용을 먼저 확인합니다.</h2>
        <p>왼쪽 원문과 오른쪽 구조화 결과를 나란히 검토합니다. 저장된 버전은 사용자 확정 결과이며 AI 초안과 구분됩니다.</p>
        <div className="requirement-version-state"><span>{loading ? "불러오는 중" : structuredOutdated ? "원문 변경됨 · 새 revision 필요" : latest ? `사용자 확정 v${latest.versionNumber}` : "구조화 전"}</span><small>{latest ? new Date(latest.createdAt).toLocaleString("ko-KR") : "첫 버전을 작성해 주세요."}</small></div>
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
          <p>업로드한 파일은 이 Workspace의 근거 자료로 저장되며, Agent 검색 권한 안에서만 사용됩니다.</p>
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
        }}>{editing ? "편집 닫기" : latest ? "새 revision" : "직접 구조화"}</button>}</header>
        {structuredOutdated && <div className="inline-error requirement-stale" role="status"><Warning size={18} />문의 원문이 마지막 구조화 버전 이후 변경되었습니다. 새 revision을 확정한 뒤 견적을 검토하세요.</div>}
        {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
        {latest && !editing ? <>
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
  kind: "restored" | "saved" | "unavailable";
  updatedAt: string | null;
};

function QuoteBuilder({ session, project, permissions }: { session: AuthSession; project: Project; permissions: Set<string> }) {
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
  const draftReadyRef = useRef(false);
  const draftBaselineRef = useRef("");
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
    draftReadyRef.current = false;
    setDraftStatus(null);
    Promise.all([listQuotations(session, project.id), listRateCards(session)])
      .then(([result, nextRateCards]) => {
        if (!cancelled) {
          setQuotations(result);
          setRateCards(nextRateCards.filter((card) => card.active));
          const latest = result[0] ?? null;
          const defaultScenario = latest?.scenario ?? "RECOMMENDED";
          const defaultItems = latest ? quotationItemsAsInput(latest) : [emptyQuoteItem()];
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
            const baseQuotation = restored.baseQuotationId
              ? result.find((quotation) => quotation.id === restored.baseQuotationId) ?? null
              : null;
            setSaved(baseQuotation);
            setScenario(restored.scenario);
            setItems(restored.items);
            setTaxRate(restored.taxRate);
            setValidUntil(restored.validUntil);
            const restoredFingerprint = fingerprint(restored.scenario, restored.baseQuotationId, restored.taxRate, restored.validUntil, restored.items);
            const baselineItems = baseQuotation ? quotationItemsAsInput(baseQuotation) : [emptyQuoteItem()];
            draftBaselineRef.current = fingerprint(
              baseQuotation?.scenario ?? "RECOMMENDED",
              baseQuotation?.id ?? null,
              baseQuotation?.taxRate ?? .1,
              baseQuotation?.validUntil ?? "",
              baselineItems,
            );
            lastPersistedDraftRef.current = restoredFingerprint;
            setDraftStatus({ kind: "restored", updatedAt: restored.updatedAt });
          } else {
            setSaved(latest);
            setScenario(defaultScenario);
            setItems(defaultItems);
            setTaxRate(defaultTaxRate);
            setValidUntil(defaultValidUntil);
            const baseline = fingerprint(defaultScenario, latest?.id ?? null, defaultTaxRate, defaultValidUntil, defaultItems);
            draftBaselineRef.current = baseline;
            lastPersistedDraftRef.current = baseline;
          }
          draftReadyRef.current = true;
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "견적 목록을 불러오지 못했습니다.");
      });
    return () => { cancelled = true; };
  }, [canRead, canWrite, draftStorageKey, fingerprint, project.id, project.workspaceId, session]);

  const currentDraftFingerprint = fingerprint(scenario, saved?.id ?? null, taxRate, validUntil, items);
  const hasUnsavedDraft = draftReadyRef.current && currentDraftFingerprint !== draftBaselineRef.current;

  useEffect(() => {
    if (!canWrite || !draftReadyRef.current || !hasUnsavedDraft || currentDraftFingerprint === lastPersistedDraftRef.current) return;
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

  const estimatedSubtotal = items.reduce((sum, item) => sum + item.quantity * item.unitRate * (1 - item.discountRate), 0);
  const canSave = canWrite && items.length > 0 && items.every((item) => item.title.trim()
    && item.quantity > 0
    && item.unitRate >= 0
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
    draftBaselineRef.current = baseline;
    lastPersistedDraftRef.current = baseline;
    clearStoredDraft();
  };

  const loadQuotation = (quotation: Quotation) => {
    if (hasUnsavedDraft && !window.confirm("현재 임시 저장된 입력을 버리고 선택한 서버 revision을 불러올까요?")) return;
    applyQuotation(quotation);
  };

  const resetQuotation = () => {
    if (hasUnsavedDraft && !window.confirm("현재 임시 저장된 입력을 버리고 새 견적 시리즈를 시작할까요?")) return;
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
    draftBaselineRef.current = baseline;
    lastPersistedDraftRef.current = baseline;
    clearStoredDraft();
  };

  const discardDraft = () => {
    if (saved) applyQuotation(saved);
    else resetQuotation();
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
      draftBaselineRef.current = baseline;
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
          setError("다른 사용자가 먼저 새 revision을 저장했습니다. 최신 견적 목록도 불러오지 못했으므로 잠시 후 다시 확인해 주세요.");
        }
      } else {
        setError(cause instanceof Error ? cause.message : "견적을 저장하지 못했습니다.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!canRead) return <div className="workspace-empty"><Receipt size={38} /><h2>견적을 열람할 권한이 없습니다.</h2><p>Workspace 관리자에게 quotation.read 권한을 요청하세요.</p></div>;

  return (
    <section className="quote-builder">
      <div className="quote-toolbar">
        <div>
          <span>수동 견적 작성</span>
          <h2>항목별 공수와 근거를 함께 기록하세요.</h2>
        </div>
        <div className="scenario-switch" role="group" aria-label="견적 시나리오">
          {(["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => <button type="button" key={value} disabled={!canWrite} className={scenario === value ? "active" : ""} onClick={() => setScenario(value)}>{value === "LEAN" ? "핵심" : value === "RECOMMENDED" ? "권장" : "확장"}</button>)}
        </div>
        {canWrite && <button type="button" className="quiet-button" onClick={resetQuotation}>새 견적 시리즈</button>}
      </div>

      {draftStatus && <div className={`quote-draft-state ${draftStatus.kind}`} role={draftStatus.kind === "unavailable" ? "alert" : "status"} aria-live="polite">
        <Clock size={19} />
        <div><strong>{draftStatus.kind === "restored" ? "이 탭의 미저장 견적을 복원했습니다." : draftStatus.kind === "saved" ? "입력 중인 견적을 이 탭에 임시 저장했습니다." : "브라우저 임시 저장을 사용할 수 없습니다."}</strong><small>{draftStatus.kind === "unavailable" ? "서버에 revision으로 저장하기 전에는 화면을 닫거나 이동하지 마세요." : `${draftStatus.updatedAt ? new Date(draftStatus.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "방금"} 저장 · 서버와 다른 브라우저에는 반영되지 않습니다.`}</small></div>
        {draftStatus.kind !== "unavailable" && <button type="button" className="quiet-button" onClick={discardDraft}>임시저장 버리기</button>}
      </div>}

      {error && <div className="inline-error" role="alert"><Warning size={18} />{error}</div>}
      {conflictLatest && <section className="quote-conflict" role="alert"><div><Warning size={21} /><div><strong>다른 사용자가 먼저 새 revision을 저장했습니다.</strong><p>현재 입력은 그대로 보존했습니다. 최신 v{conflictLatest.versionNumber}을 불러오거나, 입력한 내용을 별도 견적 시리즈로 저장할 수 있습니다.</p></div></div><div><button type="button" className="secondary-button" onClick={() => loadQuotation(conflictLatest)}>최신 revision 불러오기</button><button type="button" className="quiet-button" onClick={() => { setSaved(null); setConflictLatest(null); }}>현재 입력을 새 시리즈로 계속</button></div></section>}

      <section className="scenario-comparison" aria-label="견적 시나리오 비교">
        <header><div><span>시나리오 비교</span><strong>핵심안·권장안·확장안의 최신 revision</strong></div><small>카드를 선택하면 해당 견적을 편집 기준으로 불러옵니다.</small></header>
        <div>{(["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => {
          const quotation = latestByScenario[value];
          return <button type="button" key={value} className={saved?.id === quotation?.id ? "active" : ""} disabled={!quotation} onClick={() => quotation && loadQuotation(quotation)}><span>{value === "LEAN" ? "핵심" : value === "RECOMMENDED" ? "권장" : "확장"}</span>{quotation ? <><strong>{formatMoney(quotation.total, quotation.currency)}</strong><small>v{quotation.versionNumber} · {quotation.status}</small></> : <><strong>작성 전</strong><small>저장된 견적 없음</small></>}</button>;
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
                <select aria-label="서비스 단가표" value={item.rateCardId ?? ""} disabled={!canWrite} onChange={(event) => { const card = rateCards.find((candidate) => candidate.id === event.target.value); updateItem(index, (current) => card ? { ...current, rateCardId: card.id, unit: card.unit, unitRate: card.rate } : { ...current, rateCardId: null }); }}><option value="">직접 단가</option>{rateCards.map((card) => <option key={card.id} value={card.id}>{card.name} · {formatMoney(card.rate, card.currency)}</option>)}</select>
                <select aria-label="근거 유형" value={item.basis.type} disabled={!canWrite} onChange={(event) => updateItem(index, (current) => ({ ...current, basis: event.target.value === "ASSUMPTION" ? { type: "ASSUMPTION", content: current.basis.content, sourceType: null, sourceReference: null, sourceTitle: null, retrievedAt: null } : { ...current.basis, type: "EVIDENCE" } }))}><option value="ASSUMPTION">확인할 가정</option><option value="EVIDENCE">검증된 근거</option></select>
                <input value={item.basis.content} readOnly={!canWrite} maxLength={3000} placeholder="이 공수와 단가를 정한 근거 또는 아직 확인되지 않은 가정을 입력하세요." onChange={(event) => updateItem(index, (current) => ({ ...current, basis: { ...current.basis, content: event.target.value } }))} />
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
          <p>최종 위험 buffer·세금·합계는 저장할 때 Java 계산 도구가 다시 결정합니다.</p>
          {selectedBasis && <section className="evidence-inspector"><span>선택 항목 근거</span><strong>{selectedBasis.type === "EVIDENCE" ? selectedBasis.sourceTitle || "제목 없는 근거" : "확인할 가정"}</strong><p>{selectedBasis.content || "근거 또는 가정 내용을 입력하세요."}</p>{selectedBasis.type === "EVIDENCE" && <dl><div><dt>유형</dt><dd>{selectedBasis.sourceType ?? "미선택"}</dd></div><div><dt>참조</dt><dd>{selectedBasis.sourceReference || "미입력"}</dd></div><div><dt>조회</dt><dd>{selectedBasis.retrievedAt ? new Date(selectedBasis.retrievedAt).toLocaleString("ko-KR") : "미지정"}</dd></div></dl>}</section>}
          {canWrite ? <button type="button" className="primary-button" disabled={busy || !canSave} onClick={() => void save()}>{busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />} 검토용 초안 저장</button> : <small className="validation-hint">읽기 전용 견적입니다.</small>}
          {canWrite && !canSave && <small className="validation-hint">모든 항목에 이름, 수량, 단가와 근거 또는 가정을 입력하세요. 근거는 출처 유형과 참조가 필수입니다.</small>}
        </aside>
      </div>

      {saved && <article className="saved-quote" aria-live="polite">
        <div><span>서버 계산 완료 · {saved.status}</span><h3>{saved.scenario} v{saved.versionNumber}</h3><p>총액 {formatMoney(saved.total, saved.currency)} · 위험 buffer {Math.round(saved.riskBufferRate * 100)}% · 세금 {formatMoney(saved.taxAmount, saved.currency)}</p></div>
        <div className="saved-quote-actions">
          {saved.status === "DRAFT" && canPublish && <button type="button" className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { const published = await publishQuotation(session, saved.id); setSaved(published); setQuotations((current) => current.map((quotation) => quotation.id === published.id ? published : quotation)); } catch (cause) { setError(cause instanceof Error ? cause.message : "견적을 발행하지 못했습니다."); } finally { setBusy(false); } }}>발행하기 <ArrowRight size={17} /></button>}
          {saved.status === "PUBLISHED" && canPublish && !proposalShare && <button type="button" className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { const share = await createProposalShare(session, saved.id); const url = new URL(`/proposal/${share.token}`, window.location.origin).toString(); setProposalShare({ ...share, url }); setShareCopyState(await copyToClipboard(url) ? "copied" : "manual"); } catch (cause) { setError(cause instanceof Error ? cause.message : "공유 링크를 만들지 못했습니다."); } finally { setBusy(false); } }}>고객 링크 만들기 <ArrowRight size={17} /></button>}
        </div>
      </article>}
      {proposalShare && <div className="share-link" role="status"><div><span>{shareCopyState === "copied" ? "고객 제안서 링크를 만들고 복사했습니다." : "고객 제안서 링크를 만들었습니다."}</span><small>{shareCopyState === "manual" ? "자동 복사가 차단되었습니다. 아래 링크를 직접 복사하세요." : `${new Date(proposalShare.expiresAt).toLocaleDateString("ko-KR")}까지 유효`}</small></div><a href={proposalShare.url} target="_blank" rel="noopener noreferrer">{proposalShare.url}</a><div className="share-link-actions"><button type="button" className="quiet-button" disabled={busy} onClick={async () => setShareCopyState(await copyToClipboard(proposalShare.url) ? "copied" : "manual")}><Copy size={17} /> 링크 복사</button><button type="button" className="quiet-button danger" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await revokeProposalShare(session, proposalShare.shareId); setProposalShare(null); setShareCopyState(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "공유 링크를 비활성화하지 못했습니다."); } finally { setBusy(false); } }}><Archive size={17} /> 링크 비활성화</button></div></div>}

      {quotations.length > 0 && <div className="quote-history"><span>견적 이력</span>{quotations.map((quotation) => <button type="button" key={quotation.id} onClick={() => loadQuotation(quotation)}><strong>{quotation.scenario} v{quotation.versionNumber}</strong><small>{quotation.status}</small><span>{formatMoney(quotation.total, quotation.currency)}</span></button>)}</div>}
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

  if (!canRead) return <div className="workspace-empty"><Graph size={38} /><h2>결과를 열람할 권한이 없습니다.</h2><p>Workspace 관리자에게 outcome.read 권한을 요청하세요.</p></div>;
  if (loading) return <div className="section-loading"><CircleNotch className="spin" /> 결과 기록을 확인하고 있습니다.</div>;
  const approvedQuotation = outcome?.approvedQuotationId ? quotations.find((quotation) => quotation.id === outcome.approvedQuotationId) ?? null : null;
  const quotedHours = approvedQuotation?.items.filter((item) => item.unit === "HOUR").reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const revenueVariance = outcome && approvedQuotation ? outcome.totalRevenue - approvedQuotation.total : null;
  const hoursVariance = outcome && quotedHours > 0 ? outcome.actualHours - quotedHours : null;

  return (
    <section className="outcome-review">
      <div className="guided-copy"><span>Outcome Review</span><h2>끝난 프로젝트를 다음 견적의 근거로 남기세요.</h2><p>실제 공수와 비용은 AI가 추정하지 않습니다. 사용자가 확정한 기록만 이후 사례로 활용할 수 있습니다.</p></div>
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
        <div className="form-row"><label>기준 견적<select name="approvedQuotationId" disabled={!canWrite} defaultValue={outcome?.approvedQuotationId ?? ""}><option value="">연결하지 않음</option>{quotations.filter((quotation) => quotation.status === "PUBLISHED").map((quotation) => <option key={quotation.id} value={quotation.id}>{quotation.scenario} v{quotation.versionNumber} · {formatMoney(quotation.total, quotation.currency)}</option>)}</select></label><label>최종 계약 금액<input name="totalRevenue" type="number" min="0" required readOnly={!canWrite} defaultValue={outcome?.totalRevenue ?? ""} /></label><label>실제 비용<input name="actualCost" type="number" min="0" required readOnly={!canWrite} defaultValue={outcome?.actualCost ?? ""} /></label><label>실제 공수(시간)<input name="actualHours" type="number" min="0" step="0.5" required readOnly={!canWrite} defaultValue={outcome?.actualHours ?? ""} /></label><label>완료일<input name="completedOn" type="date" readOnly={!canWrite} defaultValue={outcome?.completedOn ?? ""} /></label></div>
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

function InterruptionForm({ interruption, busy, canRespond, onSubmit }: { interruption: NonNullable<AgentRunView["interruption"]>; busy: boolean; canRespond: boolean; onSubmit: (answers: string[]) => Promise<void> }) {
  const [answers, setAnswers] = useState(() => interruption.questions.map(() => ""));
  return (
    <form className="interruption-form" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); if (busy) return; void onSubmit(answers); }}>
      <span>사용자 확인 필요</span>
      <h3>다음 내용을 확인해 주세요.</h3>
      {interruption.questions.map((question, index) => <label key={question}>{question}<textarea required readOnly={!canRespond} value={answers[index]} onChange={(event) => setAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? event.target.value : answer))} /></label>)}
      {canRespond ? <button type="submit" className="primary-button" disabled={busy || answers.some((answer) => !answer.trim())}>{busy ? <CircleNotch className="spin" /> : <ArrowRight />} 답변하고 계속</button> : <p className="permission-note">이 실행에 답변할 권한이 없습니다.</p>}
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
        <p>변경한 원문과 조건은 다음 Agent 실행과 견적 작성에 사용됩니다. 이미 발행한 견적 revision은 변경되지 않습니다.</p>
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
            currency: "KRW",
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
            <div className="form-row"><label>희망 완료일<input name="deadline" type="date" /></label><label>최소 예산<input name="budgetMin" type="number" min="0" step="10000" /></label><label>최대 예산<input name="budgetMax" type="number" min="0" step="10000" /></label></div>
            <button className="primary-button" type="submit">{busy ? <CircleNotch className="spin" /> : <ArrowRight size={18} />} {busy ? "프로젝트를 만들고 있습니다." : "프로젝트 만들기"}</button>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
