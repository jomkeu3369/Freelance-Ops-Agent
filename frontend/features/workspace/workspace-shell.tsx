"use client";

import { useT } from "../../app/lib/ui-language";
import { ReactNode, useSyncExternalStore, useState, useRef, useMemo, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WorkspaceContext, WorkspaceScreens } from "./workspace-context";
import { PipelinePreferences } from "./projects/pipeline-preferences";
import { useTheme } from "next-themes";
import {
  AuthSession,
  ApiError,
  isFreeUsageExhausted,
  subscribeToFreeUsageExhausted,
  Project,
  Client,
  MeProfile,
  AgentRunView,
  WorkflowEvent,
  getLatestProjectAgentRun,
  getMe,
  listProjects,
  listClients,
  loadSession,
  refreshAuthSession,
  saveSession,
  clearSession,
  subscribeToSessionRecovery,
  streamRunEvents,
  getAgentRun,
  revokeAuthSession,
  Provider,
  startAgentRun,
  deleteProject,
  cancelAgentRun,
  resumeAgentRun,
  createProject
} from "../../app/lib/api";
import { FreeUsageDialog } from "./usage/free-usage-dialog";
import { freeUsageReturnPath } from "../../app/lib/free-usage.mjs";
import "./usage/free-usage.css";
import { StreamState, WorkspaceView, WorkbenchStep } from "./shared/types";
import { parseWorkspacePath, buildWorkspacePath } from "../../app/lib/workspace-navigation.mjs";
import { sessionRefreshDelay } from "../../app/lib/session-timing.mjs";
import { isActiveStreamStatus, streamReconnectDelay, nextStreamCursor } from "../../app/lib/stream-retry.mjs";
import { terminalStatuses } from "./shared/constants";
import { snapshotFromEvents } from "../../app/components/live-workflow";
import { CircleNotch, Warning } from "@phosphor-icons/react";
import { AuthGate } from "./auth/auth-gate";
import { WorkspaceChrome } from "./workspace-chrome";
import { ProjectDialog } from "./project/dialogs/project-dialog";
import { createProjectIntakeDraft, projectIntakeDraftScope } from "@/app/lib/project-intake-draft.mjs";
import "../../app/workspace/figma-workspace.css";
import "../../app/workspace/quick-intake.css";
import "./project/analysis/agent-chat.css";
import "./professional-workspace.css";

export const subscribeToThemeHydration = () => () => undefined;

interface WorkspaceShellProps {
  children: ReactNode;
}

