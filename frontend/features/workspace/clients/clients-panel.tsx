import {
  AuthSession,
  Client,
  Project,
  ClientInput,
  updateClient,
  createClient,
  archiveClient
} from "../../../app/lib/api";
import { useState, FormEvent } from "react";
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
}

export function ClientsPanel({ session, clients, projects, permissions, onCreated, onUpdated, onArchived }: ClientsPanelProps) {
  const canWrite = permissions.has("client.write");
  const canDelete = permissions.has("client.delete");
  const [selected, setSelected] = useState<Client | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filtered = clients.filter(
    (client) =>
      !normalizedQuery ||
      [client.name, client.companyName, client.email, client.phone]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("ko-KR").includes(normalizedQuery))
  );

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
        <div>
          <span>CLIENT RELATIONSHIPS</span>
          <h1>문의의 맥락을 고객과 연결합니다.</h1>
          <p>연락처와 메모를 한곳에 두고 새 프로젝트를 기존 고객에게 바로 연결하세요.</p>
        </div>
        {canWrite && (
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setSelected(null);
              setSaved(null);
              setArchiveTarget(null);
            }}
          >
            <Plus size={18} /> 새 고객
          </button>
        )}
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {error}
        </div>
      )}
      {saved && (
        <div className="settings-saved" role="status">
          <CheckCircle size={18} />
          {saved}
        </div>
      )}
      <div className="clients-layout">
        <section className="client-directory" aria-label="고객 목록">
          <label className="client-search">
            <MagnifyingGlass size={18} />
            <span className="sr-only">고객 검색</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름, 회사, 이메일 검색"
            />
          </label>
          <div className="client-list">
            {filtered.length === 0 ? (
              <div className="client-empty">
                <AddressBook size={30} />
                <strong>{clients.length === 0 ? "첫 고객을 등록하세요." : "검색 결과가 없습니다."}</strong>
                <span>고객을 등록하면 프로젝트 생성 시 바로 선택할 수 있습니다.</span>
              </div>
            ) : (
              filtered.map((client) => {
                const linkedCount = projects.filter((project) => project.clientId === client.id).length;
                return (
                  <button
                    type="button"
                    key={client.id}
                    className={selected?.id === client.id ? "active" : ""}
                    onClick={() => {
                      setSelected(client);
                      setSaved(null);
                      setArchiveTarget(null);
                    }}
                  >
                    <span>
                      <strong>{client.name}</strong>
                      <small>{client.companyName || "개인 고객"}</small>
                    </span>
                    <em>{linkedCount}개 프로젝트</em>
                  </button>
                );
              })
            )}
          </div>
        </section>
        <section className="client-editor" aria-labelledby="client-editor-title">
          <header>
            <div>
              <span>{selected ? "고객 정보" : "새 고객"}</span>
              <h2 id="client-editor-title">{selected ? selected.name : "관계를 먼저 기록하세요."}</h2>
            </div>
            {selected && <PencilSimple size={24} />}
          </header>
          <form key={selected?.id ?? "new"} aria-busy={busy} onSubmit={submit}>
            <fieldset className="client-fields" disabled={busy}>
              <div className="form-row">
                <label>
                  담당자 이름
                  <input
                    name="name"
                    required
                    maxLength={120}
                    readOnly={!canWrite}
                    defaultValue={selected?.name ?? ""}
                  />
                </label>
                <label>
                  회사명
                  <input
                    name="companyName"
                    maxLength={160}
                    readOnly={!canWrite}
                    defaultValue={selected?.companyName ?? ""}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  이메일
                  <input
                    name="email"
                    type="email"
                    maxLength={320}
                    readOnly={!canWrite}
                    defaultValue={selected?.email ?? ""}
                  />
                </label>
                <label>
                  전화번호
                  <input
                    name="phone"
                    type="tel"
                    maxLength={40}
                    readOnly={!canWrite}
                    defaultValue={selected?.phone ?? ""}
                  />
                </label>
              </div>
              <label>
                관계 메모
                <textarea
                  name="notes"
                  rows={7}
                  maxLength={5000}
                  readOnly={!canWrite}
                  defaultValue={selected?.notes ?? ""}
                  placeholder="선호하는 소통 방식, 의사결정자, 예산 맥락 등을 기록하세요."
                />
              </label>
              <div className="client-form-actions">
                {canWrite && (
                  <button className="primary-button" type="submit" disabled={busy}>
                    {busy ? <CircleNotch className="spin" /> : <CheckCircle size={18} />}
                    {selected ? "변경 저장" : "고객 등록"}
                  </button>
                )}
                {selected &&
                  canDelete &&
                  (archiveTarget === selected.id ? (
                    <div className="archive-confirm">
                      <span>이 고객을 보관할까요?</span>
                      <button type="button" disabled={busy} onClick={() => void archive(selected)}>
                        보관
                      </button>
                      <button type="button" onClick={() => setArchiveTarget(null)}>
                        취소
                      </button>
                    </div>
                  ) : (
                    <button
                      className="quiet-button danger"
                      type="button"
                      onClick={() => setArchiveTarget(selected.id)}
                    >
                      <Archive size={18} /> 고객 보관
                    </button>
                  ))}
              </div>
            </fieldset>
          </form>
        </section>
      </div>
    </section>
  );
}
