import type { HiddenChar, Provider } from './types';
import { compile } from './regex';
import { canonicalUrl, matchView, safeDecode } from './query';
import { takeUrl } from './extract';
import { activeProviders } from './providers';

export interface UnwrapResult {
  url: string;
  hops: string[];
  complete: boolean; // false when more wrappers remain after MAX_DEPTH
  hidden?: HiddenChar[]; // hidden characters found in (and removed from) unwrapped targets
}

const MAX_DEPTH = 3;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BARE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]|$)/i;

function toHttpUrl(captured: string, hidden: HiddenChar[]): string | null {
  // Try the raw capture first so already-usable targets keep encoded bytes such as %2F;
  // only percent-encoded wrappers (u=https%3A%2F%2F...) need decoding.
  // The target gets the same browser-equivalent spelling as user input; one a browser would
  // refuse is no target at all.
  for (const candidate of [captured, safeDecode(captured)]) {
    // Hidden characters in the target are found and removed before it is used, like user input.
    const taken = takeUrl(candidate);
    if (taken) {
      hidden.push(...taken.hidden);
      return taken.url;
    }
    // ClearURLs captures may omit the scheme (e.g. Google AMP /amp/s/example.com/p).
    const bare = !SCHEME.test(candidate) && BARE_HOST.test(candidate) ? canonicalUrl(`https://${candidate}`) : null;
    if (bare) return bare;
  }
  return null;
}

function unwrapOnce(url: string, providers: Record<string, Provider>, hidden: HiddenChar[]): string | null {
  const view = matchView(url);
  for (const p of activeProviders(url, providers)) {
    for (const r of p.redirections ?? []) {
      const captured = compile(r)?.exec(view)?.[1];
      const target = captured ? toHttpUrl(captured, hidden) : null;
      if (target && target !== url) return target;
    }
  }
  return null;
}

function withHidden(r: UnwrapResult, hidden: HiddenChar[]): UnwrapResult {
  if (hidden.length) r.hidden = hidden;
  return r;
}

export function unwrapUrl(url: string, providers: Record<string, Provider>): UnwrapResult {
  const hops = [url];
  const hidden: HiddenChar[] = [];
  let cur = url;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const next = unwrapOnce(cur, providers, hidden);
    if (!next) return withHidden({ url: cur, hops, complete: true }, hidden);
    cur = next;
    hops.push(cur);
  }
  return withHidden({ url: cur, hops, complete: unwrapOnce(cur, providers, []) === null }, hidden);
}
