import { useCallback, useEffect, useRef, useState } from "react";
import { AuthSession, getAiUsage } from "../../../app/lib/api";
import { AiUsage, parseAiUsage } from "../../../app/lib/ai-usage-presentation";

export interface AiUsageState { data: AiUsage | null; loading: boolean; refresh: () => Promise<void>; }
export function useAiUsage(session: AuthSession, revision: string): AiUsageState {
  const [data, setData] = useState<AiUsage | null>(null); const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const refresh = useCallback(async () => {
    const current = ++generation.current; setLoading(true); setData(null);
    let next = null;
    try { next = parseAiUsage(await getAiUsage(session)); } catch { /* Unknown means unavailable, never a legacy-credit conversion. */ }
    if (current === generation.current) { setData(next); setLoading(false); }
  }, [session]);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) void refresh(); });
    return () => { cancelled = true; invalidate(); };
  }, [refresh, revision, invalidate]);
  return { data, loading, refresh };
}
