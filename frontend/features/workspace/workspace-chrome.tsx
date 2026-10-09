import { WorkspaceCompanion } from "./pets/workspace-companion";
import { useT } from "../../app/lib/ui-language";
import { WorkspaceLanguageMenu } from "./workspace-language-menu";
import { useMemo, useRef } from "react";
import { useDialogFocusTrap } from "./shared/use-dialog-focus-trap";
import { X, ChatCircleText, SquaresFour, FolderOpen, Files, GearSix, SignOut, SidebarSimple, Plus, Moon, Sun, Users } from "@phosphor-icons/react";
import { AuthSession, MeProfile, AgentRunView, Project } from "../../app/lib/api";
import { StreamState, WorkspaceView } from "./shared/types";
import { pipelineStatusLabels, runStatusLabels } from "./shared/constants";

interface WorkspaceChromeProps {
  session: AuthSession;
  profile: MeProfile | null;
  workspaceReady: boolean;
  sidebarCollapsed: boolean;
  compactNavigation: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  isDarkTheme: boolean;
  setTheme: (theme: string) => void;
  activeView: WorkspaceView;
  streamState: StreamState;
  streamRetryCount: number;
  runId: string | null;
  run: AgentRunView | null;
  projects: Project[];
  selectedProjectId: string | null;
  activePermissions: Set<string>;
  navigateWorkspace: (view: WorkspaceView) => void;
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
  logout: () => Promise<void>;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
}

