"use client";

import { useEffect, useState } from "react";
import { getAgentRun, listProjectAgentRunHistory } from "../../../../app/lib/api";
import type { AgentRunHistoryItem, AgentRunView, AuthSession } from "../../../../app/lib/api";

interface AgentHistoryOptions {
  session: AuthSession;
  projectId: string;
  runId: string | null;
  canRun: boolean;
  t: (source: string) => string;
}

export function useAgentHistory({ session, projectId, runId, canRun, t }: AgentHistoryOptions) {
  const [history, setHistory] = useState<AgentRunHistoryItem[]>([]);
  const [pastRuns, setPastRuns] = useState<Record<string, AgentRunView>>({});
  const [resultReads, setResultReads] = useState<Record<string, "loading" | "failed">>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);

  useEffect(() => {
    if (!canRun) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    listProjectAgentRunHistory(session, projectId)
      .then((items) => {
        if (cancelled) return;
        setHistory(items);
        setError(null);
        const historical = [
          ...new Map(items.filter((item) => item.runId !== runId).map((item) => [item.runId, item])).values()
        ];
        setPastRuns((views) =>
          Object.fromEntries(
            historical.filter((item) => views[item.runId]).map((item) => [item.runId, views[item.runId]])
          )
        );
        setResultReads(Object.fromEntries(historical.map((item) => [item.runId, "loading" as const])));
        // 결과를 개별 조회해 한 요청이 늦어져도 원문과 준비된 결과는 먼저 보여 준다.
        historical.forEach((item) => {
          void getAgentRun(session, item.runId)
            .then((view) => {
              if (cancelled) return;
              setPastRuns((views) => ({ ...views, [item.runId]: view }));
              setResultReads((reads) => {
                const next = { ...reads };
                delete next[item.runId];
                return next;
              });
            })
            .catch(() => {
              if (!cancelled) setResultReads((reads) => ({ ...reads, [item.runId]: "failed" }));
            });
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : t("작업 기록을 불러오지 못했습니다."));
        // 이전 결과 요청이 현재 기록의 로딩 상태를 남기지 않도록 실패로 표시한다.
        setResultReads((reads) => Object.fromEntries(Object.keys(reads).map((id) => [id, "failed" as const])));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canRun, projectId, runId, session, t, historyRevision]);

  const refreshHistory = () => setHistoryRevision((value) => value + 1);
  return { history, pastRuns, resultReads, loading, error, refreshHistory };
}
