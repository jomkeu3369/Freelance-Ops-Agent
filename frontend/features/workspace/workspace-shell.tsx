"use client";
import { byokFailureMessage } from "../../app/lib/byok-presentation.mjs";
import type { SkillSelection } from "./skills/skill-selection";

import { useT } from "../../app/lib/ui-language";
import { ReactNode, useSyncExternalStore, useState, useRef, useMemo, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { WorkspaceContext, WorkspaceScreens } from "./workspace-context";
import { reconcileProject } from "./projects/reconcile-project";
import { PipelinePreferences } from "./projects/pipeline-preferences";
import { useTheme } from "next-themes";
import {
  AuthSession,
  CreditQuote,
  isCreditQuoteRefreshRequired,
  isPlatformSpendUnavailable,
  ApiError,
  isFreeUsageExhausted,
  subscribeToFreeUsageExhausted,
  Project,
  readProject,
  updateProjectDetails,
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
  currentSessionGeneration,
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
import { PendingRunStore, PendingRunRetry } from "../../app/lib/pending-run-store";
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
import "./fullscreen-chat.css";
import "./pets/workspace-companion.css";

const compactNavigationQuery = "(max-width: 820px)";
function subscribeToCompactNavigation(onChange: () => void) {
  const query = window.matchMedia(compactNavigationQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

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
  const projectList = useRef<Project[]>([]);
  const projectListIncarnation = useRef(0);
  const projectMutationRevision = useRef(0);
  const projectNavigation = useRef({ path: "", revision: 0 });
  const pendingWorkspacePath = useRef<string | null>(null);
  const deletedProjectView = useRef<{ projectId: string; revision: number } | null>(null);
  const [unavailableProjectId, setUnavailableProjectId] = useState<string | null>(null);
  const setProjectList = useCallback((value: Project[] | ((current: Project[]) => Project[])) => {
    const next = typeof value === "function" ? value(projectList.current) : value;
    projectList.current = next;
    setProjects(next);
  }, []);
  const trackProjectNavigation = useCallback((path: string, force = false) => {
    if (force || projectNavigation.current.path !== path) {
      projectNavigation.current = { path, revision: projectNavigation.current.revision + 1 };
      deletedProjectView.current = null;
      setUnavailableProjectId(null);
    }
  }, []);
  useEffect(() => {
    const onPopState = () => { pendingWorkspacePath.current = null; trackProjectNavigation(window.location.pathname, true); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [trackProjectNavigation]);
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
  const workspaceLoadOperation = useRef(0);
  const pendingStart = useRef(new PendingRunStore());
  const [pendingRetries, setPendingRetries] = useState<PendingRunRetry[]>([]);
  const [quotaError, setQuotaError] = useState<ApiError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  // Drafts stay in this layout across dialog unmounts and route changes, scoped to their owner.
  const [intakeDrafts, setIntakeDrafts] = useState<Record<string, ReturnType<typeof createProjectIntakeDraft>>>({});
  const [executionRevision, setExecutionRevision] = useState(0);
  const [activeView, setActiveView] = useState<WorkspaceView>("pipeline");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const compactNavigation = useSyncExternalStore(subscribeToCompactNavigation, () => window.matchMedia(compactNavigationQuery).matches, () => false);
  const [projectStep, setProjectStep] = useState<WorkbenchStep>("intake");
  const workspaceContent = useRef<HTMLElement>(null);
  const pipelineReturn = useRef<{ element: HTMLElement | null; scrollY: number; projectId?: string }>({
    element: null,
    scrollY: 0
  });
  const previousView = useRef<WorkspaceView>("pipeline");
  const runStatus = run?.status;
  const selectedProjectId = selectedProject?.id;
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
    if (!session || !selectedProjectId || activeView !== "project" || !activePermissions.has("agent.run"))
      return;
    let cancelled = false;
    const projectId = selectedProjectId;
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
  }, [activePermissions, activeView, selectedProjectId, session]);

  const applyWorkspaceLocation = useCallback(
    (projectResult: Project[], permissions: Set<string>, replaceInvalid = false) => {
      // A delayed restore must not redirect after the user has left the workspace.
      const currentPath = window.location.pathname;
      if (currentPath !== "/workspace" && !currentPath.startsWith("/workspace/")) return;
      // A list update must not restore the old URL while Next is committing a
      // newer requested route. Back/Forward explicitly cancels this pending path.
      if (pendingWorkspacePath.current) {
        if (pendingWorkspacePath.current !== currentPath) return;
        pendingWorkspacePath.current = null;
        projectNavigation.current.path = currentPath;
      } else trackProjectNavigation(currentPath);
      const location = parseWorkspacePath(window.location.pathname, window.location.search);
      const viewAllowed = location.view !== "clients" || permissions.has("client.read");
      const knowledgeAllowed = location.view !== "knowledge" || permissions.has("document.read");
      const project =
        location.view === "project"
          ? (projectResult.find((item) => item.id === location.projectId) ?? null)
          : null;

      // A confirmed late deletion can make the newer view unavailable. Keep that
      // view in place until the user navigates, without redirecting or clearing its run.
      if (location.view === "project" && !project
        && deletedProjectView.current?.projectId === location.projectId
        && deletedProjectView.current?.revision === projectNavigation.current.revision) {
        setActiveView("project");
        setProjectStep(location.step as WorkbenchStep);
        return;
      }
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
    [router, trackProjectNavigation]
  );

  const navigateWorkspace = useCallback(
    (view: WorkspaceView, project?: Project | null, step: WorkbenchStep = "intake", replace = false) => {
      setMobileMenuOpen(false);
      const nextProject = view === "project" ? (project ?? selectedProject) : null;
      const nextView = view === "project" && !nextProject ? "pipeline" : view;
      const projectChanged = nextView === "project" && nextProject?.id !== selectedProject?.id;
      const path = buildWorkspacePath({ view: nextView, projectId: nextProject?.id, step });
      pendingWorkspacePath.current = path === window.location.pathname ? null : path;
      trackProjectNavigation(window.location.pathname, true);
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
    [router, selectedProject, trackProjectNavigation]
  );

  const refreshProjects = useCallback(
    async (activeSession: AuthSession) => {
      const operation = ++workspaceLoadOperation.current;
      const generation = currentSessionGeneration();
      const isCurrent = () => operation === workspaceLoadOperation.current
        && generation === currentSessionGeneration()
        && loadSession()?.userId === activeSession.userId
        && loadSession()?.workspaceId === activeSession.workspaceId;
      const assertCurrent = () => {
        if (!isCurrent()) throw new ApiError("로그인 세션이 변경되었습니다. 다시 시도해 주세요.", 409, "SESSION_CHANGED");
      };
      assertCurrent();
      const profileResult = await getMe(activeSession);
      assertCurrent();
      const workspace = profileResult.workspaces.find(
        (item) => item.workspaceId === activeSession.workspaceId
      );
      const permissions = new Set(workspace?.effectivePermissions ?? []);
      let revision = projectMutationRevision.current;
      const [initialProjects, clientResult] = await Promise.all([
        permissions.has("project.read") ? listProjects(activeSession) : Promise.resolve([]),
        permissions.has("client.read") ? listClients(activeSession) : Promise.resolve([])
      ]);
      assertCurrent();
      let projectResult = initialProjects;
      // A list read begun before a confirmed write may return after it. Reload
      // that read-only snapshot instead of resurrecting deleted/outdated data.
      while (revision !== projectMutationRevision.current) {
        revision = projectMutationRevision.current;
        projectResult = permissions.has("project.read") ? await listProjects(activeSession) : [];
        assertCurrent();
      }
      setLoadedWorkspaceId(activeSession.workspaceId);
      deletedProjectView.current = null;
      setUnavailableProjectId(null);
      projectListIncarnation.current += 1;
      setProjectList(projectResult);
      setClients(clientResult.filter((client) => client.status === "ACTIVE"));
      setProfile(profileResult);
      applyWorkspaceLocation(projectResult, permissions, true);
    },
    [applyWorkspaceLocation, setProjectList]
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const restore = async () => {
      const stored = loadSession();
      const generation = currentSessionGeneration();
      if (!stored) {
        if (!cancelled) { setSession(null); setHydrated(true); }
        return;
      }
      try {
        const activeSession = new Date(stored.accessTokenExpiresAt).getTime() <= Date.now() + 30_000
          ? await refreshAuthSession(stored) : stored;
        if (cancelled || generation !== currentSessionGeneration()) return;
        setSession(activeSession);
        await refreshProjects(activeSession);
      } catch (cause) {
        if (cancelled || generation !== currentSessionGeneration() || (cause instanceof ApiError && cause.code === "SESSION_CHANGED")) return;
        // A failed workspace read or offline refresh does not invalidate credentials.
        setSession(loadSession());
        setError(cause instanceof Error ? cause.message : "로그인 세션을 복구하지 못했습니다.");
        retryTimer = window.setTimeout(() => void restore(), 30_000);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    void Promise.resolve().then(() => { if (!cancelled) return restore(); });
    return () => {
      cancelled = true;
      workspaceLoadOperation.current += 1;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
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
        deletedProjectView.current = null;
        setUnavailableProjectId(null);
        pendingStart.current.clear(); setPendingRetries([]);
        setIntakeDrafts({});
        setShowNewProject(false);
        setProjectList([]);
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
    [setProjectList]
  );

  useEffect(() => {
    if (!session) return;
    if (loadedWorkspaceId !== session.workspaceId) return;
    Promise.resolve().then(() => applyWorkspaceLocation(projects, activePermissions, true));
  }, [pathname, loadedWorkspaceId, activePermissions, applyWorkspaceLocation, projects, session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let timer: number;
    const refresh = async () => {
      try {
        // The API publishes the guarded result, including the latest workspace.
        await refreshAuthSession(session);
      } catch (cause) {
        if (cancelled || (cause instanceof ApiError && cause.code === "SESSION_CHANGED") || !loadSession()) return;
        setError(cause instanceof Error ? cause.message : "로그인 세션을 복구하지 못했습니다.");
        timer = window.setTimeout(() => void refresh(), 30_000);
      }
    };
    timer = window.setTimeout(() => void refresh(), sessionRefreshDelay(session.accessTokenExpiresAt));
    return () => { cancelled = true; window.clearTimeout(timer); };
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
    saveSession(nextSession);
    const generation = currentSessionGeneration();
    try {
      await refreshProjects(nextSession);
      if (generation !== currentSessionGeneration()) return;
      setSession(loadSession());
      if (isNewWorkspace) navigateWorkspace("settings", null, "intake", true);
    } catch (cause) {
      if (generation !== currentSessionGeneration() || (cause instanceof ApiError && cause.code === "SESSION_CHANGED")) return;
      // Keep the successful login for a reload/retry after a temporary data error.
      setLoadedWorkspaceId(null);
      throw cause;
    }
  };

  const logout = async () => {
    if (!session) return;
    const revokedSession = loadSession() ?? session;
    // Invalidate pending refreshes before waiting for the server.
    clearSession();
    workspaceLoadOperation.current += 1;
    runOperation.current += 1;
    setBusy(false);
    setSession(null);
    deletedProjectView.current = null;
    setUnavailableProjectId(null);
    pendingStart.current.clear();
    setPendingRetries([]);
    setQuotaError(null);
    setIntakeDrafts({});
    setShowNewProject(false);
    setLoadedWorkspaceId(null);
    setPipelinePreferences({ search: "", activeColumn: "all", preferredView: null, sort: "updated" });
    setProjectList([]);
    setClients([]);
    setProfile(null);
    setSelectedProject(null);
    setRun(null);
    setRunId(null);
    setEvents([]);
    try {
      await revokeAuthSession(revokedSession);
    } catch (cause) {
      if (!loadSession()) setError(cause instanceof Error ? cause.message : "로그아웃 요청을 완료하지 못했습니다.");
    }
  };

  const beginRun = async (provider: Provider, model: string, credentialId?: string, message?: string, creditQuote?: CreditQuote, attachmentIds?: string[], skillSelection?: SkillSelection): Promise<boolean> => {
    if (!session || !selectedProject) return false;
    const operation = ++runOperation.current;
    const projectId = selectedProject.id;
    const pending = pendingStart.current.getOrCreate({ userId: session.userId, workspaceId: session.workspaceId, projectId, provider, model, credentialId, message: message ?? selectedProject.requirementText, creditQuote, attachmentIds, skillSelection, workflowMode: message === undefined ? undefined : "AD_HOC" });
    const idempotencyKey = pending.id;
    setBusy(true);
    setError(null);
    try {
      const accepted = await startAgentRun(session, selectedProject, {
        credentialId,
        provider,
        model,
        reasoningEffort: "LOW"
      }, pending.message, idempotencyKey, pending.creditQuote, pending.attachmentIds, pending.skillSelection, pending.workflowMode);
      pendingStart.current.settle(idempotencyKey, "accepted");
      setPendingRetries(pendingStart.current.retries());
      if (operation !== runOperation.current || selectedProjectIdRef.current !== projectId) return true;
      setEvents([]);
      setRun(null);
      setRunId(accepted.runId);
      return true;
    } catch (cause) {
      // An ambiguous network/server failure may have created the run; an explicit retry reuses its key.
      const explicitRejection = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 || isPlatformSpendUnavailable(cause);
      pendingStart.current.settle(idempotencyKey, explicitRejection ? "rejected" : "uncertain");
      setPendingRetries(pendingStart.current.retries());
      if (isCreditQuoteRefreshRequired(cause) || isPlatformSpendUnavailable(cause) || cause instanceof ApiError && byokFailureMessage(cause.code)) throw cause;
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
    const current = loadSession();
    if (!current || current.userId !== session.userId) return;
    const nextSession = { ...current, workspaceId };
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
      if (cause instanceof ApiError && cause.code === "SESSION_CHANGED") return;
      setError(cause instanceof Error ? cause.message : "작업 공간을 전환하지 못했습니다.");
    }
  };

  const handleCreateProject = async (input: Parameters<typeof createProject>[1]) => {
    setError(null);
    const project = await createProject(session, input);
    setIntakeDrafts((current) => ({ ...current, [projectIntakeDraftScope(session)]: createProjectIntakeDraft() }));
    projectListIncarnation.current += 1;
    setProjectList((current) => [project, ...current]);
    setSelectedProject(project);
    navigateWorkspace("project", project);
    setShowNewProject(false);
  };

  const captureProjectMutation = (owner: AuthSession, project: Project) => {
    trackProjectNavigation(window.location.pathname);
    return {
      owner, projectId: project.id, generation: currentSessionGeneration(),
      incarnation: projectListIncarnation.current, navigation: projectNavigation.current.revision,
      path: window.location.pathname, runOperation: runOperation.current
    };
  };

  const completeProjectMutation = async (mutation: ReturnType<typeof captureProjectMutation>, confirmed: Project | null) => {
    const isCurrentOwner = () => {
      const current = loadSession();
      return currentSessionGeneration() === mutation.generation
        && current?.userId === mutation.owner.userId
        && current.workspaceId === mutation.owner.workspaceId;
    };
    if (!isCurrentOwner()) return;
    projectMutationRevision.current += 1;
    let result = confirmed;
    if (mutation.incarnation !== projectListIncarnation.current) {
      // A reload or creation replaced the local list incarnation. The server does
      // not expose an immutable project incarnation, so verify before applying an
      // old completion to a possibly recreated ID. This is a read, never a retry.
      const incarnation = projectListIncarnation.current;
      try {
        result = await readProject(mutation.owner, mutation.projectId);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) result = null;
        else {
          if (isCurrentOwner() && incarnation === projectListIncarnation.current)
            setError("프로젝트 변경은 완료됐지만 최신 목록을 확인하지 못했습니다. 새로고침해 주세요.");
          return;
        }
      }
      if (!isCurrentOwner() || incarnation !== projectListIncarnation.current) return;
    }
    const current = projectList.current.find(project => project.id === mutation.projectId && project.workspaceId === mutation.owner.workspaceId);
    if (result && (result.id !== mutation.projectId || result.workspaceId !== mutation.owner.workspaceId)) return;
    const updated = result && current ? reconcileProject(current, result) : null;
    const ownsView = mutation.incarnation === projectListIncarnation.current
      && mutation.navigation === projectNavigation.current.revision
      && !pendingWorkspacePath.current
      && mutation.path === window.location.pathname
      && selectedProjectIdRef.current === mutation.projectId
      && mutation.runOperation === runOperation.current;
    if (result) {
      if (!updated) return; // A later removal must never be resurrected by an edit response.
      setProjectList(projects => projects.map(project => project.id === mutation.projectId && project.workspaceId === mutation.owner.workspaceId ? updated : project));
      setSelectedProject(project => project?.id === mutation.projectId && project.workspaceId === mutation.owner.workspaceId ? reconcileProject(project, updated) : project);
      if (ownsView && updated === result) resetRun();
      return;
    }
    if (ownsView) {
      selectedProjectIdRef.current = null;
      setSelectedProject(null);
      resetRun();
      navigateWorkspace("pipeline", null, "intake", true);
    } else if (parseWorkspacePath(pendingWorkspacePath.current ?? window.location.pathname, window.location.search).projectId === mutation.projectId) {
      deletedProjectView.current = { projectId: mutation.projectId, revision: projectNavigation.current.revision };
      setUnavailableProjectId(mutation.projectId);
    }
    setProjectList(projects => projects.filter(project => project.id !== mutation.projectId || project.workspaceId !== mutation.owner.workspaceId));
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
        setProjectList((current) => current.map((item) => (item.id === project.id ? reconcileProject(item, project) : item)));
        setSelectedProject((current) => (current?.id === project.id ? reconcileProject(current, project) : current));
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
          onSaveProject: async (input) => {
            const mutation = captureProjectMutation(session, selectedProject);
            const updated = await updateProjectDetails(session, selectedProject, input);
            await completeProjectMutation(mutation, updated);
          },
          onDelete: async () => {
            const mutation = captureProjectMutation(session, selectedProject);
            await deleteProject(session, selectedProject.id);
            await completeProjectMutation(mutation, null);
          },
          onRun: beginRun,
          pendingRetries: pendingRetries.filter(item => item.userId === session.userId && item.workspaceId === session.workspaceId && item.projectId === selectedProject.id),
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
      className={`workspace-shell figma-workspace${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileMenuOpen ? " mobile-navigation-open" : ""}${activeView === "project" && projectStep === "agent" ? " conversation-workspace" : ""}`}
    >
      <WorkspaceChrome
        session={session}
        profile={profile}
        workspaceReady={loadedWorkspaceId === session.workspaceId}
        sidebarCollapsed={compactNavigation ? !mobileMenuOpen : sidebarCollapsed}
        compactNavigation={compactNavigation}
        setSidebarCollapsed={compactNavigation ? (collapsed) => setMobileMenuOpen(!collapsed) : setSidebarCollapsed}
        isDarkTheme={isDarkTheme}
        setTheme={setTheme}
        activeView={activeView}
        streamState={streamState}
        streamRetryCount={streamRetryCount}
        runId={runId}
        run={run}
        activePermissions={activePermissions}
        projects={projects}
        selectedProjectId={unavailableProjectId ? null : selectedProject?.id ?? null}
        onSelectProject={(project) => navigateWorkspace("project", project, "agent")}
        onCreateProject={() => { setMobileMenuOpen(false); setShowNewProject(true); }}
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
          {loadedWorkspaceId === session.workspaceId ? (
            unavailableProjectId !== null && activeView === "project" ? (
              <section className="workspace-loading" role="status">
                <p>{t("이 프로젝트는 삭제되어 더 이상 수정하거나 실행할 수 없습니다.")}</p>
                <button type="button" className="secondary-button" onClick={() => navigateWorkspace("pipeline")}>{t("프로젝트 목록으로")}</button>
              </section>
            ) : children
          ) : (
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
