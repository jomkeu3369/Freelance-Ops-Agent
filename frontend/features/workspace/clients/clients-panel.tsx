import { useT } from "../../../app/lib/ui-language";
import {
  AuthSession,
  Client,
  Project,
  ClientInput,
  ApiError,
  readClient,
  updateClient,
  createClient,
  archiveClient
} from "../../../app/lib/api";
import { useState, useEffect, useRef, FormEvent } from "react";
import { pipelineStatusLabels } from "../shared/constants";
import {
  Plus,
  Warning,
  CheckCircle,
  MagnifyingGlass,
  AddressBook,
  PencilSimple,
  CircleNotch,
  Archive
} from "@phosphor-icons/react";

interface ClientsPanelProps {
  session: AuthSession;
  clients: Client[];
  projects: Project[];
  permissions: Set<string>;
  onCreated: (client: Client) => void;
  onUpdated: (client: Client) => void;
  onArchived: (clientId: string) => void;
  onOpenProject: (project: Project) => void;
}

type ClientDraft = { name: string; companyName: string; email: string; phone: string; notes: string; baseVersion: number | null };
const clientDraftCache = new Map<string, { drafts: Record<string, ClientDraft>; unavailable: boolean }>();
const clientDraftListeners = new Map<string, Set<(drafts: Record<string, ClientDraft>, unavailable: boolean, updated?: Client, sourceKey?: string) => void>>();
const clientConflictCache = new Map<string, Set<string>>();
const clientConflictListeners = new Map<string, Set<(ids: Set<string>) => void>>();
const warnClientDraftUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  event.returnValue = "";
};

