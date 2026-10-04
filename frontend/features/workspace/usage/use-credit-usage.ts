import { useCallback, useEffect, useRef, useState } from "react";
import { AuthSession, FreeUsage, getFreeUsage, subscribeToFreeUsageExhausted } from "../../../app/lib/api";
import { isWeeklyCreditUsage } from "../../../app/lib/credit-policy";

export interface CreditUsageState { data: FreeUsage | null; loading: boolean; failed: boolean; refresh: () => Promise<FreeUsage | null>; }
export function useCreditUsage(session: AuthSession, revision: string, enabled = true): CreditUsageState {
  const [data, setData] = useState<FreeUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setData(null); setFailed(false);
    try {
      const value = await getFreeUsage(session);
      const valid = isWeeklyCreditUsage(value);
      if (current === request.current) { setData(valid ? value : null); setFailed(!valid); setLoading(false); }
      return valid ? value : null;
    } catch {
      if (current === request.current) { setData(null); setFailed(true); setLoading(false); }
      return null;
    }
  }, [session]);
  const invalidate = useCallback(() => { request.current++; }, []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) void refresh(); });
    const unsubscribe = subscribeToFreeUsageExhausted(() => { if (!cancelled) void refresh(); });
    return () => { cancelled = true; invalidate(); unsubscribe(); };
  }, [enabled, invalidate, refresh, revision]);
  return { data, loading, failed, refresh };
}
