import { AgentQuotationDraft, ApiError, AuthSession, Project, ProposalShare, Provider, Quotation, QuotationItemInput, QuotationScenario, RateCard, createProposalShare, createQuotation, listQuotations, listRateCards, publishQuotation, reloadQuotations, reviseQuotation, revokeProposalShare, suggestQuotationAssumption } from "@/app/lib/api";
import { createQuotationAIDraftDismissals, createQuotationDraft, parseQuotationAIDraftDismissals, parseQuotationDraft, quotationAIDraftDismissalKey, quotationAIDraftFingerprint, quotationDraftFingerprint, quotationDraftKey } from "@/app/lib/quotation-draft.mjs";
import { hydrateMissingDraftRates } from "@/app/lib/rate-card-match.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { quotationScenarioLabels } from "../../shared/constants";
import { copyToClipboard, emptyQuoteItem, quotationDraftItems, quotationItemsAsInput } from "./quotation-helpers";

export type QuoteDraftStatus = {
  kind: "generated" | "restored" | "saved" | "unavailable";
  updatedAt: string | null;
};

export interface QuoteBuilderProps {
  petProfiles?: import("@/app/lib/api").PetProfile[];
  session: AuthSession;
  project: Project;
  permissions: Set<string>;
  quotationDraft: AgentQuotationDraft | null;
  quotationDrafts: AgentQuotationDraft[];
  modelSelection: { provider: Provider; model: string; credentialId?: string | null };
}