export function WorkspaceShell({ children }: WorkspaceShellProps) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [pipelinePreferences, setPipelinePreferences] = useState<PipelinePreferences>({
    search: "",
    activeColumn: "all",
    preferredView: null,
    sort: "updated"
  });
  const themeMounted = useSyncExternalStore(
    subscribeToThemeHydration,
    () => true,
    () => false
  );
  const { resolvedTheme, setTheme } = useTheme();
  const isDarkTheme = themeMounted && resolvedTheme === "dark";
  const [session, setSession] = useState<AuthSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
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
  const runOperation = useRef(0);
  const pendingStart = useRef<{ signature: string; key: string } | null>(null);
  const [quotaError, setQuotaError] = useState<ApiError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  // Drafts stay in this layout across dialog unmounts and route changes, scoped to their owner.
  const [intakeDrafts, setIntakeDrafts] = useState<Record<string, ReturnType<typeof createProjectIntakeDraft>>>({});
  const [executionRevision, setExecutionRevision] = useState(0);
  const [activeView, setActiveView] = useState<WorkspaceView>("pipeline");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [projectStep, setProjectStep] = useState<WorkbenchStep>("intake");
  const workspaceContent = useRef<HTMLElement>(null);
  const pipelineReturn = useRef<{ element: HTMLElement | null; scrollY: number; projectId?: string }>({
    element: null,
    scrollY: 0
  });
  const previousView = useRef<WorkspaceView>("pipeline");
  const runStatus = run?.status;
  const activePermissions = useMemo(
    () =>
      new Set(
        profile?.workspaces.find((workspace) => workspace.workspaceId === session?.workspaceId)
          ?.effectivePermissions ?? []
      ),
    [profile, session?.workspaceId]
  );
  const canWriteProject = activePermissions.has("project.write");

  useEffect(() => {
    if (!session) return;
    return subscribeToFreeUsageExhausted(setQuotaError);
  }, [session]);


  const restorePipelinePosition = useCallback(() => {
    const { projectId, scrollY } = pipelineReturn.current;
    if (!projectId) return;
    const card = document.querySelector<HTMLElement>(`[data-project-id="${CSS.escape(projectId)}"] button`);
    card?.focus({ preventScroll: true });
    window.scrollTo({ top: scrollY, behavior: "instant" });
  }, []);

  useEffect(() => {
    if (previousView.current === activeView) return;
    previousView.current = activeView;
    const frame = requestAnimationFrame(() => {
      const returnTarget = pipelineReturn.current;
      if (activeView === "pipeline" && returnTarget.projectId) {
        restorePipelinePosition();
      } else {
        workspaceContent.current?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeView, restorePipelinePosition]);

  useEffect(() => {
    if (!session || !selectedProject || activeView !== "project" || !activePermissions.has("agent.run"))
      return;
    let cancelled = false;
    const projectId = selectedProject.id;
    const operation = runOperation.current;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        return getLatestProjectAgentRun(session, projectId);
      })
      .then((latestRun) => {
        if (cancelled || operation !== runOperation.current || latestRun === undefined || selectedProjectIdRef.current !== projectId) return;
        setRun(latestRun);
        setRunId(latestRun?.runId ?? null);
        setEvents([]);
        setStreamState("idle");
        setStreamRetryCount(0);
      })
      .catch((cause) => {
        if (!cancelled && operation === runOperation.current)
          setError(cause instanceof Error ? cause.message : "최근 AI 분석 상태를 확인하지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [activePermissions, activeView, selectedProject, session]);

  const applyWorkspaceLocation = useCallback(
    (projectResult: Project[], permissions: Set<string>, replaceInvalid = false) => {
      // A delayed restore must not redirect after the user has left the workspace.
      const currentPath = window.location.pathname;
      if (currentPath !== "/workspace" && !currentPath.startsWith("/workspace/")) return;
      const location = parseWorkspacePath(window.location.pathname, window.location.search);
      const viewAllowed = location.view !== "clients" || permissions.has("client.read");
      const knowledgeAllowed = location.view !== "knowledge" || permissions.has("document.read");
      const project =
        location.view === "project"
          ? (projectResult.find((item) => item.id === location.projectId) ?? null)
          : null;

      if (!viewAllowed || !knowledgeAllowed || (location.view === "project" && !project)) {
        setActiveView("pipeline");
        setProjectStep("intake");
        setSelectedProject((current) => current ?? projectResult[0] ?? null);
        if (replaceInvalid) router.replace("/workspace/projects", { scroll: false });
        return;
      }

      if (replaceInvalid && window.location.pathname !== buildWorkspacePath(location)) {
        router.replace(buildWorkspacePath(location), { scroll: false });
      }
      setActiveView(location.view as WorkspaceView);
      if (project) {
        if (selectedProjectIdRef.current !== project.id) {
          runOperation.current += 1;
          setBusy(false);
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
    },
    [router]
  );

  const navigateWorkspace = useCallback(
    (view: WorkspaceView, project?: Project | null, step: WorkbenchStep = "intake", replace = false) => {
      const nextProject = view === "project" ? (project ?? selectedProject) : null;
      const nextView = view === "project" && !nextProject ? "pipeline" : view;
      const projectChanged = nextView === "project" && nextProject?.id !== selectedProject?.id;
      const path = buildWorkspacePath({ view: nextView, projectId: nextProject?.id, step });
      router[replace ? "replace" : "push"](path, { scroll: false });
      setActiveView(nextView);
      setProjectStep(nextView === "project" ? step : "intake");
      if (nextProject) {
        selectedProjectIdRef.current = nextProject.id;
        setSelectedProject(nextProject);
      }
      if (projectChanged) {
        runOperation.current += 1;
        setBusy(false);
        setRun(null);
        setRunId(null);
        setEvents([]);
        setStreamState("idle");
        setStreamRetryCount(0);
      }
    },
    [router, selectedProject]
  );

  const refreshProjects = useCallback(
    async (activeSession: AuthSession) => {
      const profileResult = await getMe(activeSession);
      const workspace = profileResult.workspaces.find(
        (item) => item.workspaceId === activeSession.workspaceId
      );
      const permissions = new Set(workspace?.effectivePermissions ?? []);
      const [projectResult, clientResult] = await Promise.all([
        permissions.has("project.read") ? listProjects(activeSession) : Promise.resolve([]),
        permissions.has("client.read") ? listClients(activeSession) : Promise.resolve([])
      ]);
      setLoadedWorkspaceId(activeSession.workspaceId);
      setProjects(projectResult);
      setClients(clientResult.filter((client) => client.status === "ACTIVE"));
      setProfile(profileResult);
      applyWorkspaceLocation(projectResult, permissions, true);
    },
    [applyWorkspaceLocation]
  );

  useEffect(() => {
    Promise.resolve().then(() => {
      const stored = loadSession();
      if (stored) {
        const restore = async () => {
          try {
            const activeSession =
              new Date(stored.accessTokenExpiresAt).getTime() <= Date.now() + 30_000
                ? { ...(await refreshAuthSession(stored)), workspaceId: stored.workspaceId }
                : stored;
            if (activeSession !== stored) saveSession(activeSession);
            setSession(activeSession);
            await refreshProjects(activeSession);
          } catch (cause) {
            clearSession();
            setSession(null);
            setLoadedWorkspaceId(null);
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

  useEffect(
    () =>
      subscribeToSessionRecovery((recoveredSession) => {
        if (recoveredSession) {
          setSession(recoveredSession);
          return;
        }
        runOperation.current += 1;
        setBusy(false);
        setSession(null);
        setIntakeDrafts({});
        setShowNewProject(false);
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
      }),
    []
  );

  useEffect(() => {
    if (!session) return;
    if (loadedWorkspaceId !== session.workspaceId) return;
    Promise.resolve().then(() => applyWorkspaceLocation(projects, activePermissions, true));
  }, [pathname, loadedWorkspaceId, activePermissions, applyWorkspaceLocation, projects, session]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      refreshAuthSession(session)
        .then((nextSession) => {
          const preservedSession = { ...nextSession, workspaceId: session.workspaceId };
          saveSession(preservedSession);
          setSession(preservedSession);
        })
        .catch(() => {
          clearSession();
          runOperation.current += 1;
          setBusy(false);
          setSession(null);
          setError("로그인 시간이 만료되었습니다. 다시 로그인해 주세요.");
        });
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
            setEvents((current) =>
              current.some((item) => item.eventId === event.eventId) ? current : [...current, event]
            );
          },
          controller.signal,
          lastEventIdRef.current || undefined,
          () => {
            if (cancelled || controller.signal.aborted) return;
            attempt = 0;
            setStreamState("connected");
            setStreamRetryCount(0);
          }
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
    let pollingError: string | null = null;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const view = await getAgentRun(session, runId);
        if (!cancelled) {
          setRun((current) => current?.runId === view.runId && terminalStatuses.has(current.status) && !terminalStatuses.has(view.status) ? current : view);
          if (pollingError) {
            const recoveredError = pollingError;
            setError((current) => current === recoveredError ? null : current);
            pollingError = null;
          }
        }
        return terminalStatuses.has(view.status);
      } catch (cause) {
        if (!cancelled) {
          pollingError = cause instanceof Error ? cause.message : "실행 상태를 확인하지 못했습니다.";
          setError(pollingError);
        }
        // Keep reading after a temporary network error; never retry a denied or missing run.
        return cause instanceof ApiError && [401, 403, 404].includes(cause.status);
      }
    };
    const check = async () => {
      const finished = await poll();
      if (!cancelled && !finished) timer = window.setTimeout(() => void check(), 2000);
    };
    void check();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [executionRevision, runId, session]);

  const onAuthenticated = async (nextSession: AuthSession, isNewWorkspace = false) => {
    setError(null);
    try {
      await refreshProjects(nextSession);
      saveSession(nextSession);
      setSession(nextSession);
      if (isNewWorkspace) navigateWorkspace("settings", null, "intake", true);
    } catch (cause) {
      clearSession();
      runOperation.current += 1;
      setBusy(false);
      setSession(null);
      setLoadedWorkspaceId(null);
      throw cause;
    }
  };

  const logout = async () => {
    if (!session) return;
    try {
      await revokeAuthSession(session);
    } finally {
      clearSession();
      runOperation.current += 1;
      setBusy(false);
      setSession(null);
      pendingStart.current = null;
      setQuotaError(null);
      setIntakeDrafts({});
      setShowNewProject(false);
      setLoadedWorkspaceId(null);
      setPipelinePreferences({ search: "", activeColumn: "all", preferredView: null, sort: "updated" });
      setProjects([]);
      setClients([]);
      setProfile(null);
      setSelectedProject(null);
      setRun(null);
      setRunId(null);
      setEvents([]);
    }
  };

  const beginRun = async (provider: Provider, model: string, credentialId?: string, message?: string): Promise<boolean> => {
    if (!session || !selectedProject) return false;
    const operation = ++runOperation.current;
    const projectId = selectedProject.id;
    const signature = JSON.stringify([session.userId, session.workspaceId, projectId, provider, model, credentialId ?? null, message ?? selectedProject.requirementText]);
    if (pendingStart.current?.signature !== signature) pendingStart.current = { signature, key: crypto.randomUUID() };
    const idempotencyKey = pendingStart.current.key;
    setBusy(true);
    setError(null);
    try {
      const accepted = await startAgentRun(session, selectedProject, {
        credentialId,
        provider,
        model,
        reasoningEffort: "LOW"
      }, message, idempotencyKey);
      if (pendingStart.current?.key === idempotencyKey) pendingStart.current = null;
      if (operation !== runOperation.current || selectedProjectIdRef.current !== projectId) return true;
      setEvents([]);
      setRun(null);
      setRunId(accepted.runId);
      return true;
    } catch (cause) {
      // An ambiguous network/server failure may have created the run; an explicit retry reuses its key.
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && pendingStart.current?.key === idempotencyKey) pendingStart.current = null;
      if (operation === runOperation.current && !isFreeUsageExhausted(cause)) setError(cause instanceof Error ? cause.message : "Agent 실행을 시작하지 못했습니다.");
      return false;
    } finally {
      if (operation === runOperation.current) setBusy(false);
    }
  };

  const resetRun = () => {
    runOperation.current += 1;
    setBusy(false);
    setRun(null);
    setRunId(null);
    setEvents([]);
    setStreamState("idle");
    setStreamRetryCount(0);
  };



  const snapshot = useMemo(
    () => snapshotFromEvents(events, run?.status ?? (runId ? "RUNNING" : "IDLE")),
    [events, run?.status, runId]
  );
  if (!hydrated) {
    return (
      <main id="main-content" className="workspace-loading" aria-busy="true">
        <CircleNotch size={30} className="spin" />
        <span>{t("업무 공간을 준비하고 있습니다.")}</span>
      </main>
    );
  }

  if (!session) return <AuthGate onAuthenticated={onAuthenticated} error={t(error)} setError={setError} />;

  const handleSwitchWorkspace = async (workspaceId: string) => {
    runOperation.current += 1;
    setBusy(false);
    const nextSession = { ...session, workspaceId: workspaceId };
    setPipelinePreferences({
      search: "",
      activeColumn: "all",
      preferredView: null,
      sort: "updated"
    });
    pipelineReturn.current = { element: null, scrollY: 0 };
    setLoadedWorkspaceId(null);
    setShowNewProject(false);
    setQuotaError(null);
    saveSession(nextSession);
    setSession(nextSession);
    setSelectedProject(null);
    setRun(null);
    setRunId(null);
    setEvents([]);
    setError(null);
    navigateWorkspace("pipeline", null, "intake", true);
    try {
      await refreshProjects(nextSession);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "작업 공간을 전환하지 못했습니다.");
    }
  };

  const handleCreateProject = async (input: Parameters<typeof createProject>[1]) => {
    setError(null);
    const project = await createProject(session, input);
    setIntakeDrafts((current) => ({ ...current, [projectIntakeDraftScope(session)]: createProjectIntakeDraft() }));
    setProjects((current) => [project, ...current]);
    setSelectedProject(project);
    navigateWorkspace("project", project);
    setShowNewProject(false);
  };

  // 개별 페이지는 화면만 조합하고, 데이터 변경과 실행 연결은 이 레이아웃에서 유지합니다.
  const screens: WorkspaceScreens = {
    restorePipelinePosition,
    projects: {
      session,
      projects,
      clients,
      displayName: profile?.displayName ?? "사용자",
      canWrite: canWriteProject,
      preferences: pipelinePreferences,
      onPreferencesChange: setPipelinePreferences,
      onCreate: () => setShowNewProject(true),
      onSelect: (project) => {
        pipelineReturn.current = {
          element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
          scrollY: window.scrollY,
          projectId: project.id
        };
        navigateWorkspace("project", project);
      },
      onProjectUpdated: (project) => {
        setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
        setSelectedProject((current) => (current?.id === project.id ? project : current));
      }
    },
    clients: {
      session,
      clients,
      projects,
      permissions: activePermissions,
      onCreated: (client) => setClients((current) => [client, ...current]),
      onUpdated: (client) =>
        setClients((current) => current.map((item) => (item.id === client.id ? client : item))),
      onArchived: (clientId) => setClients((current) => current.filter((item) => item.id !== clientId))
    },
    knowledge: { session, permissions: activePermissions },
    settings: {
      session,
      permissions: activePermissions,
      projectCount: projects.length,
      canCreateProject: canWriteProject,
      onCreateProject: () => setShowNewProject(true),
      onOpenPipeline: () => navigateWorkspace("pipeline")
    },
    empty: { canCreate: canWriteProject, onCreate: () => setShowNewProject(true) },
    project: selectedProject
      ? {
          session,
          project: selectedProject,
          clients,
          run,
          runId,
          events,
          busy,
          streamState,
          snapshot,
          permissions: activePermissions,
          initialStep: projectStep,
          onStepChange: (step) => navigateWorkspace("project", selectedProject, step),
          onProjectUpdated: (project) => {
            setProjects((current) => current.map((item) => (item.id === project.id ? project : item)));
            setSelectedProject(project);
            resetRun();
          },
          onDelete: async () => {
            await deleteProject(session, selectedProject.id);
            setProjects((current) => current.filter((project) => project.id !== selectedProject.id));
            selectedProjectIdRef.current = null;
            setSelectedProject(null);
            resetRun();
            navigateWorkspace("pipeline", null, "intake", true);
          },
          onRun: beginRun,
          onResetRun: resetRun,
          onCancel: async () => {
            if (!runId) return;
            const operation = ++runOperation.current;
            setBusy(true);
            setError(null);
            try {
              const cancelledRun = await cancelAgentRun(session, runId);
              if (operation !== runOperation.current) return;
              setRun(cancelledRun);
              setExecutionRevision((current) => current + 1);
            } catch (cause) {
              if (operation === runOperation.current) setError(cause instanceof Error ? cause.message : "실행을 중단하지 못했습니다.");
            } finally {
              if (operation === runOperation.current) setBusy(false);
            }
          },
          onResume: async (answers) => {
            if (!run?.interruption || !runId) return;
            const operation = ++runOperation.current;
            setBusy(true);
            setError(null);
            try {
              await resumeAgentRun(session, runId, run.interruption.interruptionId, answers);
              if (operation !== runOperation.current) return;
              setRun((current) =>
                current ? { ...current, status: "RUNNING", interruption: null } : current
              );
              setExecutionRevision((current) => current + 1);
            } catch (cause) {
              if (operation === runOperation.current) setError(cause instanceof Error ? cause.message : "답변을 전달하지 못했습니다.");
              throw cause;
            } finally {
              if (operation === runOperation.current) setBusy(false);
            }
          }
        }
      : null
  };

  return (
    <div
      className={`workspace-shell figma-workspace${sidebarCollapsed ? " sidebar-collapsed" : ""}${activeView === "project" && projectStep === "agent" ? " conversation-workspace" : ""}`}
    >
      <WorkspaceChrome
        session={session}
        profile={profile}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        isDarkTheme={isDarkTheme}
        setTheme={setTheme}
        activeView={activeView}
        streamState={streamState}
        streamRetryCount={streamRetryCount}
        runId={runId}
        run={run}
        activePermissions={activePermissions}
        projects={projects}
        selectedProjectId={selectedProject?.id ?? null}
        onSelectProject={(project) => navigateWorkspace("project", project, "agent")}
        onCreateProject={() => setShowNewProject(true)}
        navigateWorkspace={navigateWorkspace}
        logout={logout}
        onSwitchWorkspace={handleSwitchWorkspace}
      />

      <main id="main-content" ref={workspaceContent} className="workspace-main" tabIndex={-1} aria-label={t("업무 내용")}>
        {error && (
          <div className="error-banner" role="alert">
            <Warning size={19} />
            <span>{t(error)}</span>
            <button type="button" onClick={() => setError(null)}>
              {t("닫기")}</button>
          </div>
        )}
        <WorkspaceContext.Provider value={screens}>
          {loadedWorkspaceId === session.workspaceId ? children : (
            <div className="workspace-loading" role="status" aria-busy="true">
              <CircleNotch size={30} className="spin" /> {t("업무 공간을 불러오고 있습니다.")}</div>
          )}
        </WorkspaceContext.Provider>
      </main>

      {quotaError && <FreeUsageDialog error={quotaError} onClose={() => setQuotaError(null)} onRegister={() => {
        const returnTo = freeUsageReturnPath(window.location.pathname);
        setQuotaError(null);
        router.push(`/workspace/settings${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}#ai-connections`);
      }} />}

      {showNewProject && canWriteProject && (
        <ProjectDialog
          clients={clients}
          draft={intakeDrafts[projectIntakeDraftScope(session)] ?? createProjectIntakeDraft()}
          onDraftChange={(draft) => setIntakeDrafts((current) => ({ ...current, [projectIntakeDraftScope(session)]: draft }))}
          onDiscard={() => setIntakeDrafts((current) => ({ ...current, [projectIntakeDraftScope(session)]: createProjectIntakeDraft() }))}
          onClose={() => setShowNewProject(false)}
          onCreate={handleCreateProject}
        />
      )}
    </div>
  );
}
