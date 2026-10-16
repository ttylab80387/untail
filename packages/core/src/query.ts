import { URL as WhatwgURL } from 'whatwg-url-minimum';

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

// Parsed exactly as a browser does (WHATWG URL). whatwg-url-minimum is the parser Expo installs
// as the app's global URL, so tests on Node and the app agree (it skips IDNA, leaving Unicode
// hosts as written).
export function parseUrl(url: string, base?: string): URL | null {
  try {
    return base === undefined ? new WhatwgURL(url) : new WhatwgURL(url, base);
  } catch {
    return null;
  }
}

// What rules are matched against: the URL without userinfo, which never decides the site
// (https://facebook.com@evil.example opens evil.example).
export function matchView(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(url)) return url;
  const u = parseUrl(url);
  if (!u) return url;
  u.username = '';
  u.password = '';
  return u.href;
}

// Characters a browser drops from a host (UTS #46 "ignored"), and the ideographic/full-width full stops it reads as dots.
const HOST_IGNORED = /[\u00AD\u034F\u180B-\u180F\u200B\u2060\uFE00-\uFE0F\uFEFF]/g;
const HOST_DOTS = /[\u3002\uFF0E\uFF61]/g;
export const FORBIDDEN_HOST = /[\s#%/:<>?@[\\\]^|]/;

// The host a browser connects to, before punycode. whatwg-url-minimum skips IDNA, so this mapping is done here.
export function mapHost(host: string): string {
  if (host.startsWith('[')) return host; // IPv6
  const kept = host.replace(HOST_IGNORED, '');
  const nfkc = typeof kept.normalize === 'function' ? kept.normalize('NFKC') : kept;
  return nfkc.replace(HOST_DOTS, '.').toLowerCase().replace(/\.$/, '');
}

export function getHost(url: string): string {
  return parseUrl(url)?.hostname.toLowerCase() ?? '';
}

export function getPath(url: string): string {
  const u = parseUrl(url);
  return u?.hostname ? u.pathname : '';
}

// The http(s) URL a browser would open for `url`, or null when a browser would refuse it.
// An ordinary URL comes back exactly as written, so raw non-ASCII and the original query survive;
// an odd spelling (backslashes, extra slashes, dot segments, an encoded host) is rewritten so every
// later rule, expansion and share-id lookup sees the real destination.
export function canonicalUrl(url: string): string | null {
  const u = parseUrl(url);
  if (!u?.hostname || !/^https?:$/.test(u.protocol)) return null;
  const mapped = mapHost(u.hostname);
  // A browser refuses a host that maps to a URL delimiter (full-width slash, at sign, ...): so does Untail,
  // otherwise a full-width slash after shopee.tw would make evil.com read as shopee.tw.
  if (FORBIDDEN_HOST.test(mapped.replace(/^\[.*\]$/, ''))) return null;
  // A host that maps to plain ASCII (full-width letters, ignorable characters) is the ASCII site,
  // so rules, expansion and display all see it. Unicode (IDN) hosts stay as written.
  const dot = u.hostname.endsWith('.') ? '.' : '';
  if (mapped + dot !== u.hostname && /^[a-z0-9.-]+$/.test(mapped)) {
    u.hostname = mapped + dot;
    return u.href;
  }
  // Compare scheme + authority as written (an encoded host must be rewritten) and the path decoded
  // (raw non-ASCII equals its percent-encoded form).
  const parts = (s: string) => {
    const m = /^([a-z]+:\/\/[^/?#]*)([^?#]*)/i.exec(s);
    return m ? [m[1]!.toLowerCase(), safeDecode(m[2] || '/')] : ['', ''];
  };
  // Browsers drop tabs and newlines anywhere in a URL, which changes parameter names.
  if (/[\t\r\n]/.test(url)) return u.href;
  const [rawAuth, rawPath] = parts(url);
  const [auth, path] = parts(u.href);
  return rawAuth === auth && rawPath === path ? url : u.href;
}
