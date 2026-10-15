import { useCallback, useEffect, useRef, useState } from "react";
import { AuthSession, getAiUsage } from "../../../app/lib/api";
import { AiUsage, parseAiUsage } from "../../../app/lib/ai-usage-presentation";

export interface AiUsageState {
  data: AiUsage | null;
  loading: boolean;
  refresh: () => Promise<void>;
}
export function useAiUsage(session: AuthSession, revision: string): AiUsageState {
  const [data, setData] = useState<AiUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const refresh = useCallback(
    async (background = false) => {
      const current = ++generation.current;
      if (!background) {
        setLoading(true);
        setData(null);
      }
      let next = null;
      try {
        next = parseAiUsage(await getAiUsage(session));
      } catch {
        /* 알 수 없는 값은 사용 불가로 처리하며 이전 크레딧 단위로 환산하지 않는다. */
      }
      if (current === generation.current) {
        setData(next);
        setLoading(false);
      }
    },
    [session]
  );
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void refresh();
    });
    // 종료 후 정산이 비동기로 반영될 수 있어 잔액은 항상 서버 값을 표시한다.
    const updateVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const interval = window.setInterval(updateVisible, 15_000);
    document.addEventListener("visibilitychange", updateVisible);
    window.addEventListener("focus", updateVisible);
    return () => {
      cancelled = true;
      invalidate();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", updateVisible);
      window.removeEventListener("focus", updateVisible);
    };
  }, [refresh, revision, invalidate]);
  return { data, loading, refresh };
}
