import type { Expander, FetchFn, ProcessResult, Reason, RemovedItem, RuleBundle } from './types';
import { extractUrl } from './extract';
import { unwrapUrl } from './unwrap';
import { findExpander, expandUrl, DEFAULT_USER_AGENT, DEFAULT_TIMEOUT_MS } from './expand';
import { cleanUrl } from './clean';
import { analyze } from './analyze';
import { safeDecode } from './query';

const MAX_EXPANSIONS = 3;
const MIN_SHARE_ID_LENGTH = 6; // shorter IDs would match by coincidence
const EMBEDDED_URL = /https?:\/\/[^\s"'<>&]+/gi;

// Last line of defence: the cleaned URL must not still carry a share ID we removed
// upstream, nor embed another short/share link (e.g. a new login page or param name).
function stillTracked(url: string, shareIds: string[], expanders: Record<string, Expander>): boolean {
  const views = [url, safeDecode(url), safeDecode(safeDecode(url))];
  const ids = shareIds.filter((id) => id.length >= MIN_SHARE_ID_LENGTH);
  if (views.some((v) => ids.some((id) => v.includes(id)))) return true;
  return views.some((v) => (v.slice(1).match(EMBEDDED_URL) ?? []).some((u) => findExpander(u, expanders)));
}

export interface ProcessOptions {
  expand: boolean;
  locale: string;
  fetch?: FetchFn;
  userAgent?: string;
  timeoutMs?: number;
}

export async function processUrl(input: string, rules: RuleBundle, opts: ProcessOptions): Promise<ProcessResult> {
  const extracted = extractUrl(input);
  if (!extracted) {
    return { originalUrl: input.trim(), cleanUrl: '', status: 'failed', reason: 'invalid_input', removed: [], hops: [] };
  }

  const hops = [extracted];
  const visit = (next: string) => {
    if (next !== hops[hops.length - 1]) hops.push(next);
  };
  const removed: RemovedItem[] = [];
  let reason: Reason | undefined;

  const first = unwrapUrl(extracted, rules.providers);
  first.hops.forEach(visit);
  let url = first.url;
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
        const u = unwrapUrl(r.url, rules.providers);
        u.hops.forEach(visit);
        url = u.url;
        if (!u.complete) reason = 'unresolved';
      }
    }
  }

  const cleaned = cleanUrl(url, rules.providers);
  removed.push(...cleaned.removed);

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
  return result;
}
