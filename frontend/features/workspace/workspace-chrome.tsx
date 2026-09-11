import Image from "next/image";
import { GearSix, SignOut } from "@phosphor-icons/react";
import { AuthSession, MeProfile, AgentRunView } from "../../app/lib/api";
import { StreamState, WorkspaceView } from "./shared/types";

interface WorkspaceChromeProps {
  session: AuthSession;
  profile: MeProfile | null;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  isDarkTheme: boolean;
  setTheme: (theme: string) => void;
  activeView: WorkspaceView;
  streamState: StreamState;
  streamRetryCount: number;
  runId: string | null;
  run: AgentRunView | null;
  activePermissions: Set<string>;
  navigateWorkspace: (view: WorkspaceView) => void;
  logout: () => Promise<void>;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
}

export function WorkspaceChrome({ session, profile, sidebarCollapsed, setSidebarCollapsed, isDarkTheme, setTheme, activeView, streamState, streamRetryCount, runId, run, activePermissions, navigateWorkspace, logout, onSwitchWorkspace }: WorkspaceChromeProps) {
  return (
    <>
      <header className="workspace-topbar">
        <div className="workspace-brand-group">
          <button type="button" className="workspace-brand" onClick={() => navigateWorkspace("pipeline")}>
            Freelance Ops
          </button>
          <button
            type="button"
            className="sidebar-toggle icon-button"
            aria-label={sidebarCollapsed ? "메뉴 펼치기" : "메뉴 접기"}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <Image src="/figma/sidebar.svg" alt="" width={24} height={24} />
          </button>
        </div>
        <div className="workspace-live-status" role="status" aria-live="polite">
          <strong className="workspace-page-label">
            {activeView === "clients"
              ? "고객 관리"
              : activeView === "knowledge"
                ? "근거 자료 관리"
                : activeView === "settings"
                  ? "견적 금액 설정"
                  : "프로젝트 현황"}
          </strong>
          <span
            className={
              streamState === "connected" ? "connected" : streamState === "reconnecting" ? "reconnecting" : ""
            }
          />
          {!runId
            ? "실행 대기"
            : streamState === "connected"
              ? "실시간 연결됨"
              : streamState === "connecting"
                ? "실시간 연결 중"
                : streamState === "reconnecting"
                  ? `재연결 중${streamRetryCount > 1 ? ` · ${streamRetryCount}차` : ""}`
                  : run?.status === "WAITING_FOR_USER"
                    ? "사용자 확인 대기"
                    : "실행 상태 동기화됨"}
        </div>
        <div className="workspace-account-actions">
          {profile && profile.workspaces.length > 1 && (
            <label>
              <span className="sr-only">작업 공간 전환</span>
              <select
                value={session.workspaceId}
                onChange={(event) => void onSwitchWorkspace(event.target.value)}
              >
                {profile.workspaces.map((workspace) => (
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="workspace-theme-toggle"
            role="switch"
            aria-checked={isDarkTheme}
            aria-label="다크 모드"
            onClick={() => setTheme(isDarkTheme ? "light" : "dark")}
          >
            다크 모드 <span className="theme-switch" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="설정"
            onClick={() => navigateWorkspace("settings")}
          >
            <GearSix size={24} />
          </button>
          <button
            type="button"
            className="icon-button workspace-mobile-logout"
            aria-label="로그아웃"
            onClick={() => void logout()}
          >
            <SignOut size={18} />
          </button>
        </div>
      </header>

      <aside className="workspace-sidebar">
        <div className="workspace-nav">
          <button
            type="button"
            aria-label="프로젝트 현황"
            aria-current={activeView === "pipeline" || activeView === "project" ? "page" : undefined}
            className={activeView === "pipeline" || activeView === "project" ? "active" : ""}
            onClick={() => navigateWorkspace("pipeline")}
          >
            <Image src="/figma/dashboard.svg" alt="" width={24} height={24} />
            <span className="nav-label-desktop">프로젝트 현황</span>
            <span className="nav-label-mobile">현황</span>
          </button>
          {activePermissions.has("client.read") && (
            <button
              type="button"
              aria-label="고객 관리"
              aria-current={activeView === "clients" ? "page" : undefined}
              className={activeView === "clients" ? "active" : ""}
              onClick={() => navigateWorkspace("clients")}
            >
              <Image src="/figma/person.svg" alt="" width={24} height={24} />
              <span>고객 관리</span>
            </button>
          )}
          {activePermissions.has("document.read") && (
            <button
              type="button"
              aria-label="근거 자료 관리"
              aria-current={activeView === "knowledge" ? "page" : undefined}
              className={activeView === "knowledge" ? "active" : ""}
              onClick={() => navigateWorkspace("knowledge")}
            >
              <Image src="/figma/article.svg" alt="" width={24} height={24} />
              <span>근거 자료 관리</span>
            </button>
          )}
          <button
            type="button"
            aria-label="견적 금액 설정"
            aria-current={activeView === "settings" ? "page" : undefined}
            className={activeView === "settings" ? "active" : ""}
            onClick={() => navigateWorkspace("settings")}
          >
            <Image src="/figma/payment.svg" alt="" width={24} height={24} />
            <span>견적 금액 설정</span>
          </button>
        </div>
        <div className="sidebar-foot">
          <span className="sidebar-avatar" aria-hidden="true">
            {profile?.displayName.slice(0, 1) ?? "F"}
          </span>
          <span>
            <strong>{profile?.displayName ?? "사용자"}</strong>
            <small>{profile?.email}</small>
          </span>
          <button type="button" className="icon-button" aria-label="로그아웃" onClick={() => void logout()}>
            <SignOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
}
