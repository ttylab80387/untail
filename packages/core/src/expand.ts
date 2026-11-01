import type { Expander, ExpandFailure, FetchFn, HiddenChar, RemovedItem } from './types';
import { compile, matches } from './regex';
import { canonicalUrl, getHost, getPath, getParam, matchView, parseUrl } from './query';
import { sameSite } from './site';
import { scanHidden } from './hidden';
import { takeUrl } from './extract';

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
  hidden?: HiddenChar[]; // hidden characters found in (and removed from) redirect targets
}

const MAX_HOPS = 6;

// Why expansion stopped, and every hop it got to.
class Stopped extends Error {
  constructor(
    readonly reason: ExpandFailure,
    readonly trail: string[],
  ) {
    super(reason);
  }
}

export function findExpander(url: string, expanders: Record<string, Expander>): Expander | undefined {
  const view = matchView(url);
  return Object.values(expanders).find((e) => matches(e.match, view));
}

function findLoginWall(url: string, expanders: Record<string, Expander>): Expander['loginWall'] {
  const view = matchView(url);
  return Object.values(expanders).find((e) => e.loginWall && matches(e.loginWall.match, view))?.loginWall;
}

function normalizeHost(url: string, expanders: Record<string, Expander>): string {
  const host = getHost(url);
  for (const e of Object.values(expanders)) {
    const to = e.normalizeHost?.[host];
    if (to) return url.replace(AUTHORITY_PREFIX, `$1${to}`);
  }
  return url;
}

// The next hop a browser would take for a Location header; null when it would not open it.
// Hidden characters are removed (and recorded) first, so they cannot hide a login wall, a wrapper
// or the site a hop goes to.
function nextHop(location: string, base: string, hidden: HiddenChar[]): string | null {
  const scanned = scanHidden(location);
  const target = HTTP.test(scanned.url) ? scanned.url : parseUrl(scanned.url, base)?.href;
  const taken = target ? takeUrl(target) : null;
  if (!taken) return null;
  hidden.push(...scanned.found, ...taken.hidden);
  return taken.url;
}

// Follows redirects one at a time in manual mode, under one deadline. A hop to another site, a login
// wall (its next param is the answer) and the first hop of a firstHop expander are taken from Location
// and returned without being requested, so expansion never contacts the destination.
// Resolves to the trail: [url, ...every later hop]; the last entry is the answer.
async function resolve(
  url: string,
  expanders: Record<string, Expander>,
  opts: ExpandOptions,
  firstHop: boolean,
  hidden: HiddenChar[],
): Promise<string[]> {
  const controller = new AbortController();
  const headers = { 'User-Agent': opts.userAgent };
  const trail = [url];
  const current = () => trail[trail.length - 1]!;
  const send = (method: 'HEAD' | 'GET') => {
    // Never start a request after the deadline has passed.
    if (controller.signal.aborted) throw new Stopped('expand_timeout', [...trail]);
    // Android release builds refuse cleartext, and https hides the link from the network.
    const target = current().replace(/^http:\/\//i, 'https://');
    return opts.fetch(target, { method, headers, signal: controller.signal, redirect: 'manual' });
  };
  const work = (async () => {
    try {
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        let res = await send('HEAD');
        // Some services refuse HEAD (405, 404, or 403 on momo.dm) but still redirect GET. Other errors,
        // such as 401 or 429, say nothing about HEAD, so they are not retried.
        if (res.status === 403 || res.status === 404 || res.status === 405) res = await send('GET');
        if (!(res.status >= 300 && res.status < 400 && res.location)) {
          if (res.status >= 400) throw new Stopped('network', [...trail]);
          return trail;
        }
        const next = nextHop(res.location, current(), hidden);
        if (!next) throw new Stopped('unresolved', [...trail]);
        const stop = firstHop || findLoginWall(next, expanders) !== undefined || !sameSite(next, current());
        trail.push(next);
        if (stop) return trail;
      }
      throw new Stopped('unresolved', [...trail]); // too many redirects on one site
    } catch (e) {
      if (controller.signal.aborted) throw new Stopped('expand_timeout', [...trail]);
      throw e instanceof Stopped ? e : new Stopped('network', [...trail]);
    }
  })();
  work.catch(() => {}); // a rejection after the deadline must not surface as unhandled

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Stopped('expand_timeout', [...trail]));
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

  // Always ask over https: it hides the link from the network, and Android release builds
  // refuse cleartext requests (Xiaohongshu shares http://xhslink.com links).
  const requestUrl = url.replace(/^http:\/\//i, 'https://');
  const hidden: HiddenChar[] = [];
  let trail: string[];
  try {
    trail = await resolve(requestUrl, expanders, opts, expander.firstHop === true, hidden);
  } catch (e) {
    const t = e instanceof Stopped ? e.trail : [requestUrl];
    return fail(e instanceof Stopped ? e.reason : 'network', [url, ...t.slice(1)]);
  }
  const raw = trail[trail.length - 1]!;

  // Redirect targets get the same browser-equivalent spelling as user input;
  // one a browser would refuse leaves the link unresolved.
  const finalUrl = canonicalUrl(raw);
  if (!finalUrl) return fail('unresolved', [url, ...trail.slice(1)]);
  const hops = [url, ...trail.slice(1, -1), finalUrl];
  let resolved = finalUrl;
  const wall = findLoginWall(finalUrl, expanders);
  if (wall) {
    const param = getParam(finalUrl, wall.param);
    const taken = param ? takeUrl(param) : null;
    if (taken) hidden.push(...taken.hidden);
    const next = taken?.url ?? null;
    if (!next || findLoginWall(next, expanders)) return fail('unresolved', hops);
    resolved = next;
    hops.push(resolved);
  }
  // A different URL that is again a short/share link is handed back to processUrl's loop.
  if (!HTTP.test(resolved) || resolved === url || resolved === requestUrl) return fail('unresolved', hops);

  const normalized = normalizeHost(resolved, expanders);
  if (normalized !== resolved) hops.push(normalized);

  const removed: RemovedItem[] = [];
  const id = expander.shareId ? compile(expander.shareId)?.exec(getPath(url))?.[1] : undefined;
  if (id) removed.push({ key: 'share-id', value: id, host: getHost(url) });

  const result: ExpandResult = { url: normalized, hops, removed };
  if (hidden.length) result.hidden = hidden;
  return result;
}
