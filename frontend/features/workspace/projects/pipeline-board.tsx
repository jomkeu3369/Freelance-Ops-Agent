import { Dispatch, SetStateAction } from "react";
import { PipelinePreferences } from "./pipeline-preferences";
import {
  Project,
  AuthSession,
  Client,
  ProjectStatus,
  listProjects,
  updateProject
} from "../../../app/lib/api";
import { useState, useRef, useSyncExternalStore, useCallback, useEffect, FormEvent } from "react";
import { pipelineColumns, pipelineStatusLabels } from "../shared/constants";
import { CaretDown, CircleNotch, MagnifyingGlass, Plus, Warning, FolderOpen } from "@phosphor-icons/react";
import { projectClientLabel, formatMoney } from "../shared/formatters";

export const subscribeToCompactWorkspace = (onChange: () => void) => {
  const media = window.matchMedia("(max-width: 820px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

interface DeadlineBadgeProps {
  project: Project;
}

export function DeadlineBadge({ project }: DeadlineBadgeProps) {
  const [today] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }));
  if (project.status === "COMPLETED") return <small className="deadline-badge complete">완료</small>;
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
  const [movingId, setMovingId] = useState<string | null>(null);
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
  const activeProjects = projects.filter(
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
    if (!canWrite || movingId || project.status === status) return;
    setMovingId(project.id);
    setError(null);
    try {
      const updated = await updateProject(session, project, status);
      onProjectUpdated(updated);
      setSearchResults(
        (current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? null
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `상태 변경이 저장되지 않았습니다. 서버 상태를 다시 확인해 주세요. ${cause.message}`
          : "상태 변경이 저장되지 않았습니다."
      );
    } finally {
      setMovingId(null);
    }
  };

  return (
    <section className="pipeline-page">
      <div className="pipeline-hero">
        <div className="pipeline-heading">
          <div>
            <h1>
              안녕하세요. {displayName}님,
              <br />
              지금 확인할 일을 모았습니다.
            </h1>
            <p>새 문의부터 진행 중인 작업, 마무리할 회고까지 한곳에서 확인하세요.</p>
          </div>
        </div>
        <div className="pipeline-summary">
          <button type="button" onClick={() => showStage("all")}>
            <span>전체 프로젝트</span>
            <strong>{projects.filter((project) => project.status !== "CANCELLED").length}건</strong>
          </button>
          <button type="button" onClick={() => showStage("quoting")}>
            <span>견적 작성</span>
            <strong>{projects.filter((project) => project.status === "QUOTING").length}건</strong>
          </button>
          <button type="button" onClick={() => showStage("review")}>
            <span>완료 프로젝트</span>
            <strong>{projects.filter((project) => project.status === "COMPLETED").length}건</strong>
          </button>
        </div>
      </div>
      <div className="pipeline-toolbar">
        <div className="pipeline-view-tabs" aria-label="프로젝트 보기 방식">
          <button
            type="button"
            aria-pressed={view === "board"}
            className={view === "board" ? "active" : ""}
            onClick={() => setView("board")}
          >
            한눈에 보기
          </button>
          <button
            type="button"
            aria-pressed={view === "list"}
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
            목록 보기
          </button>
        </div>
        <div className="pipeline-actions">
          <label className="pipeline-sort">
            <span className="sr-only">정렬 기준</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as "updated" | "deadline")}>
              <option value="updated">업데이트 순</option>
              <option value="deadline">마감일 순</option>
            </select>
            <CaretDown size={15} />
          </label>
          <form className="pipeline-search" role="search" onSubmit={submitSearch}>
            <input
              ref={searchInput}
              aria-label="프로젝트 검색"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder="프로젝트명, 고객명으로 검색"
            />
            <button type="submit" aria-label="검색" disabled={searching}>
              {searching ? <CircleNotch size={18} className="spin" /> : <MagnifyingGlass size={18} />}
            </button>
          </form>
          {canWrite && (
            <button type="button" className="primary-button" onClick={onCreate}>
              <Plus size={18} /> 신규 문의 등록
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {error}
        </div>
      )}
      <div className="pipeline-results">
        <p role="status" aria-live="polite">
          {searching
            ? "검색 중입니다…"
            : `${view === "list" && selectedColumn ? selectedColumn.title : "전체"} ${visibleProjects.length}건${searchResults ? " · 검색 결과" : ""}`}
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
            검색·필터 초기화
          </button>
        )}
      </div>
      {view === "list" && (
        <label className="pipeline-mobile-stage">
          <span>진행 단계</span>
          <select
            aria-label="진행 단계 필터"
            value={activeColumn}
            onChange={(event) => setActiveColumn(event.target.value)}
          >
            <option value="all">전체 · {activeProjects.length}건</option>
            {pipelineColumns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.title} ·{" "}
                {
                  activeProjects.filter((project) =>
                    column.statuses.includes(project.status as ProjectStatus)
                  ).length
                }
                건
              </option>
            ))}
          </select>
        </label>
      )}
      {view === "list" && (
        <div className="pipeline-status-tabs" aria-label="프로젝트 단계">
          <button
            type="button"
            aria-pressed={activeColumn === "all"}
            className={activeColumn === "all" ? "active" : ""}
            onClick={() => setActiveColumn("all")}
          >
            전체<span>{activeProjects.length}</span>
          </button>
          {pipelineColumns.map((column) => (
            <button
              key={column.key}
              type="button"
              aria-pressed={activeColumn === column.key}
              className={activeColumn === column.key ? "active" : ""}
              onClick={() => setActiveColumn(column.key)}
            >
              {column.title}
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
        <div className="pipeline-board" aria-label="단계별 프로젝트 보드">
          {pipelineColumns.map((column) => {
            const columnProjects = visibleProjects.filter((project) =>
              column.statuses.includes(project.status as ProjectStatus)
            );
            return (
              <section
                key={column.key}
                className={`pipeline-column stage-${column.key}`}
                aria-label={column.title}
              >
                <header>
                  <div>
                    <h2>
                      <i aria-hidden="true" />
                      {column.title}
                      <span>{columnProjects.length}</span>
                    </h2>
                    <p>{column.caption}</p>
                  </div>
                </header>
                <div className="pipeline-cards">
                  {columnProjects.length === 0 && (
                    <p className="column-empty">
                      {searchResults ? "검색 결과가 없습니다" : "현재 프로젝트가 없습니다"}
                    </p>
                  )}
                  {columnProjects.map((project) => (
                    <article
                      data-project-id={project.id}
                      key={project.id}
                      className={movingId === project.id ? "saving" : ""}
                    >
                      <button type="button" className="pipeline-card-open" onClick={() => onSelect(project)}>
                        <span className="pipeline-card-client">{projectClientLabel(project, clients)}</span>
                        <h3>{project.title}</h3>
                        <span className="pipeline-deadline">
                          {project.deadline
                            ? `${project.deadline.replaceAll("-", ".")} 까지`
                            : "희망 완료일 미정"}
                          <DeadlineBadge project={project} />
                        </span>
                      </button>
                      {canWrite ? (
                        <label>
                          <span>단계</span>
                          <select
                            value={project.status}
                            aria-label={`${project.title} 상태`}
                            disabled={movingId !== null}
                            onChange={(event) => void move(project, event.target.value as ProjectStatus)}
                          >
                            {project.status === "ACCEPTED" && (
                              <option value="ACCEPTED">{pipelineStatusLabels.ACCEPTED}</option>
                            )}
                            {pipelineColumns.map((target) => (
                              <option key={target.key} value={target.moveTo}>
                                {target.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <div className="pipeline-card-status">{pipelineStatusLabels[project.status]}</div>
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
              ? "검색 조건에 맞는 프로젝트가 없습니다."
              : selectedColumn
                ? `${selectedColumn.title} 단계의 프로젝트가 없습니다.`
                : "아직 등록된 프로젝트가 없습니다."}
          </h2>
          <p>
            {canWrite && !searchResults
              ? "새 고객 문의를 등록하거나 다른 단계를 확인해 주세요."
              : "검색어 또는 다른 진행 단계를 확인해 주세요."}
          </p>
          {canWrite && !searchResults && (
            <button type="button" className="primary-button" onClick={onCreate}>
              문의 등록
            </button>
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
              <button type="button" className="pipeline-list-open" onClick={() => onSelect(project)}>
                <span className="pipeline-card-client">{projectClientLabel(project, clients)}</span>
                <span className="pipeline-list-divider">·</span>
                <span className="pipeline-status-text">
                  {pipelineStatusLabels[project.status] ?? project.status}
                </span>
                <h2>{project.title}</h2>
                <p>{project.requirementText}</p>
                <dl>
                  <div>
                    <dt>통화</dt>
                    <dd>{project.currency}</dd>
                  </div>
                  <div>
                    <dt>희망 완료일</dt>
                    <dd>
                      {project.deadline ?? "미정"} <DeadlineBadge project={project} />
                    </dd>
                  </div>
                  <div>
                    <dt>예산 범위</dt>
                    <dd>
                      {project.budgetMin == null && project.budgetMax == null
                        ? "미정"
                        : `${formatMoney(project.budgetMin ?? 0, project.currency)}–${formatMoney(project.budgetMax ?? 0, project.currency)}`}
                    </dd>
                  </div>
                </dl>
              </button>
              {canWrite && (
                <label className="pipeline-status-select">
                  <span>단계 변경</span>
                  <select
                    value={project.status}
                    aria-label={`${project.title} 상태`}
                    disabled={movingId !== null}
                    onChange={(event) => void move(project, event.target.value as ProjectStatus)}
                  >
                    {project.status === "ACCEPTED" && (
                      <option value="ACCEPTED">{pipelineStatusLabels.ACCEPTED}</option>
                    )}
                    {pipelineColumns.map((target) => (
                      <option key={target.key} value={target.moveTo}>
                        {target.title}
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
