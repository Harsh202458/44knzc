import { useEffect, useRef, useState } from "react";
import { getJson } from "./api";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

// Responses are immutable (historical snapshot), so cache them for the session.
const cache = new Map<string, unknown>();
// Share one request between components asking for the same URL at the same time.
const inflight = new Map<string, Promise<unknown>>();

function load<T>(url: string): Promise<T> {
  let p = inflight.get(url) as Promise<T> | undefined;
  if (!p) {
    p = getJson<T>(url).finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}

/** Fetch JSON for `url` (null = skip). Keeps the previous data while reloading. */
export function useApi<T>(url: string | null): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({
    data: url && cache.has(url) ? (cache.get(url) as T) : null,
    error: null,
    loading: !!url && !cache.has(url),
  });
  const latest = useRef(url);

  useEffect(() => {
    latest.current = url;
    if (!url) return;
    if (cache.has(url)) {
      setState({ data: cache.get(url) as T, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    load<T>(url)
      .then((data) => {
        cache.set(url, data);
        if (!cancelled && latest.current === url) setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
