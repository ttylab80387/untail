/// <reference path="./punycode.d.ts" />
import { parse } from 'tldts';
// The npm package, not Node's deprecated built-in of the same name.
import punycode from 'punycode/punycode.js';
import { FORBIDDEN_HOST, getHost, mapHost } from './query';
import type { SiteInfo } from './types';

function asciiOf(host: string): string | null {
  const mapped = mapHost(host);
  if (mapped.startsWith('[')) return mapped;
  if (FORBIDDEN_HOST.test(mapped)) return null; // a browser would refuse this host
  try {
    return punycode.toASCII(mapped);
  } catch {
    return mapped;
  }
}

function unicodeOf(ascii: string): string {
  try {
    return punycode.toUnicode(ascii);
  } catch {
    return ascii;
  }
}

// Where a link really goes: the host and its registrable ("main") domain.
// Private suffixes count, so alice.github.io and bob.github.io are different sites.
export function siteOf(url: string): SiteInfo | null {
  const host = getHost(url);
  if (!host) return null;
  const asciiHost = asciiOf(host);
  if (!asciiHost) return null;
  // The input is already a hostname; never let tldts look for one inside it.
  const p = parse(asciiHost, { allowPrivateDomains: true, extractHostname: false });
  const isIp = asciiHost.startsWith('[') || p.isIp === true;
  const asciiDomain = isIp ? null : (p.domain ?? null);
  return { host: unicodeOf(asciiHost), domain: asciiDomain && unicodeOf(asciiDomain), asciiHost, asciiDomain, isIp };
}

export function sameSite(a: string, b: string): boolean {
  const x = siteOf(a);
  const y = siteOf(b);
  return !!x && !!y && (x.asciiDomain ?? x.asciiHost) === (y.asciiDomain ?? y.asciiHost);
}
