import type { Expander, ExpandFailure, FetchFn, RemovedItem } from './types';
import { compile, matches } from './regex';
import { getHost, getPath, getParam } from './query';

export const DEFAULT_USER_AGENT = 'Untail/0.1';
export const DEFAULT_TIMEOUT_MS = 5000;

const HTTP = /^https?:\/\//i;
const AUTHORITY_PREFIX = /^([a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?)[^/?#:]+/i;

export interface ExpandOptions {
  fetch: FetchFn;
  userAgent: string;
  timeoutMs: number;
}

export interface ExpandResult {
  url: string;
  hops: string[];
  removed: RemovedItem[];
  reason?: ExpandFailure;
}

class TimeoutError extends Error {}

class HttpError extends Error {
  constructor(readonly finalUrl: string) {
    super('HTTP error');
  }
}

export function findExpander(url: string, expanders: Record<string, Expander>): Expander | undefined {
  return Object.values(expanders).find((e) => matches(e.match, url));
}

function findLoginWall(url: string, expanders: Record<string, Expander>): Expander['loginWall'] {
  return Object.values(expanders).find((e) => e.loginWall && matches(e.loginWall.match, url))?.loginWall;
}

function normalizeHost(url: string, expanders: Record<string, Expander>): string {
  const host = getHost(url);
  for (const e of Object.values(expanders)) {
    const to = e.normalizeHost?.[host];
    if (to) return url.replace(AUTHORITY_PREFIX, `$1${to}`);
  }
  return url;
}

// Race the request against a hard deadline so a fetch that ignores abort cannot hang the caller.
async function resolve(url: string, opts: ExpandOptions): Promise<string> {
  const controller = new AbortController();
  const headers = { 'User-Agent': opts.userAgent };
  const work = (async () => {
    try {
      let res = await opts.fetch(url, { method: 'HEAD', headers, signal: controller.signal });
      if (res.status === 405) {
        // Never start a follow-up request after the deadline has passed.
        if (controller.signal.aborted) throw new TimeoutError();
        res = await opts.fetch(url, { method: 'GET', headers, signal: controller.signal });
      }
      if (res.status >= 400) throw new HttpError(res.url || url);
      return res.url || url;
    } catch (e) {
      throw controller.signal.aborted ? new TimeoutError() : e;
    }
  })();
  work.catch(() => {}); // a rejection after the deadline must not surface as unhandled

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError());
    }, opts.timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function expandUrl(url: string, expanders: Record<string, Expander>, opts: ExpandOptions): Promise<ExpandResult> {
  const expander = findExpander(url, expanders);
  if (!expander) return { url, hops: [url], removed: [] };
  const fail = (reason: ExpandFailure, hops: string[] = [url]): ExpandResult => ({ url, hops, removed: [], reason });

  let finalUrl: string;
  try {
    finalUrl = await resolve(url, opts);
  } catch (e) {
    if (e instanceof HttpError) return fail('network', e.finalUrl === url ? [url] : [url, e.finalUrl]);
    return fail(e instanceof TimeoutError ? 'expand_timeout' : 'network');
  }

  const hops = [url, finalUrl];
  let resolved = finalUrl;
  const wall = findLoginWall(finalUrl, expanders);
  if (wall) {
    const next = getParam(finalUrl, wall.param);
    if (!next || !HTTP.test(next) || findLoginWall(next, expanders)) return fail('unresolved', hops);
    resolved = next;
    hops.push(resolved);
  }
  // A different URL that is again a short/share link is handed back to processUrl's loop.
  if (!HTTP.test(resolved) || resolved === url) return fail('unresolved', hops);

  const normalized = normalizeHost(resolved, expanders);
  if (normalized !== resolved) hops.push(normalized);

  const removed: RemovedItem[] = [];
  const id = expander.shareId ? compile(expander.shareId)?.exec(getPath(url))?.[1] : undefined;
  if (id) removed.push({ key: 'share-id', value: id, host: getHost(url) });

  return { url: normalized, hops, removed };
}
