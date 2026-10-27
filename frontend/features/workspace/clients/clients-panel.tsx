import { useT } from "../../../app/lib/ui-language";
import {
  AuthSession,
  Client,
  Project,
  ClientInput,
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
    const frame = requestAnimationFrame(() => {
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
    return () => cancelAnimationFrame(frame);
  }, [draftKey]);

  const updateDrafts = (next: Record<string, ClientDraft>) => {
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
    if ([...clientDraftCache.values()].some((entry) => entry.unavailable && Object.keys(entry.drafts).length)) window.addEventListener("beforeunload", warnClientDraftUnload);
    else window.removeEventListener("beforeunload", warnClientDraftUnload);
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
    setSelected(client);
    setSaved(null);
    setArchiveTarget(null);
    if (window.matchMedia("(max-width: 820px)").matches) {
      requestAnimationFrame(() => editor.current?.scrollIntoView({ block: "start" }));
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || busy || draftConflict) return;
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
      const next = { ...(clientDraftCache.get(draftKey)?.drafts ?? drafts) };
      if (JSON.stringify(next[selectedKey]) === JSON.stringify(drafts[selectedKey])) delete next[selectedKey];
      updateDrafts(next);
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
          {draftConflict && <p className="client-editor-notice" role="alert">{t("다른 곳에서 고객 정보가 변경되었습니다. 초안을 확인한 뒤 버리고 최신 정보를 불러오세요.")}</p>}
          {selectedDraft && (
            <button type="button" className="quiet-button client-discard-draft" disabled={busy} onClick={() => {
              if (!window.confirm(t("저장하지 않은 고객 초안을 버릴까요?"))) return;
              const next = { ...drafts };
              delete next[selectedKey];
              updateDrafts(next);
              if (currentClient) setSelected(currentClient);
              setFormRevision((value) => value + 1);
            }}>{t("초안 버리기")}</button>
          )}
          <form key={`${selectedKey}:${draftsReady}:${formRevision}`} aria-busy={busy} onSubmit={submit} onInput={captureDraft}>
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
                  <button className="primary-button" type="submit" disabled={busy || draftConflict}>
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
