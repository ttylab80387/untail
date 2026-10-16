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
export function parseUrl(url: string): URL | null {
  try {
    return new WhatwgURL(url);
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
  // Compare scheme + authority as written (an encoded host must be rewritten) and the path decoded
  // (raw non-ASCII equals its percent-encoded form).
  const parts = (s: string) => {
    const m = /^([a-z]+:\/\/[^/?#]*)([^?#]*)/i.exec(s);
    return m ? [m[1]!.toLowerCase(), safeDecode(m[2] || '/')] : ['', ''];
  };
  const [rawAuth, rawPath] = parts(url);
  const [auth, path] = parts(u.href);
  return rawAuth === auth && rawPath === path ? url : u.href;
}
