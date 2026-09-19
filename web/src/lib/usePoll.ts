import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Poll an API call without the usual races:
 * - the next request starts only after the previous one finishes,
 * - a response older than the newest request is ignored,
 * - polling pauses while the tab is hidden and resumes on return,
 * - a failure keeps the last good data and reports the error separately.
 */
export function usePoll<T>(fetcher: () => Promise<T>, everyMs: number | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const value = await fetchRef.current();
      if (mine !== seq.current) return;
      setData(value);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // New subject (e.g. another box): forget the old one's data.
  const key = JSON.stringify(deps);
  useEffect(() => {
    setData(null);
    setError(null);
  }, [key]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (!alive) return;
      if (!document.hidden) await refresh();
      if (alive && everyMs) timer = setTimeout(loop, everyMs);
    };
    loop();
    const wake = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      seq.current++;
    };
  }, [everyMs, refresh, key]);

  return { data, error, updatedAt, refresh };
}
