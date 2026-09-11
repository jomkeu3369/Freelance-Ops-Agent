import { prepareDocumentUpload, sourceTypeLabel } from "../shared/documents";
import {
  KnowledgeDocument,
  createDocument,
  AuthSession,
  listDocuments,
  getDocument,
  archiveDocument
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
      if (!cancelled) setDetail(null);
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
      setNotice("자료를 저장했습니다. 다음 AI 분석부터 참고 자료로 활용됩니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "자료를 업로드하지 못했습니다.");
    } finally {
      setUploading(false);
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
          <p>과거 프로젝트와 정책, 약관을 등록하고 이번 분석에 활용할 자료를 직접 선택할 수 있습니다.</p>
        </div>
        {canWrite && (
          <label className="primary-button">
            {uploading ? <CircleNotch className="spin" /> : <Plus size={18} />} 자료 업로드
            <input
              type="file"
              accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json"
              disabled={uploading}
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
                className={selectedId === document.id ? "active" : ""}
                onClick={() => {
                  setSelectedId(document.id);
                  setArchiveTarget(null);
                  setNotice(null);
                }}
              >
                <span className="document-type">{sourceTypeLabel[document.sourceType]}</span>
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
              <p>문서의 provenance와 실제 저장 청크를 확인할 수 있습니다.</p>
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
                  <dd>{detail.status}</dd>
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
              <section className="document-chunks">
                <div>
                  <h3>저장된 내용</h3>
                  <span>{detail.chunks.length}개 청크</span>
                </div>
                {detail.chunks.length === 0 ? (
                  <p>표시할 청크가 없습니다.</p>
                ) : (
                  detail.chunks.slice(0, 4).map((chunk) => (
                    <article key={chunk.id}>
                      <span>청크 {chunk.chunkIndex + 1}</span>
                      <p>{chunk.content.length > 900 ? `${chunk.content.slice(0, 900)}…` : chunk.content}</p>
                    </article>
                  ))
                )}
              </section>
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