export function ClientsPanel({ session, clients, projects, permissions, onCreated, onUpdated, onArchived, onOpenProject }: ClientsPanelProps) {
  const t = useT();
  const canWrite = permissions.has("client.write");
  const canDelete = permissions.has("client.delete");
  const [selected, setSelected] = useState<Client | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set());
  const [latestClient, setLatestClient] = useState<Client | null>(null);
  const [checkingLatest, setCheckingLatest] = useState(false);
  const lookupRevision = useRef(0);
  const [drafts, setDrafts] = useState<Record<string, ClientDraft>>({});
  const [draftsReady, setDraftsReady] = useState(false);
  const [draftUnavailable, setDraftUnavailable] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const editor = useRef<HTMLElement>(null);
  const draftKey = `freelance-ops-client-drafts-v1:${encodeURIComponent(session.userId)}:${encodeURIComponent(session.workspaceId)}`;
  const selectedKey = selected?.id ?? "new";
  const selectedDraft = drafts[selectedKey];
  const currentClient = selected ? clients.find((client) => client.id === selected.id) : null;
  const draftConflict = Boolean(selected && selectedDraft && currentClient && selectedDraft.baseVersion !== currentClient.version);
  const hasConflict = Boolean(selected && (draftConflict || conflictIds.has(selected.id)));
  const linkedProjects = selected ? projects.filter((project) => project.clientId === selected.id) : [];
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filtered = clients.filter(
    (client) =>
      !normalizedQuery ||
      [client.name, client.companyName, client.email, client.phone]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("ko-KR").includes(normalizedQuery))
  );

  useEffect(() => {
    const listeners = clientDraftListeners.get(draftKey) ?? new Set();
    const syncDrafts = (next: Record<string, ClientDraft>, unavailable: boolean, updated?: Client, sourceKey?: string) => {
      setDrafts(next);
      setDraftUnavailable(unavailable);
      if (updated && sourceKey && !next[sourceKey]) setSelected((current) => (sourceKey === "new" ? current === null : current?.id === sourceKey) ? updated : current);
    };
    listeners.add(syncDrafts);
    clientDraftListeners.set(draftKey, listeners);
    const conflictListeners = clientConflictListeners.get(draftKey) ?? new Set();
    conflictListeners.add(setConflictIds);
    clientConflictListeners.set(draftKey, conflictListeners);
    const frame = requestAnimationFrame(() => {
      setConflictIds(new Set(clientConflictCache.get(draftKey) ?? []));
      const cached = clientDraftCache.get(draftKey);
      if (cached) {
        setDrafts(cached.drafts);
        setDraftUnavailable(cached.unavailable);
        setDraftsReady(true);
        return;
      }
      try {
        const value = JSON.parse(sessionStorage.getItem(draftKey) ?? "{}");
        if (value && typeof value === "object" && !Array.isArray(value)) setDrafts(value);
      } catch {
        setDraftUnavailable(true);
      }
      setDraftsReady(true);
    });
    return () => {
      lookupRevision.current += 1;
      cancelAnimationFrame(frame);
      listeners.delete(syncDrafts);
      if (listeners.size === 0) clientDraftListeners.delete(draftKey);
      conflictListeners.delete(setConflictIds);
      if (conflictListeners.size === 0) clientConflictListeners.delete(draftKey);
    };
  }, [draftKey]);

  const updateDrafts = (next: Record<string, ClientDraft>, updated?: Client, sourceKey?: string) => {
    setDrafts(next);
    let unavailable = false;
    try {
      if (Object.keys(next).length) sessionStorage.setItem(draftKey, JSON.stringify(next));
      else sessionStorage.removeItem(draftKey);
    } catch {
      unavailable = true;
    }
    setDraftUnavailable(unavailable);
    clientDraftCache.set(draftKey, { drafts: next, unavailable });
    clientDraftListeners.get(draftKey)?.forEach((listener) => listener(next, unavailable, updated, sourceKey));
    if ([...clientDraftCache.values()].some((entry) => entry.unavailable && Object.keys(entry.drafts).length)) window.addEventListener("beforeunload", warnClientDraftUnload);
    else window.removeEventListener("beforeunload", warnClientDraftUnload);
  };

  const setConflict = (clientId: string, present: boolean) => {
    const next = new Set(clientConflictCache.get(draftKey) ?? []);
    if (present) next.add(clientId);
    else next.delete(clientId);
    if (next.size) clientConflictCache.set(draftKey, next);
    else clientConflictCache.delete(draftKey);
    clientConflictListeners.get(draftKey)?.forEach((listener) => listener(next));
  };

  const captureDraft = (event: FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const draft = { ...Object.fromEntries(["name", "companyName", "email", "phone", "notes"].map((name) => [name, String(data.get(name) ?? "")])), baseVersion: selectedDraft?.baseVersion ?? selected?.version ?? null } as ClientDraft;
    const original = { name: selected?.name ?? "", companyName: selected?.companyName ?? "", email: selected?.email ?? "", phone: selected?.phone ?? "", notes: selected?.notes ?? "" };
    const next = { ...drafts };
    if (Object.keys(original).every((name) => draft[name as keyof typeof original] === original[name as keyof typeof original])) delete next[selectedKey];
    else next[selectedKey] = draft;
    updateDrafts(next);
  };

  const selectClient = (client: Client | null) => {
    if (busy) return;
    lookupRevision.current += 1;
    setCheckingLatest(false);
    setLatestClient(null);
    setSelected(client);
    setSaved(null);
    setArchiveTarget(null);
    if (window.matchMedia("(max-width: 820px)").matches) {
      requestAnimationFrame(() => editor.current?.scrollIntoView({ block: "start" }));
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || busy || hasConflict) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const nullable = (name: string) => String(data.get(name) ?? "").trim() || null;
    const input: ClientInput = {
      name: String(data.get("name") ?? "").trim(),
      companyName: nullable("companyName"),
      email: nullable("email"),
      phone: nullable("phone"),
      notes: nullable("notes")
    };
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      let savedClient: Client;
      if (selected) {
        const updated = await updateClient(session, selected.id, input, selectedDraft?.baseVersion ?? selected.version);
        savedClient = updated;
        onUpdated(updated);
        setSelected(updated);
        setSaved("고객 정보가 저장되었습니다.");
      } else {
        const created = await createClient(session, input);
        savedClient = created;
        onCreated(created);
        setSelected(created);
        setSaved("새 고객이 등록되었습니다. 이제 프로젝트에 연결할 수 있습니다.");
      }
      const next = { ...(clientDraftCache.get(draftKey)?.drafts ?? drafts) };
      if (JSON.stringify(next[selectedKey]) === JSON.stringify(drafts[selectedKey])) {
        delete next[selectedKey];
        if (selected) setConflict(selected.id, false);
      }
      updateDrafts(next, savedClient, selectedKey);
    } catch (cause) {
      if (selected && cause instanceof ApiError && cause.status === 409 && cause.code === "CONCURRENT_MODIFICATION") {
        setConflict(selected.id, true);
        setLatestClient(null);
        setError(null);
      } else {
        setError(cause instanceof Error ? cause.message : "고객 정보를 저장하지 못했습니다.");
      }
    } finally {
      setBusy(false);
    }
  };

  const loadLatest = async () => {
    if (!selected || checkingLatest || busy) return;
    const revision = ++lookupRevision.current;
    setCheckingLatest(true);
    setError(null);
    try {
      const latest = await readClient(session, selected.id);
      if (revision !== lookupRevision.current) return;
      setLatestClient(latest);
      if (latest.status === "ACTIVE") onUpdated(latest);
    } catch {
      if (revision === lookupRevision.current) setError("최신 고객 정보를 불러오지 못했습니다. 초안은 유지됩니다. 다시 시도해 주세요.");
    } finally {
      if (revision === lookupRevision.current) setCheckingLatest(false);
    }
  };

  const archive = async (client: Client) => {
    setBusy(true);
    setError(null);
    try {
      await archiveClient(session, client.id);
      setConflict(client.id, false);
      onArchived(client.id);
      setSelected(null);
      setArchiveTarget(null);
      const next = { ...(clientDraftCache.get(draftKey)?.drafts ?? drafts) };
      if (JSON.stringify(next[client.id]) === JSON.stringify(drafts[client.id])) delete next[client.id];
      updateDrafts(next);
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
        <div>
          <h1>{t("고객 관리")}</h1>
          <p>{t("연락처와 메모를 한곳에 두고 새 프로젝트를 기존 고객에게 바로 연결하세요.")}</p>
        </div>
        {canWrite && (
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => selectClient(null)}
          >
            <Plus size={18} /> {t("새 고객")}
          </button>
        )}
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {t(error)}
        </div>
      )}
      {saved && (
        <div className="settings-saved" role="status">
          <CheckCircle size={18} />
          {t(saved)}
        </div>
      )}
      <div className="clients-layout">
        <section className="client-directory" aria-label={t("고객 목록")}>
          <label className="client-search">
            <MagnifyingGlass size={18} />
            <span className="sr-only">{t("고객 검색")}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("이름, 회사, 이메일 검색")}
            />
          </label>
          <div className="client-list">
            {filtered.length === 0 ? (
              <div className="client-empty">
                <AddressBook size={30} />
                <strong>{clients.length === 0 ? t("첫 고객을 등록하세요.") : t("검색 결과가 없습니다.")}</strong>
                <span>
                  {clients.length === 0
                    ? t("고객을 등록하면 새 문의에 바로 연결할 수 있습니다.")
                    : t("다른 검색어로 찾아보세요.")}
                </span>
              </div>
            ) : (
              filtered.map((client) => {
                const linkedCount = projects.filter((project) => project.clientId === client.id).length;
                return (
                  <button
                    type="button"
                    key={client.id}
                    className={selected?.id === client.id ? "active" : ""}
                    aria-pressed={selected?.id === client.id}
                    disabled={busy}
                    onClick={() => selectClient(client)}
                  >
                    <span>
                      <strong>{client.name}</strong>
                      <small>{client.companyName || t("개인 고객")}</small>
                    </span>
                    <em>
                      {linkedCount}
                      {t("개 프로젝트")}
                    </em>
                  </button>
                );
              })
            )}
          </div>
        </section>
        <section className="client-editor" aria-labelledby="client-editor-title" ref={editor}>
          <header>
            <div>
              <span>{selected ? t("고객 정보") : t("새 고객")}</span>
              <h2 id="client-editor-title">{selected ? selected.name : t("관계를 먼저 기록하세요.")}</h2>
            </div>
            {selected && <PencilSimple size={24} />}
          </header>
          {selected && normalizedQuery && !filtered.some((client) => client.id === selected.id) && (
            <p className="client-editor-notice" role="status">{t("현재 편집 중인 고객은 검색 결과에 없습니다.")}</p>
          )}
          {selectedDraft && <p className="client-editor-notice" role="status">{t(draftUnavailable ? "초안을 브라우저에 보관하지 못했습니다. 새로고침하기 전에 저장해 주세요." : "저장하지 않은 입력을 이 탭에 보관 중입니다.")}</p>}
          {hasConflict && (
            <section className="client-conflict" aria-labelledby="client-conflict-title">
              <p id="client-conflict-title" role="alert">{t("다른 곳에서 고객 정보가 변경되어 저장하지 않았습니다. 현재 입력은 유지됩니다.")}</p>
              <button type="button" className="quiet-button" disabled={checkingLatest || busy} onClick={() => void loadLatest()}>
                {checkingLatest ? t("불러오는 중...") : t("최신 고객 정보 확인")}
              </button>
              {latestClient && (
                <div className="client-conflict-latest">
                  <h3>{t("현재 입력과 최신 정보 비교")}</h3>
                  {latestClient.status !== "ACTIVE" && <p>{t("이 고객은 보관되어 더 이상 수정할 수 없습니다.")}</p>}
                  <dl>
                    {[["담당자 이름", selectedDraft?.name ?? selected?.name, latestClient.name], ["회사명", selectedDraft?.companyName ?? selected?.companyName, latestClient.companyName], ["이메일", selectedDraft?.email ?? selected?.email, latestClient.email], ["전화번호", selectedDraft?.phone ?? selected?.phone, latestClient.phone], ["관계 메모", selectedDraft?.notes ?? selected?.notes, latestClient.notes]].map(([label, draft, latest]) => (
                      <div key={label}>
                        <dt>{t(label)}</dt>
                        <dd><span><small>{t("현재 입력")}</small>{draft || t("없음")}</span><span><small>{t("최신 저장")}</small>{latest || t("없음")}</span></dd>
                      </div>
                    ))}
                  </dl>
                  {latestClient.status === "ACTIVE" && (
                    <button type="button" className="quiet-button" disabled={busy} onClick={() => {
                      if (selectedDraft && !window.confirm(t("현재 입력으로 최신 고객 정보를 덮어쓸 수 있습니다. 두 내용을 비교했으며 이 초안을 최신 버전에서 계속 편집할까요?"))) return;
                      if (selectedDraft) updateDrafts({ ...drafts, [selectedKey]: { ...selectedDraft, baseVersion: latestClient.version } });
                      setSelected(latestClient);
                      if (selected) setConflict(selected.id, false);
                      setLatestClient(null);
                      setFormRevision((value) => value + 1);
                    }}>{t(selectedDraft ? "비교 후 초안 계속 편집" : "최신 고객 정보로 열기")}</button>
                  )}
                </div>
              )}
            </section>
          )}
          {selectedDraft && (
            <button type="button" className="quiet-button client-discard-draft" disabled={busy} onClick={() => {
              if (!window.confirm(t("저장하지 않은 고객 초안을 버릴까요?"))) return;
              const next = { ...drafts };
              delete next[selectedKey];
              updateDrafts(next);
              if (currentClient && latestClient?.status !== "ARCHIVED") setSelected(currentClient);
              if (selected && latestClient?.status !== "ARCHIVED") setConflict(selected.id, false);
              if (latestClient?.status !== "ARCHIVED") setLatestClient(null);
              setFormRevision((value) => value + 1);
            }}>{t("초안 버리기")}</button>
          )}
          <form key={`${selectedKey}:${selected?.version ?? "new"}:${draftsReady}:${formRevision}`} aria-busy={busy} onSubmit={submit} onInput={captureDraft}>
            <fieldset className="client-fields" disabled={busy || !draftsReady}>
              <div className="form-row">
                <label>
                  {t("담당자 이름")}
                  <input
                    name="name"
                    required
                    maxLength={120}
                    readOnly={!canWrite}
                    defaultValue={selectedDraft?.name ?? selected?.name ?? ""}
                  />
                </label>
                <label>
                  {t("회사명")}
                  <input
                    name="companyName"
                    maxLength={160}
                    readOnly={!canWrite}
                    defaultValue={selectedDraft?.companyName ?? selected?.companyName ?? ""}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  {t("이메일")}
                  <input
                    name="email"
                    type="email"
                    maxLength={320}
                    readOnly={!canWrite}
                    defaultValue={selectedDraft?.email ?? selected?.email ?? ""}
                  />
                </label>
                <label>
                  {t("전화번호")}
                  <input
                    name="phone"
                    type="tel"
                    maxLength={40}
                    readOnly={!canWrite}
                    defaultValue={selectedDraft?.phone ?? selected?.phone ?? ""}
                  />
                </label>
              </div>
              <label>
                {t("관계 메모")}
                <textarea
                  name="notes"
                  rows={7}
                  maxLength={5000}
                  readOnly={!canWrite}
                  defaultValue={selectedDraft?.notes ?? selected?.notes ?? ""}
                  placeholder={t("선호하는 소통 방식, 의사결정자, 예산 맥락 등을 기록하세요.")}
                />
              </label>
              <div className="client-form-actions">
                {canWrite && (
                  <button className="primary-button" type="submit" disabled={busy || hasConflict}>
                    {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />}
                    {selected ? t("변경 저장") : t("고객 등록")}
                  </button>
                )}
                {selected &&
                  canDelete &&
                  (archiveTarget === selected.id ? (
                    <div className="archive-confirm">
                      <span>{t(selectedDraft ? "저장하지 않은 변경은 보관되지 않습니다. 이 고객을 보관할까요?" : "이 고객을 보관할까요?")}</span>
                      <button type="button" disabled={busy} onClick={() => void archive(selected)}>
                        {t("보관")}
                      </button>
                      <button type="button" onClick={() => setArchiveTarget(null)}>
                        {t("취소")}
                      </button>
                    </div>
                  ) : (
                    <button className="quiet-button danger" type="button" onClick={() => setArchiveTarget(selected.id)}>
                      <Archive size={18} /> {t("고객 보관")}
                    </button>
                  ))}
              </div>
            </fieldset>
          </form>
          {selected && linkedProjects.length > 0 && (
            <section className="client-projects" aria-labelledby="client-projects-title">
              <h3 id="client-projects-title">{t("연결된 프로젝트")}</h3>
              <ul>
                {linkedProjects.map((project) => (
                  <li key={project.id}>
                    <button type="button" disabled={busy} onClick={() => onOpenProject(project)}>
                      <span>{project.title}</span>
                      <small>{t(pipelineStatusLabels[project.status] ?? project.status)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      </div>
    </section>
  );
}
