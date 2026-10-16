import type { Expander, FetchFn, HiddenChar, ProcessResult, Reason, RemovedItem, RuleBundle } from './types';
import { extractUrlDetailed, takeUrl } from './extract';
import { scanHidden } from './hidden';
import { unwrapUrl } from './unwrap';
import { findExpander, expandUrl, DEFAULT_USER_AGENT, DEFAULT_TIMEOUT_MS } from './expand';
import { cleanUrl } from './clean';
import { analyze } from './analyze';
import { canonicalUrl, getHost, safeDecode } from './query';
import { siteOf } from './site';

const MAX_EXPANSIONS = 3;
const MIN_SHARE_ID_LENGTH = 6; // shorter IDs would match by coincidence
const EMBEDDED_URL = /https?:[/\\]+[^\s"'<>&]+/gi;

// Last line of defence: the cleaned URL must not still carry a share ID we removed
// upstream, nor embed another short/share link (e.g. a new login page or param name).
function stillTracked(url: string, shareIds: string[], expanders: Record<string, Expander>): boolean {
  const views = [url, safeDecode(url), safeDecode(safeDecode(url))];
  const ids = shareIds.filter((id) => id.length >= MIN_SHARE_ID_LENGTH);
  if (views.some((v) => ids.some((id) => v.includes(id)))) return true;
  return views.some((v) =>
    (v.slice(1).match(EMBEDDED_URL) ?? []).some((u) => findExpander(canonicalUrl(u) ?? u, expanders)),
  );
}

// Where the link goes: the clean URL when finished, otherwise the last hop reached.
export function destinationOf(r: Pick<ProcessResult, 'status' | 'cleanUrl' | 'hops'>): ProcessResult['destination'] {
  if (r.status === 'failed') return undefined;
  const site = siteOf(r.status === 'clean' ? r.cleanUrl : (r.hops[r.hops.length - 1] ?? r.cleanUrl));
  return site ? { site, complete: r.status === 'clean' } : undefined;
}

export interface ProcessOptions {
  expand: boolean;
  locale: string;
  fetch?: FetchFn;
  userAgent?: string;
  timeoutMs?: number;
}

export async function processUrl(input: string, rules: RuleBundle, opts: ProcessOptions): Promise<ProcessResult> {
  const found = extractUrlDetailed(input);
  if (!found) {
    return { originalUrl: input.trim(), cleanUrl: '', status: 'failed', reason: 'invalid_input', removed: [], hops: [] };
  }

  const extracted = found.url;
  const hops = [extracted];
  const visit = (next: string) => {
    if (next !== hops[hops.length - 1]) hops.push(next);
  };
  const removed: RemovedItem[] = [];
  let reason: Reason | undefined;
  const hidden: HiddenChar[] = [...found.hidden];
  // Redirect targets and unwrapped links get the same hidden-character handling as the input.
  const take = (u: string): string => {
    const r = takeUrl(u);
    if (!r) return u;
    hidden.push(...r.hidden);
    return r.url;
  };

  const first = unwrapUrl(extracted, rules.providers);
  first.hops.forEach(visit);
  hidden.push(...(first.hidden ?? []));
  let url = take(first.url);
  if (!first.complete) reason = 'unresolved';

  // One time budget for the whole chain, not per expansion.
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // Keep expanding while the URL is still a known short/share link.
  for (let i = 0; !reason && findExpander(url, rules.expanders); i++) {
    const remaining = deadline - Date.now();
    if (i === MAX_EXPANSIONS) {
      reason = 'unresolved';
    } else if (!opts.expand || !opts.fetch) {
      reason = 'expand_disabled';
    } else if (remaining <= 0) {
      reason = 'expand_timeout';
    } else {
      const r = await expandUrl(url, rules.expanders, {
        fetch: opts.fetch,
        userAgent: opts.userAgent ?? DEFAULT_USER_AGENT,
        timeoutMs: remaining,
      });
      r.hops.forEach(visit);
      reason = r.reason;
      if (!reason) {
        removed.push(...r.removed);
        hidden.push(...(r.hidden ?? []));
        const u = unwrapUrl(r.url, rules.providers);
        u.hops.forEach(visit);
        hidden.push(...(u.hidden ?? []));
        url = take(u.url);
        if (!u.complete) reason = 'unresolved';
      }
    }
  }

  const host = getHost(extracted);
  const removedCodes = new Set<string>();
  for (const h of hidden.filter((x) => x.removed)) {
    if (removedCodes.has(h.code)) continue; // one row per character kind
    removedCodes.add(h.code);
    removed.push({ key: /^U\+202[A-E]$/.test(h.code) ? 'hidden-bidi' : 'hidden', value: h.code, host });
  }

  const cleaned = cleanUrl(url, rules.providers);
  removed.push(...cleaned.removed);
  // Kept characters are judged on the link the user gets, not on wrappers or removed parameters.
  const kept = scanHidden(cleaned.url).found.filter((h) => !h.removed);

  const shareIds = removed.filter((item) => item.key === 'share-id').map((item) => item.value);
  if (!reason && stillTracked(cleaned.url, shareIds, rules.expanders)) {
    reason = 'unresolved';
    // The share ID was not actually removed, so do not claim it was.
    removed.splice(0, removed.length, ...removed.filter((item) => item.key !== 'share-id'));
  }

  const result: ProcessResult = {
    originalUrl: extracted,
    cleanUrl: cleaned.url,
    status: reason ? 'partial' : 'clean',
    removed: analyze(removed, rules.knowledge, opts.locale),
    hops,
  };
  if (reason) result.reason = reason;
  if (kept.length) result.hiddenKept = kept;
  const destination = destinationOf(result);
  if (destination) result.destination = destination;
  return result;
}
