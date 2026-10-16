import type { HiddenChar, UrlPart } from './types';

// Invisible characters that can break a link, tag who copied it, or disguise it.
// Written as escapes and matched one character at a time, so no `u` flag is needed (Hermes).
const ALWAYS = /^[\u200B\uFEFF\u2060\u00AD\u202A-\u202E]$/;
const HOST_ONLY = /^[\u200E\u200F\u2066-\u2069]$/; // direction marks/isolates: removed from the hostname only
const KEEP = /^[\u200C\u200D]$/; // ZWNJ/ZWJ: needed by IDN, Persian and emoji, never removed
const TAG = /^\uDB40[\uDC00-\uDC7F]$/; // U+E0000–U+E007F as a surrogate pair
// UTF-8 of exactly the characters above: U+200B–U+200F, U+202A–U+202E, U+2060, U+2066–U+2069,
// U+FEFF, U+00AD and tag characters.
const ENCODED = /^(?:%E2%80%8[B-F]|%E2%80%A[A-E]|%E2%81%A[06-9]|%EF%BB%BF|%C2%AD|%F3%A0%8[01]%[89AB][0-9A-F])/i;

const code = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

// Where each part starts: userinfo ends at the last '@' of the authority; the authority ends at / \ ? #.
function partAt(url: string, scheme: number): (i: number) => UrlPart {
  const cut = url.slice(scheme).search(/[/\\?#]/);
  const authEnd = cut < 0 ? url.length : scheme + cut;
  const at = url.lastIndexOf('@', authEnd - 1);
  const hostStart = at >= scheme ? at + 1 : scheme;
  const h = url.indexOf('#', authEnd);
  const fragStart = h < 0 ? Infinity : h;
  const q = url.indexOf('?', authEnd);
  const queryStart = q < 0 || q > fragStart ? Infinity : q;
  return (i) => {
    if (scheme === 0) return 'path';
    if (i < hostStart) return 'userinfo';
    if (i < authEnd) return 'host';
    if (i >= fragStart) return 'fragment';
    if (i >= queryStart) return 'query';
    return 'path';
  };
}

export function scanHidden(url: string): { url: string; found: HiddenChar[] } {
  const scheme = /^[a-z][a-z0-9+.-]*:[/\\]*/i.exec(url)?.[0].length ?? 0;
  const part = partAt(url, scheme);
  const found: HiddenChar[] = [];
  const seen = new Set<string>();
  const note = (h: HiddenChar) => {
    const k = `${h.code}|${h.part}|${h.removed}|${h.encoded ?? ''}`;
    if (!seen.has(k)) {
      seen.add(k);
      found.push(h);
    }
  };
  let out = url.slice(0, scheme);
  let i = scheme;
  for (const ch of url.slice(scheme)) {
    const p = part(i);
    if (ch === '%') {
      const m = ENCODED.exec(url.slice(i, i + 12));
      if (m) note({ code: code(decodeURIComponent(m[0])), part: p, removed: false, index: i, encoded: true });
    }
    const always = ALWAYS.test(ch) || TAG.test(ch);
    const hidden = always || HOST_ONLY.test(ch) || KEEP.test(ch);
    const remove = hidden && p !== 'userinfo' && (always || (p === 'host' && HOST_ONLY.test(ch)));
    if (hidden) note({ code: code(ch), part: p, removed: remove, index: i });
    if (!remove) out += ch;
    i += ch.length;
  }
  return { url: out, found };
}
