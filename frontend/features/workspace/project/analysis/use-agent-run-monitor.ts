"use client";

import { useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { ApiError, getAgentRun, streamRunEvents } from "../../../../app/lib/api";
import type { AgentRunView, AuthSession, WorkflowEvent } from "../../../../app/lib/api";
import { isActiveStreamStatus, nextStreamCursor, streamReconnectDelay } from "../../../../app/lib/stream-retry.mjs";
import { isPendingResumeSnapshot } from "../../../../app/lib/run-resume-state.mjs";
import { terminalStatuses } from "../../shared/constants";
import type { StreamState } from "../../shared/types";

interface AgentRunMonitorOptions {
  pendingResume: RefObject<{ runId: string; interruptionId: string } | null>;
  session: AuthSession | null;
  runId: string | null;
  runStatus: string | undefined;
  executionRevision: number;
  setRun: Dispatch<SetStateAction<AgentRunView | null>>;
  setEvents: Dispatch<SetStateAction<WorkflowEvent[]>>;
  setStreamState: Dispatch<SetStateAction<StreamState>>;
  setStreamRetryCount: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

// 이벤트 재연결과 상태 조회의 수명을 실행 단위로 관리한다.
export function useAgentRunMonitor({ pendingResume, session, runId, runStatus, executionRevision, setRun, setEvents, setStreamState, setStreamRetryCount, setError }: AgentRunMonitorOptions) {
  const lastEventIdRef = useRef(0);
  const previousRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousRunIdRef.current !== runId) {
      previousRunIdRef.current = runId;
      if (pendingResume.current?.runId !== runId) pendingResume.current = null;
      lastEventIdRef.current = 0;
    }
  }, [pendingResume, runId]);

  useEffect(() => {
    if (!session || !runId) return;
    if (!isActiveStreamStatus(runStatus)) {
      Promise.resolve().then(() => {
        setStreamState("settled");
        setStreamRetryCount(0);
      });
      return;
    }

    const controller = new AbortController();
    let retryTimer: number | undefined;
    let attempt = 0;
    let cancelled = false;

    const scheduleReconnect = () => {
      if (cancelled || controller.signal.aborted) return;
      attempt += 1;
      setStreamState("reconnecting");
      setStreamRetryCount(attempt);
      retryTimer = window.setTimeout(() => void connect(), streamReconnectDelay(attempt));
    };

    const connect = async () => {
      if (cancelled || controller.signal.aborted) return;
      setStreamState(attempt === 0 ? "connecting" : "reconnecting");
      try {
        await streamRunEvents(
          session,
          runId,
          (event) => {
            if (cancelled || controller.signal.aborted) return;
            lastEventIdRef.current = nextStreamCursor(lastEventIdRef.current, event.eventId);
            setEvents((current) =>
              current.some((item) => item.eventId === event.eventId) ? current : [...current, event]
            );
          },
          controller.signal,
          lastEventIdRef.current || undefined,
          () => {
            if (cancelled || controller.signal.aborted) return;
            attempt = 0;
            setStreamState("connected");
            setStreamRetryCount(0);
          }
        );
        scheduleReconnect();
      } catch {
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
  }, [executionRevision, runId, runStatus, session, setEvents, setStreamState, setStreamRetryCount]);

  useEffect(() => {
    if (!session || !runId) return;
    let cancelled = false;
    let pollingError: string | null = null;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const view = await getAgentRun(session, runId);
        const awaitingResumeDelivery = isPendingResumeSnapshot(pendingResume.current, view);
        if (!cancelled) {
          if (!awaitingResumeDelivery) {
            if (pendingResume.current?.runId === view.runId) pendingResume.current = null;
            setRun((current) =>
            current?.runId === view.runId && terminalStatuses.has(current.status) && !terminalStatuses.has(view.status)
              ? current
              : view
            );
          }
          if (pollingError) {
            const recoveredError = pollingError;
            setError((current) => (current === recoveredError ? null : current));
            pollingError = null;
          }
        }
        return !awaitingResumeDelivery && terminalStatuses.has(view.status);
      } catch (cause) {
        if (!cancelled) {
          pollingError = cause instanceof Error ? cause.message : "실행 상태를 확인하지 못했습니다.";
          setError(pollingError);
        }
        // 일시적인 통신 오류는 재시도하되 권한이 없거나 삭제된 실행은 조회를 중단한다.
        return cause instanceof ApiError && [401, 403, 404].includes(cause.status);
      }
    };
    const check = async () => {
      const finished = await poll();
      if (!cancelled && !finished) timer = window.setTimeout(() => void check(), 2000);
    };
    void check();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [executionRevision, pendingResume, runId, session, setError, setRun]);
}
