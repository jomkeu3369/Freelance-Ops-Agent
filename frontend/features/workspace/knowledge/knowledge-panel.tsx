import { prepareDocumentUpload, sourceTypeLabel } from "../shared/documents";
import {
  KnowledgeDocument,
  createDocument,
  AuthSession,
  listDocuments,
  getDocument,
  archiveDocument,
  confirmDocument
} from "../../../app/lib/api";
import { useState, useEffect } from "react";
import {
  CircleNotch,
  Plus,
  Warning,
  CheckCircle,
  MagnifyingGlass,
  FileText,
  Archive
} from "@phosphor-icons/react";





interface KnowledgePanelProps {
  session: AuthSession;
  permissions: Set<string>;
}

export function KnowledgePanel({ session, permissions }: KnowledgePanelProps) {
  const canWrite = permissions.has("document.write");
  const canDelete = permissions.has("document.delete");
  const canIndex = permissions.has("agent.run");
  const [reviewed, setReviewed] = useState(false);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KnowledgeDocument | null>(null);
  const [query, setQuery] = useState("");
  const [sourceType, setSourceType] = useState<"ALL" | KnowledgeDocument["sourceType"]>("ALL");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDocuments(session)
      .then((result) => {
        if (!cancelled) {
          setDocuments(result);
          setSelectedId(result[0]?.id ?? null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "근거 자료를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!selectedId) {
      Promise.resolve().then(() => setDetail(null));
      return;
    }
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setDetail(null);
        setReviewed(false);
      }
    });
    getDocument(session, selectedId)
      .then((document) => {
        if (!cancelled) setDetail(document);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "문서 내용을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, session]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filtered = documents.filter((document) => {
    if (sourceType !== "ALL" && document.sourceType !== sourceType) return false;
    return (
      !normalizedQuery ||
      [document.title, document.jurisdiction, document.sourceVersion]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("ko-KR").includes(normalizedQuery))
    );
  });

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const document = await createDocument(session, await prepareDocumentUpload(file, "USER_TEMPLATE"));
      setDocuments((current) => [document, ...current]);
      setSelectedId(document.id);
      setDetail(document);
      setReviewed(false);
      setNotice("자료를 저장했습니다. 내용을 검토하고 확인한 뒤 다음 AI 분석의 참고 자료로 사용할 수 있습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자료를 업로드하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const confirm = async () => {
    if (!detail || detail.id !== selectedId || !reviewed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmDocument(session, detail);
      const nextDocuments = await listDocuments(session);
      setDocuments(nextDocuments);
      setDetail(result.document);
      setReviewed(false);
      setNotice(result.indexStatus === "INDEXED"
        ? "확인한 문서를 검색 색인에 반영했습니다. 다음 분석부터 원문과 함께 참고합니다."
        : result.indexStatus === "PENDING"
          ? "문서 확인은 저장됐지만 벡터 색인은 완료되지 않았습니다. 현재는 키워드 검색만 가능하며, 아래에서 색인을 다시 시도할 수 있습니다."
          : "문서 확인을 저장했습니다. 키워드 검색의 참고 자료로 사용됩니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "문서 확인을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const archive = async (documentId: string) => {
    setBusy(true);
    setError(null);
    try {
      await archiveDocument(session, documentId);
      const remaining = documents.filter((document) => document.id !== documentId);
      setDocuments(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDetail(null);
      setArchiveTarget(null);
      setNotice("자료를 보관했습니다. 다음 AI 분석부터 참고 대상에서 제외됩니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자료를 보관하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="knowledge-page">
      <div className="knowledge-heading">
        <div>
          <span>근거 자료</span>
          <h1>분석에 사용할 자료를 모아두세요.</h1>
          <p>AI가 정리한 요구사항과 업로드 자료를 원문과 비교하세요. 확인한 문서만 다음 분석에서 참고합니다.</p>
        </div>
        {canWrite && (
          <label className="primary-button">
            {uploading ? <CircleNotch className="spin" /> : <Plus size={18} />} 자료 업로드
            <input
              type="file"
              accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json"
              disabled={uploading || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        )}
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <Warning size={18} />
          {error}
        </div>
      )}
      {notice && (
        <div className="settings-saved" role="status">
          <CheckCircle size={18} />
          {notice}
        </div>
      )}
      <div className="knowledge-toolbar">
        <label>
          <MagnifyingGlass size={18} />
          <span className="sr-only">근거 자료 검색</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="제목, 관할권, 버전 검색"
          />
        </label>
        <select
          aria-label="자료 유형 필터"
          value={sourceType}
          onChange={(event) => setSourceType(event.target.value as typeof sourceType)}
        >
          <option value="ALL">모든 자료 유형</option>
          {Object.entries(sourceTypeLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span>
          {filtered.length} / {documents.length}개 자료
        </span>
      </div>
      <div className="knowledge-layout">
        <section className="knowledge-list" aria-label="근거 자료 목록">
          {loading ? (
            <div className="section-loading">
              <CircleNotch className="spin" /> 자료를 확인하고 있습니다.
            </div>
          ) : filtered.length === 0 ? (
            <div className="client-empty">
              <FileText size={30} />
              <strong>
                {documents.length === 0 ? "저장된 자료가 없습니다." : "조건에 맞는 자료가 없습니다."}
              </strong>
              <span>텍스트 자료를 추가하면 AI 분석에서 필요한 내용을 찾아 활용할 수 있습니다.</span>
            </div>
          ) : (
            filtered.map((document) => (
              <button
                type="button"
                key={document.id}
                disabled={busy}
                className={selectedId === document.id ? "active" : ""}
                onClick={() => {
                  setSelectedId(document.id);
                  setArchiveTarget(null);
                  setNotice(null);
                }}
              >
                <span className="document-type">{document.origin === "agent" ? "AI 생성" : sourceTypeLabel[document.sourceType]} · {document.confirmationStatus === "confirmed" ? "확인됨" : document.confirmationStatus === "superseded" ? "이전 버전" : "검토 필요"}</span>
                <strong>{document.title}</strong>
                <small>
                  {document.jurisdiction ?? "관할권 미지정"} ·{" "}
                  {new Date(document.createdAt).toLocaleDateString("ko-KR")}
                </small>
              </button>
            ))
          )}
        </section>
        <article className="knowledge-detail">
          {!selectedId ? (
            <div className="knowledge-empty">
              <FileText size={34} />
              <h2>검토할 자료를 선택하세요.</h2>
              <p>자료의 출처와 견적에 참고할 내용을 확인할 수 있습니다.</p>
            </div>
          ) : !detail ? (
            <div className="section-loading">
              <CircleNotch className="spin" /> 문서 내용을 불러오고 있습니다.
            </div>
          ) : (
            <>
              <header>
                <div>
                  <span>{sourceTypeLabel[detail.sourceType]}</span>
                  <h2>{detail.title}</h2>
                </div>
                <code>{detail.contentSha256.slice(0, 12)}</code>
              </header>
              <dl>
                <div>
                  <dt>상태</dt>
                  <dd>{detail.confirmationStatus === "confirmed" ? "사용자 확인됨" : detail.confirmationStatus === "superseded" ? "원문 변경 또는 새 버전으로 대체됨" : "미확인 · 검색 제외"}</dd>
                </div>
                <div>
                  <dt>관할권</dt>
                  <dd>{detail.jurisdiction ?? "미지정"}</dd>
                </div>
                <div>
                  <dt>버전</dt>
                  <dd>{detail.sourceVersion ?? "미지정"}</dd>
                </div>
                <div>
                  <dt>유효 기간</dt>
                  <dd>
                    {detail.effectiveFrom || detail.effectiveUntil
                      ? `${detail.effectiveFrom ?? "시작 미정"} – ${detail.effectiveUntil ?? "종료 미정"}`
                      : "미지정"}
                  </dd>
                </div>
              </dl>
              {detail.sourceUri && (
                <p className="document-origin">
                  <span>출처 위치</span>
                  <code>{detail.sourceUri}</code>
                </p>
              )}
              {detail.sourceMessages.length > 0 && (
                <section className="document-chunks">
                  <h3>근거가 된 사용자 원문</h3>
                  {detail.sourceMessages.map((source) => (
                    <article key={source.id}>
                      <small>{source.kind} · {source.id}</small>
                      {source.prompt && <p>AI 질문: {source.prompt}</p>}
                      <p style={{ whiteSpace: "pre-wrap" }}>{source.content}</p>
                    </article>
                  ))}
                </section>
              )}
              <section className="document-chunks">
                <div>
                  <h3>저장된 내용</h3>
                  <span>{detail.chunks.length}개 내용 구간</span>
                </div>
                {detail.chunks.length === 0 ? (
                  <p>표시할 자료 내용이 없습니다.</p>
                ) : (
                  detail.chunks.map((chunk) => (
                    <article key={chunk.id}>
                      <span>내용 {chunk.chunkIndex + 1}</span>
                      <p style={{ whiteSpace: "pre-wrap" }}>{chunk.content}</p>
                    </article>
                  ))
                )}
              </section>
              {canWrite && (!detail.projectId || canIndex) && detail.confirmationStatus !== "superseded" && (
                <section className="document-chunks">
                  <p>원문에 없는 가정과 미결 질문은 확인된 요구사항으로 취급하지 않습니다. 원문과 다른 내용은 요구사항을 수정한 뒤 다시 분석하세요.</p>
                  <label>
                    <input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} />
                    원문과 문서 전체를 검토했으며 다음 분석의 참고 자료로 사용하는 데 동의합니다.
                  </label>
                  <button type="button" className="primary-button" disabled={busy || !reviewed} onClick={() => void confirm()}>
                    {busy ? "반영 중…" : detail.retrievalEligible ? "확인 및 색인 재시도" : "확인하고 참고 자료로 사용"}
                  </button>
                </section>
              )}
              {canDelete && (
                <footer>
                  {archiveTarget === detail.id ? (
                    <div className="archive-confirm">
                      <span>이 자료를 검색 범위에서 제외할까요?</span>
                      <button type="button" disabled={busy} onClick={() => void archive(detail.id)}>
                        보관
                      </button>
                      <button type="button" onClick={() => setArchiveTarget(null)}>
                        취소
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="quiet-button danger"
                      onClick={() => setArchiveTarget(detail.id)}
                    >
                      <Archive size={18} /> 자료 보관
                    </button>
                  )}
                </footer>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
