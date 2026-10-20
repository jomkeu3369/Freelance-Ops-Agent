import { useT, useUiLocale } from "../../../app/lib/ui-language";
import { useEffect, useState } from "react";
import { CircleNotch, Info, Key, LockSimple, Plug, Shield, Trash, User } from "@phosphor-icons/react";
import {
  AIConnections,
  AuthSession,
  Provider,
  isSupportedProvider,
  deleteAIConnection,
  listAIConnections,
  saveAIConnection
} from "../../../app/lib/api";

export function AIConnectionSettings({ session }: { session: AuthSession }) {
  const t = useT();
  const locale = useUiLocale();
  const [data, setData] = useState<AIConnections | null>(null);
  const [provider, setProvider] = useState<Provider>("OPENAI");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAIConnections(session)
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setModel(value.models.OPENAI[0] ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) setError("AI 연결을 불러오지 못했습니다. 설정을 다시 열어 주세요.");
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const submittedKey = apiKey;
    setApiKey("");
    try {
      const connection = await saveAIConnection(session, provider, model, submittedKey);
      setData((current) =>
        current
          ? {
              ...current,
              connections: [...current.connections.filter((item) => item.provider !== provider), connection]
            }
          : current
      );
      setMessage("키와 모델 접근을 확인해 연결했습니다. 분석 시작 전에 이 연결을 선택해 주세요.");
    } catch {
      setError("연결하지 못했습니다. 키와 선택 모델 접근 권한을 확인하고 다시 입력해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await deleteAIConnection(session, id);
      setData((current) =>
        current ? { ...current, connections: current.connections.filter((item) => item.id !== id) } : current
      );
      setConfirmDelete(null);
      setMessage("연결을 삭제했습니다. 이 연결을 사용하던 분석은 다음 모델 호출부터 진행할 수 없습니다.");
    } catch {
      setError("연결을 삭제하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const connectionState = !data
    ? error ? "error" : "loading"
    : !data.available ? "unavailable" : data.connections.length ? "registered" : "empty";
  const connectionLabel = !data
    ? error ? t("연결 확인 필요") : t("연결 확인 중…")
    : !data.available ? t("지금은 연결을 등록할 수 없습니다")
      : data.connections.length ? t("등록된 연결 {count}개", { count: data.connections.length }) : t("아직 연결된 키가 없습니다");

  return (
    <section id="ai-connections" className="ai-connection-card" aria-labelledby="ai-connections-title">
      <header className="ai-connection-header">
        <div className="ai-connection-heading">
          <span className="ai-connection-icon">
            <Plug size={28} aria-hidden="true" />
          </span>
          <div>
            <h2 id="ai-connections-title">{t("AI 연결")}</h2>
            <p>{t("내 OpenAI 키로 텍스트와 프로젝트를 분석하세요.")}</p>
          </div>
        </div>
        <p className="ai-connection-status" data-state={connectionState}>
          <span aria-hidden="true" />{connectionLabel}
        </p>
      </header>

      <div className="ai-connection-layout">
        <div className="ai-connection-editor">
          {error && (
            <p role="alert" className="form-error ai-connection-feedback">{t(error)}</p>
          )}
          {message && (
            <p role="status" className="settings-saved ai-connection-feedback">{t(message)}</p>
          )}
          {!data && !error && (
            <p role="status" className="ai-connection-state">
              <CircleNotch size={22} className="spin" aria-hidden="true" />{t("연결 확인 중…")}
            </p>
          )}
          {data && (
            <>
              {data.connections.length > 0 && (
                <div className="ai-connection-list">
                  <h3>{t("등록된 연결")}</h3>
                  {data.connections.map((connection) => (
                    <article key={connection.id}>
                      <div className="ai-connection-record">
                        <Plug size={20} aria-hidden="true" />
                        <div>
                          <strong>{connection.provider} · {connection.model}</strong>
                          <p>
                            {connection.maskedKey} · {new Date(connection.updatedAt).toLocaleDateString(locale === "en" ? "en-US" : "ko-KR")} {t("확인")}
                          </p>
                          {!isSupportedProvider(connection.provider) && (
                            <p className="ai-connection-retired">{t("지원이 종료된 연결입니다. 새 실행에 사용할 수 없습니다.")}</p>
                          )}
                        </div>
                      </div>
                      {confirmDelete === connection.id ? (
                        <div className="ai-connection-delete-confirm">
                          <p>{t("이 연결을 삭제할까요? 진행 중인 호출은 취소되지 않습니다.")}</p>
                          <div>
                            <button type="button" className="danger-button" disabled={busy} onClick={() => remove(connection.id)}>
                              {t("연결 삭제")}
                            </button>
                            <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirmDelete(null)}>
                              {t("취소")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="quiet-button ai-connection-remove" disabled={busy} onClick={() => setConfirmDelete(connection.id)}>
                          <Trash size={17} aria-hidden="true" />{t("삭제")}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {data.available ? (
                <form className="ai-connection-form" aria-busy={busy} onSubmit={save}>
                  <label>
                    {t("제공사")}
                    <select
                      value={provider}
                      disabled={busy}
                      onChange={(event) => {
                        const next = event.target.value as Provider;
                        setProvider(next);
                        setModel(data.models[next][0] ?? "");
                        setApiKey("");
                      }}
                    >
                      <option value="OPENAI">OpenAI</option>
                    </select>
                  </label>
                  <label>
                    {t("모델")}
                    <select value={model} disabled={busy} onChange={(event) => setModel(event.target.value)}>
                      {data.models[provider].map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="ai-connection-key-label">
                    {t("API 키")}
                    <span className="ai-connection-key-field">
                      <Key size={21} aria-hidden="true" />
                      <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={apiKey}
                        minLength={16}
                        maxLength={512}
                        required
                        disabled={busy}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={t("새 키를 입력하세요")}
                      />
                    </span>
                  </label>
                  <button type="submit" className="primary-button ai-connection-submit" disabled={busy || !model || !apiKey}>
                    {busy && <CircleNotch size={20} className="spin" aria-hidden="true" />}
                    {busy
                      ? t("연결 확인 중…")
                      : data.connections.some((item) => item.provider === provider)
                        ? t("확인 후 연결 교체")
                        : t("확인 후 연결")}
                  </button>
                  <small className="ai-connection-form-note">
                    <span>{t("모델 접근만 확인하며, 잔여 크레딧이나 생성 성공을 보장하지 않습니다.")}</span>
                    <span>{t("같은 제공사에 등록하면 기존 키와 모델을 교체합니다.")}</span>
                  </small>
                </form>
              ) : (
                <p role="status" className="ai-connection-state">
                  {t("현재 개인 키 연결을 사용할 수 없습니다. 연결 상태를 다시 확인해 주세요. 다른 AI로 자동 전환하지 않습니다.")}
                </p>
              )}
            </>
          )}
        </div>
        <aside className="ai-connection-guide" aria-labelledby="ai-connection-guide-title">
          <div className="ai-connection-guide-heading">
            <LockSimple size={26} aria-hidden="true" />
            <h3 id="ai-connection-guide-title">{t("개인 키 안내")}</h3>
          </div>
          <ul>
            <li>
              <User size={21} aria-hidden="true" /><span>{t("이 작업 공간에서 나만 사용할 수 있습니다.")}</span>
            </li>
            <li>
              <Shield size={21} aria-hidden="true" /><span>{t("키는 암호화해 보관하며 다시 표시하지 않습니다.")}</span>
            </li>
          </ul>
          <p>{t("개인 키를 연결하거나 기본 제공 AI의 사용 가능 상태를 확인해 주세요.")}</p>
        </aside>
      </div>
      <div className="ai-connection-billing">
        <Info size={26} aria-hidden="true" />
        <div>
          <strong>{t("개인 키 호출 요금은 제공사 계정에 청구됩니다.")}</strong>
          <p>
            <span>{t("로컬 라우팅·키워드 자료 조회 지원")}</span>
            <span>{t("유료 웹 검색·임베딩·별도 AI 생성은 지원하지 않습니다.")}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
