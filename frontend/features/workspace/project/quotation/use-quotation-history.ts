import { useCallback, useEffect, useRef, useState } from "react";
import { type AuthSession, type Quotation, listQuotationPage } from "@/app/lib/api";

// 늦게 도착한 이전 페이지가 로컬에서 저장·발행한 버전을 덮어쓰지 않게 한다.
function mergeQuotations(current: Quotation[], incoming: Quotation[]): Quotation[] {
  const seen = new Set(current.map((quotation) => quotation.id));
  // Instant JSON의 생략된 소수부 0을 나노초 정밀도를 잃지 않게 정규화한다.
  const instantKey = (value: string) =>
    value.replace(/(?:\.(\d+))?Z$/, (_match, fraction = "") => `.${fraction.padEnd(9, "0")}Z`);
  return [
    ...current,
    ...incoming.filter((quotation) => {
      if (seen.has(quotation.id)) return false;
      seen.add(quotation.id);
      return true;
    })
  ].sort(
    (left, right) =>
      instantKey(right.createdAt).localeCompare(instantKey(left.createdAt)) || right.id.localeCompare(left.id)
  );
}

export function useQuotationHistory(session: AuthSession, projectId: string) {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const generation = useRef(0);
  const pendingMore = useRef(false);
  const pendingFirst = useRef(false);

  useEffect(
    () => () => {
      generation.current++;
      pendingMore.current = false;
      pendingFirst.current = false;
    },
    [session, projectId]
  );

  const loadFirstPage = useCallback(async () => {
    const requestGeneration = ++generation.current;
    pendingMore.current = false;
    pendingFirst.current = true;
    setQuotations([]);
    setNextCursor(null);
    setLoadingMore(false);
    setHistoryError(null);
    try {
      const page = await listQuotationPage(session, projectId);
      if (requestGeneration === generation.current) {
        setQuotations(page.items);
        setNextCursor(page.nextCursor);
      }
      return page.items;
    } finally {
      if (requestGeneration === generation.current) pendingFirst.current = false;
    }
  }, [session, projectId]);

  const includeQuotation = useCallback((quotation: Quotation) => {
    setQuotations((current) => mergeQuotations([quotation], current));
  }, []);

  const loadMoreQuotations = async () => {
    if (!nextCursor || pendingFirst.current || pendingMore.current) return;
    const requestGeneration = generation.current;
    pendingMore.current = true;
    setLoadingMore(true);
    setHistoryError(null);
    try {
      const page = await listQuotationPage(session, projectId, nextCursor);
      if (requestGeneration !== generation.current) return;
      setQuotations((current) => mergeQuotations(current, page.items));
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (requestGeneration === generation.current) {
        setHistoryError(cause instanceof Error ? cause.message : "이전 견적을 불러오지 못했습니다.");
      }
    } finally {
      if (requestGeneration === generation.current) {
        pendingMore.current = false;
        setLoadingMore(false);
      }
    }
  };

  return { quotations, nextCursor, loadingMore, historyError, loadFirstPage, includeQuotation, loadMoreQuotations };
}