// API 상태, 수정 충돌 및 탭 임시 저장은 같은 순서로 처리합니다.
export function useQuoteBuilder({ session, project, permissions, quotationDraft, quotationDrafts, modelSelection, petProfiles }: QuoteBuilderProps) {
  const canRead = permissions.has("quotation.read");
  const canWrite = permissions.has("quotation.write");
  const canPublish = permissions.has("quotation.publish");
  const [scenario, setScenario] = useState<QuotationScenario>("RECOMMENDED");
  const [items, setItems] = useState<QuotationItemInput[]>([emptyQuoteItem()]);
  const [taxRate, setTaxRate] = useState(0.1);
  const [validUntil, setValidUntil] = useState("");
  const [selectedBasisIndex, setSelectedBasisIndex] = useState(0);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [saved, setSaved] = useState<Quotation | null>(null);
  const [proposalShare, setProposalShare] = useState<(ProposalShare & { url: string }) | null>(null);
  const [shareCopyState, setShareCopyState] = useState<"copied" | "manual" | null>(null);
  const [conflictLatest, setConflictLatest] = useState<Quotation | null>(null);
  const [busy, setBusy] = useState(false);
  const [assumptionBusyIndex, setAssumptionBusyIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<QuoteDraftStatus | null>(null);
  const [draftBaseline, setDraftBaseline] = useState<string | null>(null);
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const lastPersistedDraftRef = useRef("");
  const draftStorageKey = quotationDraftKey(session.userId, project.workspaceId, project.id);
  const aiDraftDismissalStorageKey = quotationAIDraftDismissalKey(session.userId, project.workspaceId, project.id);
  const [dismissedAIDraftFingerprints, setDismissedAIDraftFingerprints] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.sessionStorage.getItem(aiDraftDismissalStorageKey);
      return raw ? parseQuotationAIDraftDismissals(raw) : [];
    } catch {
      return [];
    }
  });
  const rawAIDrafts = useMemo(() => quotationDrafts.length > 0
    ? quotationDrafts
    : quotationDraft ? [quotationDraft] : [], [quotationDraft, quotationDrafts]);
  const availableAIDrafts = useMemo(() => rawAIDrafts.filter((draft) => !dismissedAIDraftFingerprints.includes(quotationAIDraftFingerprint(draft))), [dismissedAIDraftFingerprints, rawAIDrafts]);

  const fingerprint = useCallback((nextScenario: QuotationScenario, baseQuotationId: string | null, nextTaxRate: number, nextValidUntil: string, nextItems: QuotationItemInput[]) => quotationDraftFingerprint({
    scenario: nextScenario,
    baseQuotationId,
    taxRate: nextTaxRate,
    validUntil: nextValidUntil,
    items: nextItems
  }), []);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    Promise.all([listQuotations(session, project.id), listRateCards(session)])
      .then(([result, nextRateCards]) => {
        if (!cancelled) {
          setDraftStatus(null);
          setQuotations(result);
          const activeRateCards = nextRateCards.filter((card) => card.active);
          setRateCards(activeRateCards);
          const latest = result[0] ?? null;
          const defaultAIDraft = availableAIDrafts.find((draft) => draft.scenario === "RECOMMENDED") ?? availableAIDrafts[0] ?? null;
          const generatedItems = defaultAIDraft ? quotationDraftItems(defaultAIDraft, activeRateCards, project.currency) : null;
          const defaultScenario = defaultAIDraft?.scenario ?? latest?.scenario ?? "RECOMMENDED";
          const defaultItems = generatedItems ?? (latest ? quotationItemsAsInput(latest) : [emptyQuoteItem()]);
          const defaultTaxRate = latest?.taxRate ?? .1;
          const defaultValidUntil = latest?.validUntil ?? "";
          let restored = null;
          if (canWrite) {
            try {
              const rawDraft = window.sessionStorage.getItem(draftStorageKey);
              if (rawDraft) {
                restored = parseQuotationDraft(rawDraft, { workspaceId: project.workspaceId, projectId: project.id });
                if (!restored) window.sessionStorage.removeItem(draftStorageKey);
              }
            } catch {
              setDraftStatus({ kind: "unavailable", updatedAt: null });
            }
          }
          if (restored) {
            const restoredAIDraft = availableAIDrafts.find((draft) => draft.scenario === restored.scenario) ?? defaultAIDraft;
            const restoredGeneratedItems = restoredAIDraft ? quotationDraftItems(restoredAIDraft, activeRateCards, project.currency) : null;
            const restoredItems = restoredGeneratedItems ? hydrateMissingDraftRates(restored.items, restoredGeneratedItems) as QuotationItemInput[] : restored.items;
            const baseQuotation = restored.baseQuotationId
              ? result.find((quotation) => quotation.id === restored.baseQuotationId) ?? null
              : null;
            setSaved(baseQuotation);
            setScenario(restored.scenario);
            setItems(restoredItems);
            setTaxRate(restored.taxRate);
            setValidUntil(restored.validUntil);
            const restoredFingerprint = fingerprint(restored.scenario, restored.baseQuotationId, restored.taxRate, restored.validUntil, restoredItems);
            const baselineItems = baseQuotation ? quotationItemsAsInput(baseQuotation) : [emptyQuoteItem()];
            setDraftBaseline(fingerprint(
              baseQuotation?.scenario ?? "RECOMMENDED",
              baseQuotation?.id ?? null,
              baseQuotation?.taxRate ?? .1,
              baseQuotation?.validUntil ?? "",
              baselineItems
            ));
            lastPersistedDraftRef.current = restoredFingerprint;
            setDraftStatus({ kind: "restored", updatedAt: restored.updatedAt });
          } else {
            setSaved(generatedItems ? null : latest);
            setScenario(defaultScenario);
            setItems(defaultItems);
            setTaxRate(defaultTaxRate);
            setValidUntil(defaultValidUntil);
            const baseline = fingerprint(defaultScenario, generatedItems ? null : latest?.id ?? null, defaultTaxRate, defaultValidUntil, defaultItems);
            setDraftBaseline(baseline);
            lastPersistedDraftRef.current = baseline;
            if (generatedItems) setDraftStatus({ kind: "generated", updatedAt: null });
          }
          setDraftProjectId(project.id);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "견적 목록을 불러오지 못했습니다.");
      });
    return () => { cancelled = true; };
  }, [availableAIDrafts, canRead, canWrite, draftStorageKey, fingerprint, project.currency, project.id, project.workspaceId, session]);

  const currentDraftFingerprint = fingerprint(scenario, saved?.id ?? null, taxRate, validUntil, items);
  const hasUnsavedDraft = draftProjectId === project.id && draftBaseline !== null && currentDraftFingerprint !== draftBaseline;

  useEffect(() => {
    if (!canWrite || !hasUnsavedDraft || currentDraftFingerprint === lastPersistedDraftRef.current) return;
    const timer = window.setTimeout(() => {
      const draft = createQuotationDraft({
        workspaceId: project.workspaceId,
        projectId: project.id,
        scenario,
        baseQuotationId: saved?.id ?? null,
        taxRate,
        validUntil,
        items
      });
      try {
        window.sessionStorage.setItem(draftStorageKey, JSON.stringify(draft));
        lastPersistedDraftRef.current = currentDraftFingerprint;
        setDraftStatus({ kind: "saved", updatedAt: draft.updatedAt });
      } catch {
        setDraftStatus({ kind: "unavailable", updatedAt: null });
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [canWrite, currentDraftFingerprint, draftStorageKey, hasUnsavedDraft, items, project.id, project.workspaceId, saved?.id, scenario, taxRate, validUntil]);

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedDraft]);

  const estimatedSubtotal = items.reduce((sum, item) => sum + item.quantity * item.unitRate * (1 - item.discountRate), 0);
  const canSave = canWrite && items.length > 0 && items.every((item) => item.title.trim()
    && item.quantity > 0
    && item.unitRate > 0
    && item.basis.content.trim()
    && (item.basis.type === "ASSUMPTION" || Boolean(item.basis.sourceType && item.basis.sourceReference?.trim())));
  const selectedBasis = items[Math.min(selectedBasisIndex, items.length - 1)]?.basis ?? null;
  const latestByScenario = useMemo(() => Object.fromEntries(
    (["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => [value, quotations.find((quotation) => quotation.scenario === value) ?? null])
  ) as Record<QuotationScenario, Quotation | null>, [quotations]);
  const aiDraftByScenario = useMemo(() => Object.fromEntries(
    (["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => [value, availableAIDrafts.find((draft) => draft.scenario === value) ?? null])
  ) as Record<QuotationScenario, AgentQuotationDraft | null>, [availableAIDrafts]);
  const rawAIDraftByScenario = useMemo(() => Object.fromEntries(
    (["LEAN", "RECOMMENDED", "EXPANDED"] as const).map((value) => [value, rawAIDrafts.find((draft) => draft.scenario === value) ?? null])
  ) as Record<QuotationScenario, AgentQuotationDraft | null>, [rawAIDrafts]);

  const updateItem = (index: number, update: (item: QuotationItemInput) => QuotationItemInput) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? update(item) : item));
  };

  const suggestAssumption = async (index: number) => {
    const item = items[index];
    if (!item || !item.title.trim() || !modelSelection.model.trim()) return;
    setAssumptionBusyIndex(index);
    setError(null);
    try {
      const suggestion = await suggestQuotationAssumption(session, project.id, {
        itemTitle: item.title.trim(),
        itemDescription: item.description.trim(),
        quantity: item.quantity,
        unit: item.unit,
        currentAssumption: item.basis.type === "ASSUMPTION" ? item.basis.content : "",
        modelSelection: { ...modelSelection, reasoningEffort: "LOW" }
      });
      updateItem(index, (current) => ({
        ...current,
        basis: {
          type: "ASSUMPTION",
          content: suggestion.content,
          sourceType: null,
          sourceReference: null,
          sourceTitle: null,
          retrievedAt: null
        }
      }));
      setSelectedBasisIndex(index);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 가정 제안을 불러오지 못했습니다.");
    } finally {
      setAssumptionBusyIndex(null);
    }
  };

  const clearStoredDraft = () => {
    try {
      window.sessionStorage.removeItem(draftStorageKey);
    } catch {
      // The editor remains usable when browser storage is unavailable.
    }
    setDraftStatus(null);
  };

  const applyQuotation = (quotation: Quotation) => {
    const nextItems = quotationItemsAsInput(quotation);
    setSaved(quotation);
    setScenario(quotation.scenario);
    setItems(nextItems);
    setSelectedBasisIndex(0);
    setTaxRate(quotation.taxRate);
    setValidUntil(quotation.validUntil ?? "");
    setProposalShare(null);
    setShareCopyState(null);
    setConflictLatest(null);
    setError(null);
    const baseline = fingerprint(quotation.scenario, quotation.id, quotation.taxRate, quotation.validUntil ?? "", nextItems);
    setDraftBaseline(baseline);
    lastPersistedDraftRef.current = baseline;
    clearStoredDraft();
  };

  const loadQuotation = (quotation: Quotation) => {
    if (hasUnsavedDraft && !window.confirm("작성 중인 내용을 버리고 선택한 견적안을 불러올까요?")) return;
    applyQuotation(quotation);
  };

  const resetQuotation = (force = false) => {
    if (!force && hasUnsavedDraft && !window.confirm("작성 중인 내용을 버리고 새 견적안을 시작할까요?")) return;
    const nextItems = [emptyQuoteItem()];
    setSaved(null);
    setScenario("RECOMMENDED");
    setItems(nextItems);
    setSelectedBasisIndex(0);
    setTaxRate(.1);
    setValidUntil("");
    setProposalShare(null);
    setShareCopyState(null);
    setConflictLatest(null);
    setError(null);
    const baseline = fingerprint("RECOMMENDED", null, .1, "", nextItems);
    setDraftBaseline(baseline);
    lastPersistedDraftRef.current = baseline;
    clearStoredDraft();
  };

  const activateScenario = (value: QuotationScenario) => {
    if (value === scenario) return;
    const existing = latestByScenario[value];
    if (existing) {
      loadQuotation(existing);
      return;
    }
    const generated = aiDraftByScenario[value];
    if (!generated) {
      if (hasUnsavedDraft && !window.confirm("작성 중인 내용을 버리고 다른 견적안을 시작할까요?")) return;
      setScenario(value);
      return;
    }
    if (hasUnsavedDraft && !window.confirm("작성 중인 내용을 버리고 AI가 만든 다른 견적안을 불러올까요?")) return;
    const nextItems = quotationDraftItems(generated, rateCards, project.currency);
    setSaved(null);
    setScenario(value);
    setItems(nextItems);
    setSelectedBasisIndex(0);
    setProposalShare(null);
    setShareCopyState(null);
    setConflictLatest(null);
    setError(null);
    const baseline = fingerprint(value, null, taxRate, validUntil, nextItems);
    setDraftBaseline(baseline);
    lastPersistedDraftRef.current = baseline;
    clearStoredDraft();
    setDraftStatus({ kind: "generated", updatedAt: null });
  };

  const discardDraft = () => {
    if (!window.confirm("임시 저장한 내용을 버리고 마지막으로 저장한 견적으로 돌아갈까요?")) return;
    if (saved) applyQuotation(saved);
    else resetQuotation(true);
  };

  const discardGeneratedAIDraft = () => {
    const generated = aiDraftByScenario[scenario];
    if (!generated || saved) return;
    if (!window.confirm(`AI가 만든 ${quotationScenarioLabels[scenario]}을 버릴까요? 저장된 견적과 다른 견적안은 그대로 유지됩니다.`)) return;

    const fingerprintToDismiss = quotationAIDraftFingerprint(generated);
    const nextDismissed = [...new Set([...dismissedAIDraftFingerprints, fingerprintToDismiss])];
    try {
      window.sessionStorage.setItem(aiDraftDismissalStorageKey, JSON.stringify(createQuotationAIDraftDismissals(nextDismissed)));
    } catch {
      // The current editor still discards the draft when browser storage is unavailable.
    }
    setDismissedAIDraftFingerprints(nextDismissed);

    const nextItems = [emptyQuoteItem()];
    setItems(nextItems);
    setSelectedBasisIndex(0);
    setProposalShare(null);
    setShareCopyState(null);
    setConflictLatest(null);
    setError(null);
    const baseline = fingerprint(scenario, null, taxRate, validUntil, nextItems);
    setDraftBaseline(baseline);
    lastPersistedDraftRef.current = baseline;
    clearStoredDraft();
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const input = {
        scenario,
        currency: project.currency,
        taxRate,
        applyDefaultRiskBuffer: true,
        validUntil: validUntil || null,
        items
      };
      const quotation = saved
        ? await reviseQuotation(session, saved.id, input)
        : await createQuotation(session, project.id, input);
      const savedItems = quotationItemsAsInput(quotation);
      setSaved(quotation);
      setItems(savedItems);
      setQuotations((current) => [quotation, ...current]);
      setConflictLatest(null);
      const baseline = fingerprint(quotation.scenario, quotation.id, quotation.taxRate, quotation.validUntil ?? "", savedItems);
      setDraftBaseline(baseline);
      lastPersistedDraftRef.current = baseline;
      clearStoredDraft();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && saved) {
        try {
          const refreshed = await reloadQuotations(session, project.id);
          setQuotations(refreshed);
          setConflictLatest(refreshed.find((quotation) => quotation.seriesId === saved.seriesId) ?? refreshed[0] ?? null);
          setError(null);
        } catch {
          setError("다른 사용자가 새 견적안을 먼저 저장했습니다. 최신 목록을 불러오지 못했으니 잠시 후 다시 확인해 주세요.");
        }
      } else {
        setError(cause instanceof Error ? cause.message : "견적을 저장하지 못했습니다.");
      }
    } finally {
      setBusy(false);
    }
  };

  const publishSavedQuotation = async () => {
    if (!saved || hasUnsavedDraft || !canPublish || busy) return;
    setBusy(true);
    setError(null);
    try {
      const published = await publishQuotation(session, saved.id);
      setSaved(published);
      setQuotations((current) => current.map((quotation) => quotation.id === published.id ? published : quotation));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "견적을 발행하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const createCustomerLink = async () => {
    if (!saved) return;
    setBusy(true);
    setError(null);
    try {
      const share = await createProposalShare(session, saved.id);
      const url = new URL(`/proposal/${share.token}`, window.location.origin).toString();
      setProposalShare({ ...share, url });
      setShareCopyState((await copyToClipboard(url)) ? "copied" : "manual");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "공유 링크를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const disableCustomerLink = async () => {
    if (!proposalShare) return;
    setBusy(true);
    setError(null);
    try {
      await revokeProposalShare(session, proposalShare.shareId);
      setProposalShare(null);
      setShareCopyState(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "공유 링크를 비활성화하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const copyCustomerLink = async () => {
    if (!proposalShare) return;
    setShareCopyState((await copyToClipboard(proposalShare.url)) ? "copied" : "manual");
  };

  const continueWithCurrentDraft = () => {
    setSaved(null);
    setConflictLatest(null);
  };

  return {
    canRead,
    hasUnsavedDraft,
    availableAIDrafts,
    canWrite,
    scenario,
    activateScenario,
    aiDraftByScenario,
    saved,
    discardGeneratedAIDraft,
    resetQuotation,
    draftStatus,
    discardDraft,
    error,
    conflictLatest,
    loadQuotation,
    continueWithCurrentDraft,
    latestByScenario,
    rawAIDraftByScenario,
    rateCards,
    project,
    taxRate,
    items,
    selectedBasisIndex,
    setSelectedBasisIndex,
    updateItem,
    setItems,
    assumptionBusyIndex,
    modelSelection,
    petProfiles,
    suggestAssumption,
    estimatedSubtotal,
    setTaxRate,
    validUntil,
    setValidUntil,
    selectedBasis,
    busy,
    canSave,
    save,
    canPublish,
    publishSavedQuotation,
    proposalShare,
    createCustomerLink,
    shareCopyState,
    copyCustomerLink,
    disableCustomerLink,
    quotations
  };
}

export type QuoteBuilderModel = ReturnType<typeof useQuoteBuilder>;
