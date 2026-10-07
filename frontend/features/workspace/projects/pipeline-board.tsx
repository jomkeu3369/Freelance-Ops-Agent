import { useT } from "../../../app/lib/ui-language";
import { Dispatch, SetStateAction } from "react";
import { PipelinePreferences } from "./pipeline-preferences";
import {
  Project,
  AuthSession,
  Client,
  ProjectStatus,
  listProjects,
  readProject,
  updateProject
} from "../../../app/lib/api";
import { useState, useRef, useSyncExternalStore, useCallback, useEffect, FormEvent } from "react";
import { pipelineColumns, pipelineStatusLabels } from "../shared/constants";
import { CaretDown, CircleNotch, MagnifyingGlass, Plus, Warning, FolderOpen, DotsSixVertical } from "@phosphor-icons/react";
import { projectClientLabel, formatMoney } from "../shared/formatters";
import { usePipelineMoveState } from "./pipeline-move-store";
import { usePipelineDrag } from "./use-pipeline-drag";
import { EmptyWorkspace } from "../project/empty-workspace";

export const subscribeToCompactWorkspace = (onChange: () => void) => {
  const media = window.matchMedia("(max-width: 820px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

interface DeadlineBadgeProps {
  project: Project;
}

export function DeadlineBadge({ project }: DeadlineBadgeProps) {
  const t = useT();
  const [today] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }));
  if (project.status === "COMPLETED") return <small className="deadline-badge complete">{t("완료")}</small>;
  if (!project.deadline) return null;
  const days = Math.round((Date.parse(project.deadline.slice(0, 10)) - Date.parse(today)) / 86400000);
  if (!Number.isFinite(days)) return null;
  return (
    <small className={`deadline-badge${days <= 7 ? " urgent" : ""}`}>
      {days === 0 ? "D-Day" : days > 0 ? `D-${days}` : `D+${Math.abs(days)}`}
    </small>
  );
}

interface PipelineBoardProps {
  preferences: PipelinePreferences;
  onPreferencesChange: Dispatch<SetStateAction<PipelinePreferences>>;
  session: AuthSession;
  projects: Project[];
  clients: Client[];
  displayName: string;
  canWrite: boolean;
  onCreate: () => void;
  onSelect: (project: Project) => void;
  onProjectUpdated: (project: Project) => void;
}

