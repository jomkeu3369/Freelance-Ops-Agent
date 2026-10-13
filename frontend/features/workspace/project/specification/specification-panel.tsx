"use client";
import { useEffect, useRef, useState } from "react";
import { CircleNotch, DownloadSimple, FileText, Warning } from "@phosphor-icons/react";
import type { AuthSession, Project } from "../../../../app/lib/api";
import { useT } from "../../../../app/lib/ui-language";
import { confirmSpecification, createSpecification, downloadSpecificationPdf, getSpecification,
  listSpecifications, reviseSpecification, type Specification, type SpecificationSummary } from "./specification-api";
import { forgetSpecificationDraft, readSpecificationDraft, specificationDraftKey, specificationRequestId,
  writeSpecificationDraft, type SpecificationDraft } from "./specification-draft";
import "./specification.css";

interface SpecificationPanelProps {
  session: AuthSession; project: Project; permissions: Set<string>;
  decisionId?: string | null; onOpenDecisions?: () => void;
}
export function SpecificationPanel({ session, project, permissions, decisionId, onOpenDecisions }: SpecificationPanelProps) {
  const t = useT();
  const canRead = permissions.has("project.read") && permissions.has("document.read");
  const canWrite = canRead && permissions.has("project.write") && permissions.has("document.write");
  const [history, setHistory] = useState<SpecificationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Specification | null>(null);
  const [draft, setDraft] = useState<SpecificationDraft>({ title: "", bodyText: "" });
  const [editing, setEditing] = useState(false), [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const context = `${session.userId}:${session.workspaceId}:${project.id}`;
  const generation = useRef(0), inFlight = useRef(false);
  const requestCache = useRef(new Map<string, string>());
  const dirty = !!detail && (draft.title !== detail.title || draft.bodyText !== detail.bodyText);
  const latest = !!detail && history[0]?.id === detail.id;

  useEffect(() => {
    const operation = ++generation.current, controller = new AbortController();
    inFlight.current = false; requestCache.current.clear();
    Promise.resolve().then(() => {
      if (operation !== generation.current) return;
      setLoading(true); setBusy(false); setDetail(null); setReviewed(false); setEditing(false);
      setError(null); setNotice(null); setHistory([]); setSelectedId(null);
    });
    if (canRead) listSpecifications(session, project.id, controller.signal).then(rows => {
      if (operation !== generation.current) return;
      setHistory(rows); setSelectedId(rows[0]?.id ?? null);
    }).catch(cause => {
      if (operation === generation.current && !controller.signal.aborted) setError(message(cause, "명세 이력을 불러오지 못했습니다."));
    }).finally(() => { if (operation === generation.current) setLoading(false); });
    else Promise.resolve().then(() => { if (operation === generation.current) setLoading(false); });
    return () => { generation.current = operation + 1; controller.abort(); };
  }, [context, canRead, project.id, session, revision]);
  useEffect(() => {
    if (!selectedId || !canRead) return;
    const operation = generation.current, controller = new AbortController();
    Promise.resolve().then(() => { if (operation === generation.current) { setDetail(null); setReviewed(false); } });
    getSpecification(session, project.id, selectedId, controller.signal).then(value => {
      if (operation !== generation.current || controller.signal.aborted) return;
      const key = specificationDraftKey(session.userId, session.workspaceId, project.id, value.id);
      const saved = readSpecificationDraft(window.sessionStorage, key, value);
      setDetail(value); setDraft(saved); setEditing(value.status === "DRAFT" || saved.bodyText !== value.bodyText || saved.title !== value.title);
    }).catch(cause => {
      if (operation === generation.current && !controller.signal.aborted) setError(message(cause, "명세 내용을 불러오지 못했습니다."));
    });
    return () => controller.abort();
  }, [selectedId, canRead, project.id, session]);

  function requestId(operation: string) {
    const existing = requestCache.current.get(operation);
    if (existing) return existing;
    const value = specificationRequestId(window.sessionStorage, `freelance-ops-specification-v1:${context}`, operation);
    requestCache.current.set(operation, value); return value;
  }
  function updateDraft(next: SpecificationDraft) {
    setDraft(next); setReviewed(false); setNotice(null);
    if (detail) writeSpecificationDraft(window.sessionStorage,
      specificationDraftKey(session.userId, session.workspaceId, project.id, detail.id), detail, next);
  }
  function accept(value: Specification) {
    setHistory(rows => [{ id: value.id, revisionNumber: value.revisionNumber, status: value.status,
      title: value.title, contentHash: value.contentHash, sourceDecisionId: value.sourceDecisionId,
      sourceDecisionVersion: value.sourceDecisionVersion, sourceCurrent: value.sourceCurrent,
      createdAt: value.createdAt, confirmedAt: value.confirmedAt }, ...rows.filter(row => row.id !== value.id)]
      .sort((a, b) => b.revisionNumber - a.revisionNumber).slice(0, 50));
    setSelectedId(value.id); setDetail(value); setDraft({ title: value.title, bodyText: value.bodyText });
    setReviewed(false); setEditing(value.status === "DRAFT");
  }
  async function perform(action: () => Promise<void>) {
    if (inFlight.current) return;
    const operation = generation.current;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); }
    catch (cause) { if (operation === generation.current) setError(message(cause, "요청을 완료하지 못했습니다. 입력을 보존했습니다. 다시 시도해 주세요.")); }
    finally { if (operation === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  async function generate() {
    if (!decisionId || !canWrite || dirty) return;
    const operation = generation.current;
    await perform(async () => {
      const existing = history[0]?.sourceDecisionId === decisionId ? history[0] : null;
      const value = existing ? await getSpecification(session, project.id, existing.id)
        : await createSpecification(session, project.id, decisionId, requestId(`create:${decisionId}`));
      if (operation !== generation.current) return;
      accept(value); setNotice(t("확정한 결과를 그대로 명세 초안에 옮겼습니다. 내용을 검토하고 명세를 확정해 주세요."));
    });
  }
  async function save() {
    if (!detail || !canWrite || !latest || !dirty || !draft.title.trim() || !draft.bodyText.trim()) return;
    const current = detail, operation = generation.current;
    await perform(async () => {
      const value = await reviseSpecification(session, project.id, current, { ...draft,
        requestId: requestId(JSON.stringify(["revise", current.id, current.contentHash, draft.title, draft.bodyText])) });
      if (operation !== generation.current) return;
      forgetSpecificationDraft(window.sessionStorage, specificationDraftKey(session.userId, session.workspaceId, project.id, current.id));
      accept(value); setNotice(t("수정 내용을 새 버전으로 저장했습니다. PDF와 참고 자료에 반영하려면 다시 확정해 주세요."));
    });
  }
  async function confirm() {
    if (!detail || !canWrite || dirty || !reviewed || !latest || !detail.sourceCurrent || detail.status !== "DRAFT") return;
    const current = detail, operation = generation.current;
    await perform(async () => {
      const value = await confirmSpecification(session, project.id, current);
      if (operation !== generation.current) return;
      forgetSpecificationDraft(window.sessionStorage, specificationDraftKey(session.userId, session.workspaceId, project.id, current.id));
      accept(value); setNotice(t("명세를 확정했습니다. 확정한 내용만 이 프로젝트의 참고 자료로 저장했고, PDF를 다운로드할 수 있습니다."));
    });
  }
  async function download() {
    if (!detail || detail.status !== "CONFIRMED" || dirty) return;
    const current = detail, operation = generation.current;
    await perform(async () => {
      const blob = await downloadSpecificationPdf(session, project.id, current);
      if (operation !== generation.current) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = current.downloadFileName; document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice(t("PDF 다운로드를 시작했습니다."));
    });
  }
  function cancelEditing() {
    if (!detail || busy) return;
    forgetSpecificationDraft(window.sessionStorage, specificationDraftKey(session.userId, session.workspaceId, project.id, detail.id));
    setDraft({ title: detail.title, bodyText: detail.bodyText }); setReviewed(false); setEditing(detail.status === "DRAFT");
  }
  if (!canRead) return <section className="specification-panel"><h2>{t("명세서")}</h2><p>{t("프로젝트와 문서를 읽을 권한이 필요합니다.")}</p></section>;
  return <section className="specification-panel" aria-label={t("명세서 검토 및 PDF 출력")}>
    <header className="specification-heading"><div><span>{t("결과 확정 다음 단계")}</span><h2>{t("명세서 검토와 확정")}</h2>
      <p>{t("확정된 결과를 그대로 가져와 검토합니다. 내용 변경은 새 버전으로 남습니다.")}</p></div>
      <button type="button" className="primary-button" disabled={!canWrite || !decisionId || busy || dirty || loading} onClick={() => void generate()}>
        <FileText size={18} />{t("확정 결과로 명세 생성")}</button></header>
    {error && <div className="form-error" role="alert"><Warning size={18} /><span>{t(error)}</span>
      <button type="button" className="quiet-button" disabled={busy || dirty} onClick={() => setRevision(value => value + 1)}>{t("다시 불러오기")}</button></div>}
    {notice && <p className="specification-notice" role="status">{notice}</p>}
    {!decisionId && <p className="specification-notice">{t("먼저 의견 정리에서 종합 결과를 확정해 주세요.")}
      {onOpenDecisions && <button type="button" className="quiet-button" onClick={onOpenDecisions}>{t("의견 정리로 이동")}</button>}</p>}
    {loading ? <div className="section-loading"><CircleNotch className="spin" />{t("명세 이력을 확인하고 있습니다.")}</div>
      : history.length === 0 ? <p>{t("아직 생성된 명세가 없습니다.")}</p> : <div className="specification-layout">
        <aside className="specification-history" aria-label={t("명세 버전 이력")}><p>{t("최근 50개 버전")}</p>{history.map(value =>
          <button type="button" key={value.id} disabled={busy || dirty} aria-current={selectedId === value.id ? "true" : undefined}
            onClick={() => { setSelectedId(value.id); setNotice(null); setError(null); setEditing(false); }}>
            <strong>v{value.revisionNumber} · {t(value.status === "CONFIRMED" ? "확정됨" : "검토 중")}</strong><span>{value.title}</span>
            <small>{t("종합 결과")} v{value.sourceDecisionVersion}</small></button>)}</aside>
        {!detail ? <div className="section-loading"><CircleNotch className="spin" />{t("명세 내용을 확인하고 있습니다.")}</div>
          : <article className="specification-detail"><div className="specification-meta"><span>v{detail.revisionNumber} · {t(detail.status === "CONFIRMED" ? "확정됨" : "검토 중")}</span>
            <span>{t("원본 결과")} v{detail.sourceDecisionVersion}</span><span>SHA-256 {detail.contentHash.slice(0, 12)}</span></div>
            {!detail.sourceCurrent && <p className="form-error" role="status">{t("프로젝트 원문 또는 확정 결과가 변경되었습니다. 이 버전은 그대로 보존하며, 최신 결과로 새 명세를 생성해야 확정할 수 있습니다.")}</p>}
            {!latest && <p className="specification-notice">{t("이전 버전입니다. 확정본 PDF는 계속 내려받을 수 있으며, 수정은 최신 버전에서 시작해 주세요.")}</p>}
            {editing && canWrite && latest ? <div className="specification-editor"><label>{t("명세 제목")}<input value={draft.title} maxLength={300} disabled={busy}
              onChange={event => updateDraft({ ...draft, title: event.target.value })} /></label>
              <label>{t("명세 내용")}<textarea value={draft.bodyText} maxLength={100000} disabled={busy} rows={22}
                onChange={event => updateDraft({ ...draft, bodyText: event.target.value })} /></label>
              <span>{draft.bodyText.length.toLocaleString()} / 100,000</span>
              <div className="specification-actions"><button type="button" className="primary-button" disabled={busy || !dirty || !draft.title.trim() || !draft.bodyText.trim()} onClick={() => void save()}>{t("수정본 새 버전 저장")}</button>
                <button type="button" className="quiet-button" disabled={busy} onClick={cancelEditing}>{t("수정 취소")}</button></div></div>
              : <><h3>{detail.title}</h3><pre className="specification-content">{detail.bodyText}</pre></>}
            {canWrite && latest && !editing && <button type="button" className="quiet-button" disabled={busy} onClick={() => setEditing(true)}>{t("새 버전으로 수정")}</button>}
            {detail.status === "DRAFT" && canWrite && latest && <div className="specification-confirm"><label><input type="checkbox" checked={reviewed} disabled={busy || dirty || !detail.sourceCurrent}
              onChange={event => setReviewed(event.target.checked)} />{t("명세 전체를 검토했으며 이 내용을 PDF와 이 프로젝트의 다음 분석 참고 자료로 확정합니다.")}</label>
              {dirty && <p>{t("먼저 수정본을 저장한 뒤 저장된 내용을 다시 검토해 주세요.")}</p>}
              <button type="button" className="primary-button" disabled={busy || dirty || !reviewed || !detail.sourceCurrent} onClick={() => void confirm()}>{t("명세서 최종 확정")}</button></div>}
            {detail.status === "CONFIRMED" && <div className="specification-actions"><button type="button" className="primary-button" disabled={busy || dirty} onClick={() => void download()}><DownloadSimple size={18} />{t("PDF 다운로드")}</button>
              <span>{detail.indexStatus === "KEYWORD_ONLY" ? t("이 프로젝트의 확정 내용만 키워드 검색에 반영됨 · 추가 AI 호출 없음")
                : t("현재 검색 참고 자료에서 제외됨 · 확정본 PDF는 보존됨")}</span></div>}
            <details className="specification-provenance"><summary>{t("확정 결과와 사용자 원문 출처")}</summary>
              <p>{t("확정 결과 ID")}: {detail.sourceDecisionId}</p><pre className="specification-content">{detail.sourceBodyText}</pre>
              {detail.originalSources.map(source => <section key={source.id}><small>{source.kind} · {source.id}</small>
                {source.prompt && <p>{source.prompt}</p>}<pre className="specification-content">{source.content}</pre></section>)}</details>
          </article>}
      </div>}
    {busy && <p role="status"><CircleNotch className="spin" />{t("요청을 처리하고 있습니다.")}</p>}
  </section>;
}
function message(cause: unknown, fallback: string) { return cause instanceof Error ? cause.message : fallback; }
