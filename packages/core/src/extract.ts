import { canonicalUrl } from './query';
import { scanHidden } from './hidden';
import type { HiddenChar } from './types';

// \s without U+FEFF: a BOM inside a link must not end it.
const WS = '\\t\\n\\v\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
// Stop at whitespace, '"', '<', '>' and full-width punctuation; raw non-ASCII
// (e.g. Chinese product names in shopee.tw paths) stays part of the URL. 。 is decided below.
const URL_RE = new RegExp(`https?:[/\\\\]+[^${WS}"<>《》“”‘’，、；：！？「」『』（）【】]+`, 'i');
const TRAILING = /[.,;:!?'*]+$/;
const STOP = '\u3002';
const HOST_DROPPED = /[\u200B\uFEFF\u2060\u00AD]/g;
// Whitespace plus the invisible characters that can surround a copied link.
const EDGE = /^[\s\u200B\u2060]+|[\s\u200B\u2060]+$/g;

export interface Extracted {
  url: string; // what a browser would open, hidden characters removed
  hidden: HiddenChar[];
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

// 。 separates labels inside a host. A bare URL keeps every one in its host; in prose a 。 ends the
// URL unless it sits in the host and the whole label after it is ASCII (Chinese sentences end with 。
// right after links far more often than an IDN puts 。 before a Chinese label).
function cutAtSentenceEnd(s: string, bare: boolean): string {
  const hostStart = /^https?:[/\\]+/i.exec(s)![0].length;
  const tail = s.slice(hostStart).search(/[/\\?#]/);
  const hostEnd = tail < 0 ? s.length : hostStart + tail;
  for (let i = s.indexOf(STOP); i >= 0; i = s.indexOf(STOP, i + 1)) {
    // Hidden characters a browser drops from a host do not count as part of the label.
    const label = /^[^.\u3002]*/.exec(s.slice(i + 1, hostEnd))![0].replace(HOST_DROPPED, '');
    const inHost = i < hostEnd;
    // An empty label is a sentence end; in prose only a letter label (a TLD-like word) continues the host,
    // so 。10/20 or 。下一句 end the URL.
    if (!inHost || !label || (!bare && !/^[A-Za-z][A-Za-z-]*$/.test(label))) return s.slice(0, i);
  }
  return s;
}

function trimTrailing(s: string): string {
  let url = s;
  for (;;) {
    const trimmed = url.replace(TRAILING, '');
    if (trimmed.endsWith(')') && count(trimmed, '(') < count(trimmed, ')')) {
      url = trimmed.slice(0, -1);
      continue;
    }
    return trimmed;
  }
}

// Scan, canonicalize, and scan again: a browser decodes an encoded host, which can reveal more.
export function takeUrl(candidate: string): Extracted | null {
  const first = scanHidden(candidate);
  const canon = canonicalUrl(first.url);
  if (!canon) return null;
  const second = scanHidden(canon);
  const url = second.found.some((h) => h.removed) ? canonicalUrl(second.url) : canon;
  if (!url) return null;
  // An encoded character in the host is decoded by the browser, so it is gone from the host Untail
  // outputs either way (mapped out by canonicalUrl, or removed by the second scan).
  const hidden: HiddenChar[] = [];
  const seen = new Set<string>();
  for (const h of [...first.found, ...second.found.filter((x) => x.removed)]) {
    const f: HiddenChar = h.encoded && h.part === 'host' ? { code: h.code, part: h.part, removed: true, index: h.index } : h;
    const k = `${f.code}|${f.part}|${f.removed}|${f.encoded ?? ''}`;
    if (!seen.has(k)) {
      seen.add(k);
      hidden.push(f);
    }
  }
  return { url, hidden };
}

export function extractUrlDetailed(text: string): Extracted | null {
  const m = URL_RE.exec(text);
  if (!m) return null;
  // A bare URL is taken verbatim; trailing punctuation is only trimmed when the URL sits in prose.
  const bare = text.replace(EDGE, '') === m[0].replace(EDGE, '');
  const raw = cutAtSentenceEnd(m[0], bare);
  if (bare) return takeUrl(raw);
  // A hidden character may sit between the URL and its punctuation, so trim before and after it.
  const stripped = scanHidden(trimTrailing(raw));
  const r = takeUrl(trimTrailing(stripped.url));
  return r && { url: r.url, hidden: [...stripped.found, ...r.hidden.filter((h) => h.removed)] };
}

export function extractUrl(text: string): string | null {
  return extractUrlDetailed(text)?.url ?? null;
}
