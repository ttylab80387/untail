// Text download for the rules site. A hung request must end, or the update would never be classified.
export const FETCH_TIMEOUT_MS = 15_000;

export function makeFetchText(fetchImpl: typeof fetch, timeoutMs = FETCH_TIMEOUT_MS): (url: string) => Promise<string> {
  return async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  };
}
