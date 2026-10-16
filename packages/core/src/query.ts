export interface QueryPair {
  raw: string; // original "key=value" text, re-emitted untouched
  key: string; // decoded, for matching
  value: string; // decoded, for display
}

export interface SplitUrl {
  base: string; // everything before "?"
  pairs: QueryPair[];
  hash: string; // "#..." or ""
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const SPECIAL = /^(?:https?|wss?|ftp)$/i;

// Splits off the host the way browsers do (WHATWG URL), so a link is judged by where it really goes.
// For http(s) "\" counts as "/", extra slashes after the scheme are skipped and userinfo ends at
// the last "@". Returns the lowercased host and everything after the authority.
function authority(url: string): { host: string; rest: string } | null {
  const m = SCHEME.exec(url);
  if (!m) return null;
  const special = SPECIAL.test(m[1]!);
  let i = m[0].length;
  if (special) {
    while (url[i] === '/' || url[i] === '\\') i++;
  } else if (url.startsWith('//', i)) {
    i += 2;
  } else {
    return null;
  }
  let end = i;
  while (end < url.length && !'/?#'.includes(url[end]!) && !(special && url[end] === '\\')) end++;
  let auth = url.slice(i, end);
  auth = auth.slice(auth.lastIndexOf('@') + 1);
  let host: string;
  if (auth.startsWith('[')) {
    const close = auth.indexOf(']');
    host = close >= 0 ? auth.slice(0, close + 1) : '';
  } else {
    const colon = auth.indexOf(':');
    host = colon >= 0 ? auth.slice(0, colon) : auth;
  }
  return { host: host.toLowerCase(), rest: url.slice(end) };
}

export function safeDecode(s: string, plusAsSpace = false): string {
  try {
    return decodeURIComponent(plusAsSpace ? s.replace(/\+/g, ' ') : s);
  } catch {
    return s;
  }
}

export function splitUrl(url: string): SplitUrl {
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const noHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = noHash.indexOf('?');
  if (qIdx < 0) return { base: noHash, pairs: [], hash };

  const pairs = noHash
    .slice(qIdx + 1)
    .split('&')
    .map((raw) => {
      const eq = raw.indexOf('=');
      const k = eq >= 0 ? raw.slice(0, eq) : raw;
      const v = eq >= 0 ? raw.slice(eq + 1) : '';
      return { raw, key: safeDecode(k, true), value: safeDecode(v, true) };
    });
  return { base: noHash.slice(0, qIdx), pairs, hash };
}

export function joinUrl({ base, pairs, hash }: SplitUrl): string {
  const q = pairs.map((p) => p.raw).join('&');
  return base + (q ? `?${q}` : '') + hash;
}

export function getParam(url: string, name: string): string | undefined {
  return splitUrl(url).pairs.find((p) => p.key === name)?.value;
}

export function getHost(url: string): string {
  return authority(url)?.host ?? '';
}

export function getPath(url: string): string {
  const a = authority(url);
  if (!a?.host) return '';
  const path = a.rest.replace(/[?#].*$/s, '').replace(/\\/g, '/');
  return path || '/';
}
