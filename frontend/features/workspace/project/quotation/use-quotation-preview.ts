import { useCallback, useEffect, useState } from "react";
import { previewQuotation, type AuthSession, type QuotationPreview } from "@/app/lib/api";

type Input = Parameters<typeof previewQuotation>[2];

// 요청이 바뀌면 이전 금액을 숨긴다. 늦게 도착한 응답을 새 항목의 금액으로 표시하지 않는다.
export function useQuotationPreview(session: AuthSession, projectId: string, input: Input | null, enabled: boolean) {
  const key = `${session.userId}:${session.workspaceId}:${projectId}:${JSON.stringify(input)}`;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{key: string; value: QuotationPreview | null; error: string | null} | null>(null);
  useEffect(() => {
    if (!enabled || !input) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      previewQuotation(session, projectId, input).then(value => {
        if (!cancelled) setResult({key, value, error: null});
      }).catch(() => {
        if (!cancelled) setResult({key, value: null, error: "견적 금액을 확인하지 못했습니다."});
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [session, projectId, input, enabled, key, revision]);
  const refresh = useCallback(() => { setResult(null); setRevision(value => value + 1); }, []);
  const current = enabled && result?.key === key ? result : null;
  return {preview: current?.value ?? null, error: current?.error ?? null,
    loading: enabled && !!input && !current, refresh};
}
