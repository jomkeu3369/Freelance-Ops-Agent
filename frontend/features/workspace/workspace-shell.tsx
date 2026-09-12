"use client";

import { ReactNode, useSyncExternalStore, useState, useRef, useMemo, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WorkspaceContext, WorkspaceScreens } from "./workspace-context";
import { PipelinePreferences } from "./projects/pipeline-preferences";
import { useTheme } from "next-themes";
import {
  AuthSession,
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
import "../../app/workspace/figma-workspace.css";
import "../../app/workspace/quick-intake.css";

export const subscribeToThemeHydration = () => () => undefined;

interface WorkspaceShellProps {
  children: ReactNode;
}

export function WorkspaceShell({ children }: WorkspaceShellProps) {
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
  const [error, setError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
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
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        return getLatestProjectAgentRun(session, projectId);
      })
      .then((latestRun) => {
        if (cancelled || latestRun === undefined || selectedProjectIdRef.current !== projectId) return;
        setRun(latestRun);
        setRunId(latestRun?.runId ?? null);
        setEvents([]);
        setStreamState("idle");
        setStreamRetryCount(0);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "최근 AI 분석 상태를 확인하지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [activePermissions, activeView, selectedProject, session]);

  const applyWorkspaceLocation = useCallback(
    (projectResult: Project[], permissions: Set<string>, replaceInvalid = false) => {
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

  const beginRun = async (provider: Provider, model: string, credentialId?: string) => {
    if (!session || !selectedProject) return;
    setBusy(true);
    setError(null);
    setEvents([]);
    setRun(null);
    try {
      const accepted = await startAgentRun(session, selectedProject, {
        credentialId,
        provider,
        model,
        reasoningEffort: "LOW"
      });
      setRunId(accepted.runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent 실행을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const resetRun = () => {
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
        <span>업무 공간을 준비하고 있습니다.</span>
      </main>
    );
  }

  if (!session) return <AuthGate onAuthenticated={onAuthenticated} error={error} setError={setError} />;

  const handleSwitchWorkspace = async (workspaceId: string) => {
    const nextSession = { ...session, workspaceId: workspaceId };
    setPipelinePreferences({
      search: "",
      activeColumn: "all",
      preferredView: null,
      sort: "updated"
    });
    pipelineReturn.current = { element: null, scrollY: 0 };
    setLoadedWorkspaceId(null);
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
            setBusy(true);
            setError(null);
            try {
              setRun(await cancelAgentRun(session, runId));
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "실행을 중단하지 못했습니다.");
            } finally {
              setBusy(false);
            }
          },
          onResume: async (answers) => {
            if (!run?.interruption || !runId) return;
            setBusy(true);
            try {
              await resumeAgentRun(session, runId, run.interruption.interruptionId, answers);
              setRun((current) =>
                current ? { ...current, status: "RUNNING", interruption: null } : current
              );
              setExecutionRevision((current) => current + 1);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "답변을 전달하지 못했습니다.");
              throw cause;
            } finally {
              setBusy(false);
            }
          }
        }
      : null
  };

  return (
    <main
      id="main-content"
      className={`workspace-shell figma-workspace${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
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
        navigateWorkspace={navigateWorkspace}
        logout={logout}
        onSwitchWorkspace={handleSwitchWorkspace}
      />

      <section ref={workspaceContent} className="workspace-main" tabIndex={-1} aria-label="업무 내용">
        {error && (
          <div className="error-banner" role="alert">
            <Warning size={19} />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              닫기
            </button>
          </div>
        )}
        <WorkspaceContext.Provider value={screens}>{children}</WorkspaceContext.Provider>
      </section>

      {showNewProject && canWriteProject && (
        <ProjectDialog
          clients={clients}
          onClose={() => setShowNewProject(false)}
          onCreate={handleCreateProject}
        />
      )}
    </main>
  );
}