export function PipelineBoard({ session, projects, clients, displayName, canWrite, onCreate, onSelect, onProjectUpdated, preferences, onPreferencesChange }: PipelineBoardProps) {
  const t = useT();
  const stageMove = usePipelineMoveState(`${session.userId}:${session.workspaceId}`);
  const pendingMove = stageMove.pending;
  const movingId = pendingMove?.id ?? null;
  const moveNotice = stageMove.notice;
  const boardPage = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { search, activeColumn, preferredView, sort } = preferences;
  const setSearch = (search: string) => onPreferencesChange((current) => ({ ...current, search }));
  const setActiveColumn = (activeColumn: string) =>
    onPreferencesChange((current) => ({ ...current, activeColumn }));
  const setView = (preferredView: "board" | "list") =>
    onPreferencesChange((current) => ({ ...current, preferredView }));
  const setSort = (sort: "updated" | "deadline") => onPreferencesChange((current) => ({ ...current, sort }));
  const searchResults = preferences.searchResults ?? null;
  const setSearchResults = useCallback(
    (value: SetStateAction<Project[] | null>) => {
      onPreferencesChange((current) => ({
        ...current,
        searchResults: typeof value === "function" ? value(current.searchResults ?? null) : value
      }));
    },
    [onPreferencesChange]
  );
  const [searching, setSearching] = useState(Boolean(search.trim()));
  const searchRevision = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const compact = useSyncExternalStore(
    subscribeToCompactWorkspace,
    () => window.matchMedia("(max-width: 820px)").matches,
    () => false
  );
  const view = preferredView ?? (compact ? "list" : "board");
  const displayedProjects = projects.map(project => pendingMove?.id === project.id ? { ...project, status: pendingMove.status } : project);
  const activeProjects = displayedProjects.filter(
    (project) =>
      project.status !== "CANCELLED" &&
      (!searchResults || searchResults.some((result) => result.id === project.id))
  );
  const selectedColumn = pipelineColumns.find((column) => column.key === activeColumn);
  const visibleProjects = activeProjects
    .filter(
      (project) =>
        view === "board" ||
        !selectedColumn ||
        selectedColumn.statuses.includes(project.status as ProjectStatus)
    )
    .toSorted((left, right) =>
      sort === "deadline"
        ? (left.deadline ?? "9999-12-31").localeCompare(right.deadline ?? "9999-12-31")
        : new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );

  const executeSearch = useCallback(async () => {
    const revision = ++searchRevision.current;
    setSearching(true);
    setError(null);
    try {
      const results = search.trim() ? await listProjects(session, search) : null;
      if (revision === searchRevision.current) setSearchResults(results);
    } catch (cause) {
      if (revision === searchRevision.current)
        setError(
          cause instanceof Error
            ? `검색 결과를 불러오지 못했습니다. ${cause.message}`
            : "검색 결과를 불러오지 못했습니다."
        );
    } finally {
      if (revision === searchRevision.current) setSearching(false);
    }
  }, [search, session, setSearchResults]);

  useEffect(() => {
    if (search.trim()) searchTimer.current = setTimeout(() => void executeSearch(), 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchRevision.current += 1;
    };
  }, [executeSearch, projects, search]);

  const changeSearch = (value: string) => {
    searchRevision.current += 1;
    setSearch(value);
    setSearching(Boolean(value.trim()));
    setError(null);
    if (!value.trim()) setSearchResults(null);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    void executeSearch();
  };

  const showStage = (stage: string) => {
    changeSearch("");
    setActiveColumn(stage);
    setView("list");
  };

  const move = async (project: Project, status: ProjectStatus) => {
    const current = projects.find(item => item.id === project.id);
    if (!canWrite || !current || current.status === status) return;
    const operation = stageMove.begin(project.id, status);
    if (!operation) return;
    let moveError: string | null = null;
    let notice: { title: string; status: string } | null = null;
    const focusedSelect = document.activeElement instanceof HTMLSelectElement
      && document.activeElement.closest("[data-project-id]")?.getAttribute("data-project-id") === project.id;
    const restoreFocus = () => {
      if (focusedSelect) requestAnimationFrame(() => {
        if (document.activeElement === document.body) {
          boardPage.current?.querySelector<HTMLSelectElement>(`[data-project-id="${CSS.escape(project.id)}"] select`)?.focus();
        }
      });
    };
    setError(null);
    restoreFocus();
    const accept = (updated: Project) => {
      onProjectUpdated(updated);
      setSearchResults(current => current?.map(item => item.id === updated.id ? updated : item) ?? null);
    };
    try {
      const updated = await updateProject(session, current, status);
      accept(updated);
      notice = { title: updated.title, status: updated.status };
    } catch {
      // A lost response is ambiguous: never blindly retry a write or overwrite fresh server state.
      try {
        const latest = await readProject(session, project.id);
        accept(latest);
        if (latest.status === status) notice = { title: latest.title, status: latest.status };
        else moveError = "상태 변경이 저장되지 않았습니다. 최신 상태를 불러왔습니다. 다시 시도해 주세요.";
      } catch {
        moveError = "상태 변경을 확인하지 못해 화면을 이전 상태로 되돌렸습니다. 새로고침 후 다시 시도해 주세요.";
      }
    } finally {
      stageMove.finish(operation, moveError, notice);
      restoreFocus();
    }
  };

  const drag = usePipelineDrag({
    projects: visibleProjects,
    enabled: canWrite && view === "board" && movingId === null,
    onMove: (project, status) => { void move(project, status); }
  });


  if (projects.length === 0 && !search.trim() && searchResults === null && !searching) {
    return <EmptyWorkspace canCreate={canWrite} onCreate={onCreate} />;
  }

  return (
    <section className="pipeline-page" ref={boardPage}>
      <div className="pipeline-hero">
        <div className="pipeline-heading">
          <div>
            <h1>
              {t("안녕하세요.")}{displayName}{t("님,")}<br />
              {t("지금 확인할 일을 모았습니다.")}</h1>
            <p>{t("새 문의부터 진행 중인 작업, 마무리할 회고까지 한곳에서 확인하세요.")}</p>
          </div>
        </div>
        <div className="pipeline-summary">
          <button type="button" onClick={() => showStage("all")}>
            <span>{t("전체 프로젝트")}</span>
            <strong>{projects.filter((project) => project.status !== "CANCELLED").length}{t("건")}</strong>
          </button>
          <button type="button" onClick={() => showStage("quoting")}>
            <span>{t("견적 작성")}</span>
            <strong>{projects.filter((project) => project.status === "QUOTING").length}{t("건")}</strong>
          </button>
          <button type="button" onClick={() => showStage("review")}>
            <span>{t("완료 프로젝트")}</span>
            <strong>{projects.filter((project) => project.status === "COMPLETED").length}{t("건")}</strong>
          </button>
        </div>
      </div>
      <div className="pipeline-toolbar">
        <div className="pipeline-view-tabs" aria-label={t("프로젝트 보기 방식")}>
          <button
            type="button"
            aria-pressed={view === "board"}
            className={view === "board" ? "active" : ""}
            onClick={() => { drag.cancel(); setView("board"); }}
          >
            {t("한눈에 보기")}</button>
          <button
            type="button"
            aria-pressed={view === "list"}
            className={view === "list" ? "active" : ""}
            onClick={() => { drag.cancel(); setView("list"); }}
          >
            {t("목록 보기")}</button>
        </div>
        <div className="pipeline-actions">
          <label className="pipeline-sort">
            <span className="sr-only">{t("정렬 기준")}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as "updated" | "deadline")}>
              <option value="updated">{t("업데이트 순")}</option>
              <option value="deadline">{t("마감일 순")}</option>
            </select>
            <CaretDown size={15} />
          </label>
          <form className="pipeline-search" role="search" onSubmit={submitSearch}>
            <input
              ref={searchInput}
              aria-label={t("프로젝트 검색")}
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder={t("프로젝트명, 고객명으로 검색")}
            />
            <button type="submit" aria-label={t("검색")} disabled={searching}>
              {searching ? <CircleNotch size={18} className="spin" /> : <MagnifyingGlass size={18} />}
            </button>
          </form>
          {canWrite && (
            <button type="button" className="primary-button" onClick={onCreate}>
              <Plus size={18} /> {t("신규 문의 등록")}</button>
          )}
        </div>
      </div>
      {(error || stageMove.error) && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {t(error || stageMove.error)}
        </div>
      )}
      <div className="pipeline-results">
        <p role="status" aria-live="polite">
          {searching
            ? t("검색 중입니다…")
            : t("{v0} {v1}건{v2}", { v0: view === "list" && selectedColumn ? t(selectedColumn.title) : t("전체"), v1: visibleProjects.length, v2: searchResults ? t(" · 검색 결과") : "" })}
        </p>
        {(search || activeColumn !== "all") && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => {
              changeSearch("");
              setActiveColumn("all");
              searchInput.current?.focus();
            }}
          >
            {t("검색·필터 초기화")}</button>
        )}
      </div>
      <p className={movingId || moveNotice ? "pipeline-move-feedback" : "sr-only"} role="status" aria-live="polite" aria-atomic="true">
        {movingId ? t("프로젝트 상태를 저장하고 있습니다.") : moveNotice
          ? t("{v0} 상태를 {v1}(으)로 변경했습니다.", { v0: moveNotice.title, v1: t(pipelineStatusLabels[moveNotice.status]) })
          : drag.draggingId ? t("다른 단계에 놓아 상태를 변경하세요. Esc 키로 취소할 수 있습니다.") : ""}
      </p>
      {view === "board" && canWrite && (
        <p id="pipeline-drag-help" className="pipeline-drag-help">
          <DotsSixVertical size={16} aria-hidden="true" />
          {t("카드를 다른 단계로 끌어 놓거나 카드의 단계 메뉴로 변경하세요.")}
        </p>
      )}
      {view === "list" && (
        <label className="pipeline-mobile-stage">
          <span>{t("진행 단계")}</span>
          <select
            aria-label={t("진행 단계 필터")}
            value={activeColumn}
            onChange={(event) => setActiveColumn(event.target.value)}
          >
            <option value="all">{t("전체 ·")}{activeProjects.length}{t("건")}</option>
            {pipelineColumns.map((column) => (
              <option key={column.key} value={column.key}>
                {t(column.title)} ·{" "}
                {
                  activeProjects.filter((project) =>
                    column.statuses.includes(project.status as ProjectStatus)
                  ).length
                }
                {t("건")}</option>
            ))}
          </select>
        </label>
      )}
      {view === "list" && (
        <div className="pipeline-status-tabs" aria-label={t("프로젝트 단계")}>
          <button
            type="button"
            aria-pressed={activeColumn === "all"}
            className={activeColumn === "all" ? "active" : ""}
            onClick={() => setActiveColumn("all")}
          >
            {t("전체")}<span>{activeProjects.length}</span>
          </button>
          {pipelineColumns.map((column) => (
            <button
              key={column.key}
              type="button"
              aria-pressed={activeColumn === column.key}
              className={activeColumn === column.key ? "active" : ""}
              onClick={() => setActiveColumn(column.key)}
            >
              {t(column.title)}
              <span>
                {
                  activeProjects.filter((project) =>
                    column.statuses.includes(project.status as ProjectStatus)
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
      )}
      {view === "board" ? (
        <div className="pipeline-board" aria-label={t("단계별 프로젝트 보드")}>
          {pipelineColumns.map((column) => {
            const columnProjects = visibleProjects.filter((project) =>
              column.statuses.includes(project.status as ProjectStatus)
            );
            return (
              <section
                key={column.key}
                className={`pipeline-column stage-${column.key}${drag.targetKey === column.key ? " drop-target" : ""}`}
                onDragOver={(event) => drag.over(event, column)}
                onDragLeave={drag.leave}
                onDrop={(event) => drag.drop(event, column)}
                aria-label={t(column.title)}
              >
                <header>
                  <div>
                    <h2>
                      <i aria-hidden="true" />
                      {t(column.title)}
                      <span>{columnProjects.length}</span>
                    </h2>
                    <p>{t(column.caption)}</p>
                  </div>
                </header>
                <div className="pipeline-cards">
                  {drag.targetKey === column.key && (
                    <div className="pipeline-drop-indicator" aria-hidden="true">
                      {t("여기에 놓아 {v0}(으)로 변경", { v0: t(column.title) })}
                    </div>
                  )}
                  {columnProjects.length === 0 && (
                    <p className="column-empty">
                      {searchResults ? t("검색 결과가 없습니다") : t("현재 프로젝트가 없습니다")}
                    </p>
                  )}
                  {columnProjects.map((project) => (
                    <article
                      data-project-id={project.id}
                      key={project.id}
                      className={`${movingId === project.id ? "saving" : ""}${drag.draggingId === project.id ? " dragging" : ""}`}
                      draggable={canWrite && movingId === null}
                      onDragStart={(event) => drag.start(event, project)}
                      onDragEnd={drag.cancel}
                      aria-busy={movingId === project.id}
                    >
                      <button type="button" className="pipeline-card-open"
                        aria-describedby={canWrite ? "pipeline-drag-help" : undefined}
                        disabled={movingId === project.id}
                        onClick={() => { if (drag.canOpen()) onSelect(project); }}>
                        {canWrite && <DotsSixVertical className="pipeline-drag-grip" size={16} aria-hidden="true" />}
                        <span className="pipeline-card-client">{projectClientLabel(project, clients, t)}</span>
                        <h3>{project.title}</h3>
                        <span className="pipeline-deadline">
                          {project.deadline
                            ? t("{v0} 까지", { v0: project.deadline.replaceAll("-", ".") })
                            : t("희망 완료일 미정")}
                          <DeadlineBadge project={project} />
                        </span>
                      </button>
                      {canWrite ? (
                        <label>
                          <span>{t("단계")}</span>
                          <select
                            value={project.status}
                            aria-label={t("{v0} 상태", { v0: project.title })}
                            disabled={movingId !== null}
                            onChange={(event) => void move(project, event.target.value as ProjectStatus)}
                          >
                            {project.status === "ACCEPTED" && (
                              <option value="ACCEPTED">{t(pipelineStatusLabels.ACCEPTED)}</option>
                            )}
                            {pipelineColumns.map((target) => (
                              <option key={target.key} value={target.moveTo}>
                                {t(target.title)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <div className="pipeline-card-status">{t(pipelineStatusLabels[project.status])}</div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="pipeline-empty">
          <FolderOpen size={34} />
          <h2>
            {searchResults
              ? t("검색 조건에 맞는 프로젝트가 없습니다.")
              : selectedColumn
                ? t("{v0} 단계의 프로젝트가 없습니다.", { v0: t(selectedColumn.title) })
                : t("아직 등록된 프로젝트가 없습니다.")}
          </h2>
          <p>
            {canWrite && !searchResults
              ? t("새 고객 문의를 등록하거나 다른 단계를 확인해 주세요.")
              : t("검색어 또는 다른 진행 단계를 확인해 주세요.")}
          </p>
          {canWrite && !searchResults && (
            <button type="button" className="primary-button" onClick={onCreate}>
              {t("문의 등록")}</button>
          )}
        </div>
      ) : (
        <div className="pipeline-list">
          {visibleProjects.map((project) => (
            <article
              data-project-id={project.id}
              key={project.id}
              className={movingId === project.id ? "saving" : ""}
            >
              <button type="button" className="pipeline-list-open" onClick={() => onSelect(project)} disabled={movingId === project.id}>
                <span className="pipeline-card-client">{projectClientLabel(project, clients, t)}</span>
                <span className="pipeline-list-divider">·</span>
                <span className="pipeline-status-text">
                  {t(pipelineStatusLabels[project.status]) ?? project.status}
                </span>
                <h2>{project.title}</h2>
                <p>{project.requirementText}</p>
                <dl>
                  <div>
                    <dt>{t("통화")}</dt>
                    <dd>{project.currency}</dd>
                  </div>
                  <div>
                    <dt>{t("희망 완료일")}</dt>
                    <dd>
                      {project.deadline ?? t("미정")} <DeadlineBadge project={project} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t("예산 범위")}</dt>
                    <dd>
                      {project.budgetMin == null && project.budgetMax == null
                        ? t("미정")
                        : `${formatMoney(project.budgetMin ?? 0, project.currency)}–${formatMoney(project.budgetMax ?? 0, project.currency)}`}
                    </dd>
                  </div>
                </dl>
              </button>
              {canWrite && (
                <label className="pipeline-status-select">
                  <span>{t("단계 변경")}</span>
                  <select
                    value={project.status}
                    aria-label={t("{v0} 상태", { v0: project.title })}
                    disabled={movingId !== null}
                    onChange={(event) => void move(project, event.target.value as ProjectStatus)}
                  >
                    {project.status === "ACCEPTED" && (
                      <option value="ACCEPTED">{t(pipelineStatusLabels.ACCEPTED)}</option>
                    )}
                    {pipelineColumns.map((target) => (
                      <option key={target.key} value={target.moveTo}>
                        {t(target.title)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
