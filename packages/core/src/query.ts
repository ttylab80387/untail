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

const AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#:@]+)/i;
const PATH = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i;

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
  return AUTHORITY.exec(url)?.[1]?.toLowerCase() ?? '';
}

export function getPath(url: string): string {
  const m = PATH.exec(url);
  if (!m) return '';
  return m[1] || '/';
}
