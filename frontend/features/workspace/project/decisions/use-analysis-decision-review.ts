import { ApiError, currentSessionGeneration, type AgentRunView, type AuthSession, type Project } from "@/app/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { confirmAnalysisDecision, createAnalysisDecision, getAnalysisDecision, getLatestAnalysisSource, listAnalysisDecisions,
  reviseAnalysisDecision, type AnalysisDecision, type AnalysisSource } from "./analysis-decisions-api";
import { DecisionRequestKeys, decisionStorageKey, latestFamilyDecision, restoredDecisionDraft, selectableOpinions } from "./analysis-decision-state";

function stored(key: string): unknown {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { return null; }
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : "의견 정리를 처리하지 못했습니다. 다시 확인해 주세요."; }

export function useAnalysisDecisionReview(session: AuthSession, project: Project, permissions: Set<string>, run: AgentRunView | null) {
  const canRead = permissions.has("project.read");
  const canWrite = permissions.has("project.write");
  const canReadSource = permissions.has("agent.run");
  const storageKey = decisionStorageKey(session.userId, session.workspaceId, project.id);
  const [history, setHistory] = useState<AnalysisDecision[]>([]);
  const [source, setSource] = useState<AnalysisSource | null>(null);
  const [decision, setDecision] = useState<AnalysisDecision | null>(null);
  const [bodyText, setBodyText] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mutationRevision = useRef(0);
  const initialized = useRef(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const ownerGeneration = useRef(currentSessionGeneration());
  const requests = useRef(new DecisionRequestKeys(stored(`${storageKey}:requests`)));
  const owns = useCallback(() => mounted.current && ownerGeneration.current === currentSessionGeneration(), []);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const apply = useCallback((value: AnalysisDecision, restore = false) => {
    setDecision(value);
    setBodyText(restore ? restoredDecisionDraft(stored(storageKey), value) ?? value.bodyText : value.bodyText);
    setAcknowledged(false);
    setSelectedIds(value.selectedOpinionIds);
    setHistory(current => [value, ...current.filter(item => item.id !== value.id)]);
  }, [storageKey]);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    const revision = mutationRevision.current;
    listAnalysisDecisions(session, project.id).then(async values => {
      if (cancelled || !owns() || revision !== mutationRevision.current) return;
      setHistory(values);
      if (initialized.current) return;
      const saved = stored(storageKey) as { baseId?: unknown } | null;
      let initial = values[0] ?? null;
      if (typeof saved?.baseId === "string") {
        initial = values.find(value => value.id === saved.baseId) ?? await getAnalysisDecision(session, project.id, saved.baseId);
      }
      if (cancelled || !owns() || revision !== mutationRevision.current) return;
      if (initial) apply(initial, true);
      initialized.current = true;
      setError(null);
    }).catch(cause => { if (!cancelled && owns() && revision === mutationRevision.current) setError(message(cause)); })
      .finally(() => { if (!cancelled && owns()) setLoading(false); });
    return () => { cancelled = true; };
  }, [apply, canRead, owns, project.id, session, storageKey]);

  useEffect(() => {
    if (!canReadSource) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled && owns()) setSourceLoading(true); });
    getLatestAnalysisSource(session, project.id).then(value => {
      if (cancelled || !owns()) return;
      setSource(value); setSourceError(null);
      setAcknowledged(false);
      setSelectedIds(current => current.filter(id => selectableOpinions(value, project.version).some(opinion => opinion.id === id)));
    }).catch(cause => { if (!cancelled && owns()) { setSource(null); setSourceError(message(cause)); } })
      .finally(() => { if (!cancelled && owns()) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [canReadSource, owns, project.id, project.version, run?.runId, run?.status, session]);

  const dirty = !!decision && bodyText !== decision.bodyText;
  const latest = decision ? latestFamilyDecision(history, decision) : null;
  const latestRevision = !!decision && latest?.id === decision.id;
  const stale = !!decision && decision.sourceProjectVersion !== project.version;
  const opinions = selectableOpinions(source, project.version);
  const selected = opinions.filter(opinion => selectedIds.includes(opinion.id));
  const selectionChanged = !!decision && (source?.runId === decision.sourceRunId || selectedIds.length > 0)
    && JSON.stringify([...selectedIds].sort()) !== JSON.stringify([...decision.selectedOpinionIds].sort());

  useEffect(() => {
    if (!decision || !canWrite) return;
    const timer = window.setTimeout(() => {
      try { sessionStorage.setItem(storageKey, JSON.stringify({ baseId: decision.id, baseHash: decision.contentHash, bodyText })); }
      catch { if (owns()) setStorageUnavailable(true); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [bodyText, canWrite, decision, owns, storageKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function persistRequests() {
    try { sessionStorage.setItem(`${storageKey}:requests`, JSON.stringify(requests.current.snapshot())); }
    catch { setStorageUnavailable(true); }
  }

  async function mutate(kind: string, input: object, operation: (requestId: string) => Promise<AnalysisDecision>) {
    if (lock.current || !owns()) return;
    lock.current = true; mutationRevision.current += 1;
    setBusy(true); setError(null); setNotice(null);
    const requestId = requests.current.requestId(kind, input); persistRequests();
    try {
      const value = await operation(requestId);
      if (!owns()) return;
      requests.current.settle(kind, input); persistRequests(); apply(value);
      initialized.current = true;
      setNotice(value.status === "CONFIRMED" ? "검토한 내용을 사용자 확정본으로 저장했습니다. 명세를 생성할 수 있습니다." : "검토용 정리 초안을 저장했습니다. 내용을 확인한 후 별도로 확정해 주세요.");
    } catch (cause) {
      if (!owns()) return;
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) { requests.current.settle(kind, input); persistRequests(); }
      setError(message(cause));
      if (cause instanceof ApiError && cause.status === 409) {
        try { const values = await listAnalysisDecisions(session, project.id); if (owns()) setHistory(values); }
        catch { /* Keep the reviewed editor and conflict message. Never retry a write automatically. */ }
      }
    } finally { lock.current = false; if (owns()) setBusy(false); }
  }

  function edit(value: string) { mutationRevision.current += 1; setBodyText(value); setAcknowledged(false); setNotice(null); }
  function toggle(id: string) { setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); setAcknowledged(false); setNotice(null); }
  function restoreSelection() { if (decision) { setSelectedIds(decision.selectedOpinionIds); setAcknowledged(false); } }

  async function create() {
    if (!canWrite || !canReadSource || !source || !selected.length || busy || sourceLoading || project.version === undefined) return;
    if (dirty && !window.confirm("작성 중인 수정을 버리고 새 의견 정리 초안을 만들까요?")) return;
    const input = { sourceRunId: source.runId, expectedProjectVersion: project.version, selectedOpinionIds: selected.map(opinion => opinion.id) };
    await mutate("create", input, requestId => createAnalysisDecision(session, project.id, { ...input, requestId }));
  }

  async function saveRevision() {
    if (!decision || !canWrite || !dirty || !latestRevision || stale || busy || !bodyText.trim() || bodyText.length > 100000) return;
    const input = { id: decision.id, expectedContentHash: decision.contentHash, bodyText };
    await mutate("revise", input, requestId => reviseAnalysisDecision(session, project.id, decision.id, { requestId, expectedContentHash: input.expectedContentHash, bodyText: input.bodyText }));
  }

  async function confirm() {
    if (!decision || decision.status !== "DRAFT" || !canWrite || dirty || selectionChanged || !latestRevision || stale || busy || !acknowledged) return;
    const reviewed = decision;
    await mutate("confirm", { id: reviewed.id, hash: reviewed.contentHash }, () => confirmAnalysisDecision(session, project.id, reviewed));
  }

  function load(value: AnalysisDecision) {
    if (busy || dirty && !window.confirm("작성 중인 수정을 버리고 선택한 정리 버전을 불러올까요?")) return;
    mutationRevision.current += 1; apply(value); setError(null); setNotice(null);
  }

  return { canRead, canWrite, canReadSource, history, source, sourceLoading, decision, bodyText, selectedIds, selected, opinions,
    acknowledged, setAcknowledged, loading, busy, error, sourceError, storageUnavailable, notice, dirty, stale, latest, latestRevision,
    selectionChanged, restoreSelection, edit, toggle, create, saveRevision, confirm, load };
}