export function WorkspaceChrome({ session, profile, workspaceReady, sidebarCollapsed, compactNavigation, setSidebarCollapsed, isDarkTheme, setTheme, activeView, streamState, streamRetryCount, runId, run, projects, selectedProjectId, activePermissions, navigateWorkspace, onSelectProject, onCreateProject, logout, onSwitchWorkspace }: WorkspaceChromeProps) {
  const t = useT();
  const sidebar = useRef<HTMLElement>(null);
  useDialogFocusTrap(sidebar, () => setSidebarCollapsed(true), false, compactNavigation && !sidebarCollapsed, true);
  const recentProjects = useMemo(() => projects.filter(project => project.status !== "CANCELLED").toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12), [projects]);
  const workspace = profile?.workspaces.find(item => item.workspaceId === session.workspaceId);
  const activeRun = !!runId && (!run || ["QUEUED", "RUNNING", "WAITING_FOR_USER"].includes(run.status));
  const status = !runId ? t("작업 공간")
    : run?.status === "WAITING_FOR_USER" ? t("사용자 확인 대기")
      : !activeRun && run ? t(runStatusLabels[run.status] ?? "상태 확인 필요")
        : streamState === "reconnecting" ? t("재연결 중{v0}", { v0: streamRetryCount > 1 ? ` · ${streamRetryCount}` : "" })
          : streamState === "connecting" ? t("실시간 연결 중")
            : streamState === "connected" ? t("실시간 연결됨") : t("상태 확인 중");
  const pageLabel = activeView === "project" ? projects.find(project => project.id === selectedProjectId)?.title ?? t("프로젝트") : activeView === "clients" ? t("고객 관리") : activeView === "knowledge" ? t("근거 자료 관리") : activeView === "settings" ? t("설정") : t("프로젝트 현황");
  const menus = [
    { view: "pipeline" as const, label: t("프로젝트 현황"), short: t("현황"), Icon: SquaresFour, visible: true },
    { view: "clients" as const, label: t("고객 관리"), short: t("고객 관리"), Icon: Users, visible: activePermissions.has("client.read") },
    { view: "knowledge" as const, label: t("근거 자료 관리"), short: t("근거 자료"), Icon: Files, visible: activePermissions.has("document.read") },
    { view: "settings" as const, label: t("설정"), short: t("설정"), Icon: GearSix, visible: true },
  ];

  return <>
    <header className="workspace-topbar">
      <div className="workspace-brand-group">
        <button type="button" className="workspace-brand" aria-label={`Freelance Ops · ${t("프로젝트 현황")}`} onClick={() => navigateWorkspace("pipeline")}>
          <span className="workspace-brand-mark" aria-hidden="true"><SquaresFour size={20} weight="fill" /></span><span>Freelance Ops</span>
        </button>
        <button type="button" className="sidebar-toggle icon-button" aria-label={sidebarCollapsed ? t("메뉴 펼치기") : t("메뉴 접기")} aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
          <SidebarSimple size={21} />
        </button>
      </div>
      <div className="workspace-live-status">
        <WorkspaceCompanion key={`${session.userId}:${session.workspaceId}:${workspaceReady && activePermissions.has("agent.run")}`} session={session} canReadPets={workspaceReady && activePermissions.has("agent.run")} />
        <div className="workspace-page-context">
        <strong className="workspace-page-label" title={pageLabel}>{pageLabel}</strong>
        <div className="workspace-connection-label" role="status" aria-live="polite">
          <i className={activeRun && streamState === "connected" ? "connected" : activeRun && streamState === "reconnecting" ? "reconnecting" : ""} aria-hidden="true" />
          <span>{status}</span>
        </div>
        </div>
      </div>
      <div className="workspace-account-actions">
        <WorkspaceLanguageMenu />
        <button type="button" className="workspace-theme-toggle icon-button" role="switch" aria-checked={isDarkTheme} aria-label={t("다크 모드")} onClick={() => setTheme(isDarkTheme ? "light" : "dark")}>
          {isDarkTheme ? <Moon size={20} /> : <Sun size={20} />}
        </button>
        <button type="button" className="icon-button workspace-mobile-logout" aria-label={t("로그아웃")} onClick={() => void logout()}><SignOut size={20} /></button>
      </div>
    </header>

    {compactNavigation && !sidebarCollapsed && <div className="workspace-sidebar-backdrop" aria-hidden="true" />}
    <aside ref={sidebar} id="workspace-sidebar" className="workspace-sidebar" role={compactNavigation && !sidebarCollapsed ? "dialog" : undefined} aria-modal={compactNavigation && !sidebarCollapsed || undefined} aria-label={t("작업 공간 탐색")}>
      <div className="workspace-mobile-menu-heading"><strong>Freelance Ops</strong><button type="button" className="icon-button" aria-label={t("메뉴 접기")} onClick={() => setSidebarCollapsed(true)}><X size={21} /></button></div>
      <div className="workspace-identity">
        <span className="workspace-identity-icon" aria-hidden="true"><FolderOpen size={19} /></span>
        <div><small>{t("작업 공간")}</small><strong title={workspace?.name}>{workspace?.name ?? t("내 작업 공간")}</strong></div>
      </div>
      {profile && profile.workspaces.length > 1 && <label className="workspace-switcher"><span className="sr-only">{t("작업 공간 전환")}</span><select value={session.workspaceId} onChange={event => void onSwitchWorkspace(event.target.value)}>{profile.workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.name}</option>)}</select></label>}
      <nav className="workspace-nav" aria-label={t("주 메뉴")}>
        {menus.filter(item => item.visible).map(({view, label, short, Icon}) => <button key={view} type="button" title={label} aria-label={label} aria-current={activeView === view || view === "pipeline" && activeView === "project" ? "page" : undefined} className={activeView === view || view === "pipeline" && activeView === "project" ? "active" : ""} onClick={() => navigateWorkspace(view)}>
          <Icon size={20} /><span className="nav-label-desktop">{label}</span><span className="nav-label-mobile">{short}</span>
        </button>)}
      </nav>
      <div className="workspace-projects">
        <div className="workspace-projects-heading"><span>{t("최근 프로젝트")}</span>{activePermissions.has("project.write") && <button type="button" className="icon-button" aria-label={t("신규 문의 등록")} title={t("신규 문의 등록")} onClick={onCreateProject}><Plus size={18} /></button>}</div>
        <nav className="workspace-project-list" aria-label={t("최근 프로젝트 대화")}>
          {recentProjects.map(project => <button type="button" key={project.id} title={project.title} aria-current={activeView === "project" && selectedProjectId === project.id ? "page" : undefined} className={activeView === "project" && selectedProjectId === project.id ? "active" : ""} onClick={() => onSelectProject(project)}>
            <ChatCircleText size={18} aria-hidden="true" /><span><strong>{project.title}</strong><small>{t(pipelineStatusLabels[project.status] ?? project.status)}</small></span>
          </button>)}
        </nav>
        {!recentProjects.length && <p className="workspace-projects-empty">{t("첫 문의를 등록하면 여기에 프로젝트 대화가 표시됩니다.")}</p>}
        <label className="workspace-project-select"><span className="sr-only">{t("프로젝트 대화 바로가기")}</span><select value={activeView === "project" ? selectedProjectId ?? "" : ""} onChange={event => { const project = projects.find(item => item.id === event.target.value); if (project) onSelectProject(project); }}><option value="">{t("프로젝트 대화 바로가기")}</option>{projects.filter(project => project.status !== "CANCELLED" || project.id === selectedProjectId).map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        {recentProjects.length > 0 && <button type="button" className="workspace-all-projects" onClick={() => navigateWorkspace("pipeline")}>{t("전체 프로젝트 보기")}</button>}
      </div>
      <div className="sidebar-foot">
        <span className="sidebar-avatar" aria-hidden="true">{profile?.displayName.slice(0, 1) ?? "F"}</span>
        <span><strong>{profile?.displayName ?? t("사용자")}</strong><small title={profile?.email}>{profile?.email}</small></span>
        <button type="button" className="icon-button" aria-label={t("로그아웃")} title={t("로그아웃")} onClick={() => void logout()}><SignOut size={18} /></button>
      </div>
    </aside>
  </>;
}
