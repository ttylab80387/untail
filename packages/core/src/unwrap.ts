import type { Provider } from './types';
import { compile } from './regex';
import { canonicalUrl, matchView, safeDecode } from './query';
import { activeProviders } from './providers';

export interface UnwrapResult {
  url: string;
  hops: string[];
  complete: boolean; // false when more wrappers remain after MAX_DEPTH
}

const MAX_DEPTH = 3;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BARE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]|$)/i;

function toHttpUrl(captured: string): string | null {
  // Try the raw capture first so already-usable targets keep encoded bytes such as %2F;
  // only percent-encoded wrappers (u=https%3A%2F%2F...) need decoding.
  // The target gets the same browser-equivalent spelling as user input; one a browser would
  // refuse is no target at all.
  for (const candidate of [captured, safeDecode(captured)]) {
    const canonical = canonicalUrl(candidate);
    if (canonical) return canonical;
    // ClearURLs captures may omit the scheme (e.g. Google AMP /amp/s/example.com/p).
    const bare = !SCHEME.test(candidate) && BARE_HOST.test(candidate) ? canonicalUrl(`https://${candidate}`) : null;
    if (bare) return bare;
  }
  return null;
}

function unwrapOnce(url: string, providers: Record<string, Provider>): string | null {
  const view = matchView(url);
  for (const p of activeProviders(url, providers)) {
    for (const r of p.redirections ?? []) {
      const captured = compile(r)?.exec(view)?.[1];
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
