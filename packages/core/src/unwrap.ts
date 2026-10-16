import type { Provider } from './types';
import { compile } from './regex';
import { canonicalUrl, safeDecode } from './query';
import { activeProviders } from './providers';

export interface UnwrapResult {
  url: string;
  hops: string[];
  complete: boolean; // false when more wrappers remain after MAX_DEPTH
}

const MAX_DEPTH = 3;
const HTTP = /^https?:\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BARE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]|$)/i;

function toHttpUrl(captured: string): string | null {
  // Try the raw capture first so already-usable targets keep encoded bytes such as %2F;
  // only percent-encoded wrappers (u=https%3A%2F%2F...) need decoding.
  // The target gets the same browser-equivalent spelling as user input; one a browser would
  // refuse is no target at all.
  for (const candidate of [captured, safeDecode(captured)]) {
    // ClearURLs captures may omit the scheme (e.g. Google AMP /amp/s/example.com/p).
    const url = HTTP.test(candidate)
      ? candidate
      : !SCHEME.test(candidate) && BARE_HOST.test(candidate)
        ? `https://${candidate}`
        : null;
    const canonical = url ? canonicalUrl(url) : null;
    if (canonical) return canonical;
  }
  return null;
}

function unwrapOnce(url: string, providers: Record<string, Provider>): string | null {
  for (const p of activeProviders(url, providers)) {
    for (const r of p.redirections ?? []) {
      const captured = compile(r)?.exec(url)?.[1];
      const target = captured ? toHttpUrl(captured) : null;
      if (target && target !== url) return target;
    }
  }
  return null;
}

export function unwrapUrl(url: string, providers: Record<string, Provider>): UnwrapResult {
  const hops = [url];
  let cur = url;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const next = unwrapOnce(cur, providers);
    if (!next) return { url: cur, hops, complete: true };
    cur = next;
    hops.push(cur);
  }
  return { url: cur, hops, complete: unwrapOnce(cur, providers) === null };
}
