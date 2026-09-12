import { useEffect, useState } from "react";
import { AIConnections, AuthSession, Provider, deleteAIConnection, listAIConnections, saveAIConnection } from "../../../app/lib/api";

export function AIConnectionSettings({ session }: { session: AuthSession }) {
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
    listAIConnections(session).then((value) => {
      if (!cancelled) { setData(value); setModel(value.models.OPENAI[0] ?? ""); }
    }).catch(() => { if (!cancelled) setError("AI 연결을 불러오지 못했습니다. 설정을 다시 열어 주세요."); });
    return () => { cancelled = true; };
  }, [session]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setMessage(null);
    const submittedKey = apiKey;
    setApiKey("");
    try {
      const connection = await saveAIConnection(session, provider, model, submittedKey);
      setData((current) => current ? { ...current, connections: [...current.connections.filter((item) => item.provider !== provider), connection] } : current);
      setMessage("키와 모델 접근을 확인해 연결했습니다. 분석 시작 전에 이 연결을 선택해 주세요.");
    } catch {
      setError("연결하지 못했습니다. 키와 선택 모델 접근 권한을 확인하고 다시 입력해 주세요.");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await deleteAIConnection(session, id);
      setData((current) => current ? { ...current, connections: current.connections.filter((item) => item.id !== id) } : current);
      setConfirmDelete(null);
      setMessage("연결을 삭제했습니다. 이 연결을 사용하던 분석은 다음 모델 호출부터 진행할 수 없습니다.");
    } catch { setError("연결을 삭제하지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  return <section id="ai-connections">
    <header><span>04</span><div><h2>AI 연결</h2><p>내 API 키로 분석과 견적 가정 제안을 실행하세요.</p></div></header>
    <p>연결은 현재 작업 공간에서 나만 사용할 수 있습니다. 키는 암호화해 보관하며 다시 표시하지 않습니다.</p>
    <p className="permission-note">개인 키 호출 요금은 제공사 계정에 청구됩니다. 실행 한도는 계속 적용되며, 검색·라우팅 등 서비스 기능은 별도로 작동합니다.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status" className="settings-saved">{message}</p>}
    {!data && !error && <p role="status">연결 확인 중…</p>}
    {data && <>
      <div className="ai-connection-list">{data.connections.length === 0 ? <p>아직 연결한 키가 없습니다. 기본 제공 AI로도 시작할 수 있습니다.</p> : data.connections.map((connection) => <article key={connection.id}>
        <div><strong>{connection.provider} · {connection.model}</strong><p>{connection.maskedKey} · {new Date(connection.updatedAt).toLocaleDateString("ko-KR")} 확인</p></div>
        {confirmDelete === connection.id ? <div><p>이 연결을 삭제할까요? 진행 중인 호출은 취소되지 않습니다.</p><button className="danger-button" disabled={busy} onClick={() => remove(connection.id)}>연결 삭제</button><button className="quiet-button" disabled={busy} onClick={() => setConfirmDelete(null)}>취소</button></div> : <button className="quiet-button" disabled={busy} onClick={() => setConfirmDelete(connection.id)}>삭제</button>}
      </article>)}</div>
      {data.available ? <form className="ai-connection-form" onSubmit={save}>
        <label>제공사<select value={provider} disabled={busy} onChange={(event) => { const next = event.target.value as Provider; setProvider(next); setModel(data.models[next][0] ?? ""); setApiKey(""); }}><option value="OPENAI">OpenAI</option><option value="GEMINI" disabled={!data.models.GEMINI.length}>Gemini{!data.models.GEMINI.length ? " · 준비 중" : ""}</option></select></label>
        <label>모델<select value={model} disabled={busy} onChange={(event) => setModel(event.target.value)}>{data.models[provider].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>API 키<input type="password" autoComplete="off" spellCheck={false} value={apiKey} minLength={16} maxLength={512} required disabled={busy} onChange={(event) => setApiKey(event.target.value)} placeholder="새 키를 입력하세요" /></label>
        <button className="primary-button" disabled={busy || !model || !apiKey}>{busy ? "연결 확인 중…" : data.connections.some((item) => item.provider === provider) ? "확인 후 연결 교체" : "확인 후 연결"}</button>
        <small>모델 접근만 확인합니다. 잔여 크레딧이나 생성 성공을 보장하지 않습니다. 같은 제공사에 등록하면 기존 키와 모델을 교체합니다.</small>
      </form> : <p role="status">개인 키 연결을 준비하고 있습니다. 현재는 기본 제공 AI를 이용해 주세요.</p>}
    </>}
  </section>;
}
