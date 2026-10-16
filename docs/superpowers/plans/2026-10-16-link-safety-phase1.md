# Link Safety Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show users where a link really goes (main domain, both Unicode and `xn--` forms), find and conservatively strip invisible characters in URLs, and stop short-link expansion from contacting destination sites — without ever claiming a link is safe. The same release also fixes the two Play Console findings (DEX obfuscation, orientation lock).

**Architecture:** All logic lives in `@linkclean/core` (pure TypeScript, vitest on Node) and is consumed by the Expo app. Hosts are compared in one ASCII form (`siteOf`: NFKC + ideographic dots → `.` + punycode + `tldts` with private suffixes). Expansion becomes hop-by-hop with `redirect: 'manual'`: it follows a redirect only when the next hop is on the same registrable domain, is not a login wall, and the deadline has not passed; anything else is read from `Location` and never requested. Hidden characters are found during extraction with their URL part; removed ones join `removed` (categories `hidden`), kept ones are reported separately. `ProcessResult` gains `destination` (site + whether expansion finished) and `hiddenKept`.

**Tech Stack:** TypeScript, vitest, `tldts` (MIT, bundled Public Suffix List, MPL-2.0 data), `punycode` 2.3.1 (MIT), `whatwg-url-minimum` (already used), Expo SDK 57 / React Native 0.86 / Hermes, `expo-build-properties`, i18next (zh-TW / en / ja).

**Spec:** `docs/superpowers/specs/2026-10-16-link-safety-design.md` (phase 1 = §3, §4, §5, §9 licences, plus the §8 wording rules that apply without blocklists)

**Revision:** 2026-10-16, after codex + agy plan reviews (both "revise"). Changes: login wall detected before any request; abort checked before every hop; relative `Location` resolved by the WHATWG parser; partial expansion keeps the destination reached so far; existing tests converted to explicit 3xx; strict regression replay; hidden-character detection keeps part/position and percent-encoded forms; `\u` escapes only, no `u` flag; `。` kept as a host separator; IDN shown in both forms; clipboard gate sees hidden characters; LINE rule narrowed and build order fixed; privacy text covers chained short-link services; licences; on-device Hermes check; plus Task 7 (R8, orientation, Expo patch).

## Global Constraints

- Never say a link is "safe" or that Untail checked it; wording says what was found or done.
- Links are never sent anywhere for the purpose of checking; only short-link expansion makes requests.
- Comments in English; UI strings in zh-TW, en and ja, all three updated together.
- Existing behaviour of `rules/fixtures/cases.json` must not regress (all cases still pass).
- No real share links from the user in any file, fixture or commit; use `TEST…` IDs.
- `tldts` must be called with `{ allowPrivateDomains: true }`.
- ZWJ (U+200D) and ZWNJ (U+200C) are never removed; direction marks/isolates are removed only from the host.
- No invisible character may appear literally in source or test files: always write `​`-style escapes.
- Regexes on hidden characters use `\u` escapes without the `u` flag (Hermes compiles dynamic `new RegExp` at runtime); astral characters are matched as surrogate pairs.
- Percent-encoded hidden characters are detected only, never decoded or changed.
- Bump `apps/mobile/app.json` `android.versionCode` by 1 and `version` patch by 1 for the build that ships this (Task 8 only).
- Run codex + agy review on the finished branch before pushing.

## Review Focus

1. A short link whose `Location` is relative in a form other than `/path` (`../p`, `p`, `?x=1`) must resolve like a browser — Task 4 test.
2. A Facebook share link that redirects to `m.facebook.com/login.php?next=<post>` must yield the post without the login page ever being requested, even when the login page would answer 403 — Task 4 test.
3. Chinese prose `請看https://example.com。謝謝` must extract `https://example.com`, while `https://example。com/` must stay one URL — Task 2 test.
4. A link copied with only a zero-width space and no tracking params must be offered for cleaning from the clipboard, and the result must list the removed character — Task 3 test.
5. When expansion times out after one same-site hop, the result must show the hop reached as "destination so far", not the short link — Task 4 + Task 6 tests.

---

### Task 1: Site info (main domain, IDN-aware) in core

**Files:**
- Create: `packages/core/src/site.ts`, `packages/core/src/punycode.d.ts`
- Modify: `packages/core/src/types.ts` (add `SiteInfo`)
- Modify: `packages/core/src/index.ts` (export `siteOf`, `sameSite`)
- Modify: `packages/core/package.json` (add `tldts`, `punycode`)
- Test: `packages/core/test/site.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SiteInfo {
    host: string;               // for display: Unicode form, lower case, no trailing dot
    domain: string | null;      // registrable domain for display (Unicode); null for IPs and bare public suffixes
    asciiHost: string;          // for comparison: ASCII (punycode) form
    asciiDomain: string | null; // for comparison
    isIp: boolean;
  }
  export function siteOf(url: string): SiteInfo | null;  // null when unparsable or no host
  export function sameSite(a: string, b: string): boolean; // same asciiDomain (or asciiHost when no domain)
  ```

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter @linkclean/core add tldts punycode@2.3.1`
Expected: both listed in `packages/core/package.json` dependencies.

- [ ] **Step 2: Write the failing test** — `packages/core/test/site.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { siteOf, sameSite } from '../src/site';

describe('siteOf', () => {
  it('returns the registrable domain under the public suffix list', () => {
    expect(siteOf('https://shopee.tw.secure-login.xyz/a')).toMatchObject({
      host: 'shopee.tw.secure-login.xyz',
      domain: 'secure-login.xyz',
      isIp: false,
    });
    expect(siteOf('https://news.bbc.co.uk/x')?.domain).toBe('bbc.co.uk');
  });
  it('treats private suffixes as separate sites', () => {
    expect(siteOf('https://alice.github.io/')?.domain).toBe('alice.github.io');
    expect(sameSite('https://alice.github.io/', 'https://bob.github.io/')).toBe(false);
  });
  it('handles IPv4, IPv6, a bare suffix, an unknown suffix and a trailing dot', () => {
    expect(siteOf('http://203.0.113.5/login')).toMatchObject({ host: '203.0.113.5', domain: null, isIp: true });
    expect(siteOf('https://[2001:db8::1]/')).toMatchObject({ host: '[2001:db8::1]', domain: null, isIp: true });
    expect(siteOf('https://co.uk/')).toMatchObject({ host: 'co.uk', domain: null });
    expect(siteOf('https://a.b.notarealtld/')?.domain).toBe('b.notarealtld');
    expect(siteOf('https://Example.COM./x')).toMatchObject({ host: 'example.com', domain: 'example.com' });
  });
  it('gives Unicode and xn-- input the same site, in both forms', () => {
    const u = siteOf('https://例子.台灣/路徑')!;
    const a = siteOf('https://xn--fsqu00a.xn--kpry57d/')!;
    expect(u).toEqual(a);
    expect(u).toMatchObject({ host: '例子.台灣', asciiHost: 'xn--fsqu00a.xn--kpry57d' });
  });
  it('maps full-width letters and ideographic dots like a browser', () => {
    expect(siteOf('https://ｅｘａｍｐｌｅ.com/')?.asciiHost).toBe('example.com');
    expect(sameSite('https://example。com/', 'https://www.example.com/')).toBe(true);
  });
  it('returns null for something that is not a URL', () => {
    expect(siteOf('')).toBeNull();
    expect(siteOf('not a url')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/core && npx vitest run test/site.test.ts`
Expected: FAIL — cannot find module `../src/site`.

- [ ] **Step 4: Implement**

`packages/core/src/punycode.d.ts`:

```ts
declare module 'punycode/punycode.js' {
  const punycode: { toASCII(s: string): string; toUnicode(s: string): string };
  export default punycode;
}
```

`packages/core/src/site.ts`:

```ts
import { parse } from 'tldts';
// The npm package, not Node's deprecated built-in of the same name.
import punycode from 'punycode/punycode.js';
import { getHost } from './query';
import type { SiteInfo } from './types';

const DOTS = /[。．｡]/g; // ideographic and full-width full stops separate labels

// The ASCII form a browser connects to. whatwg-url-minimum skips IDNA, so the mapping a browser
// applies (full-width letters, ideographic dots, case) is done here.
function asciiOf(host: string): string {
  if (host.startsWith('[')) return host; // IPv6
  const nfkc = typeof host.normalize === 'function' ? host.normalize('NFKC') : host;
  const mapped = nfkc.replace(DOTS, '.').toLowerCase().replace(/\.$/, '');
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
  const p = parse(asciiHost, { allowPrivateDomains: true });
  const isIp = asciiHost.startsWith('[') || p.isIp === true;
  const asciiDomain = isIp ? null : (p.domain ?? null);
  return {
    host: unicodeOf(asciiHost),
    domain: asciiDomain && unicodeOf(asciiDomain),
    asciiHost,
    asciiDomain,
    isIp,
  };
}

export function sameSite(a: string, b: string): boolean {
  const x = siteOf(a);
  const y = siteOf(b);
  return !!x && !!y && (x.asciiDomain ?? x.asciiHost) === (y.asciiDomain ?? y.asciiHost);
}
```

In `types.ts` add the `SiteInfo` interface from **Interfaces**. In `index.ts`: `export { siteOf, sameSite } from './site';`.

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit -p .`
Expected: all pass, no type errors. If `a.b.notarealtld` gives a different domain, keep tldts's answer and adjust only that expectation (record a ruling): the point is that it does not throw.

- [ ] **Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): report the main domain a link goes to, in Unicode and ASCII"
```

---

### Task 2: Hidden characters in URLs

**Files:**
- Create: `packages/core/src/hidden.ts`
- Modify: `packages/core/src/extract.ts` (`extractUrlDetailed`, `。` handling, `extractUrl` delegates)
- Modify: `packages/core/src/process.ts` (removed hidden items, `hiddenKept`)
- Modify: `packages/core/src/types.ts` (`Category` adds `'hidden'`; `HiddenChar`, `UrlPart`; `ProcessResult.hiddenKept?`)
- Modify: `packages/core/src/index.ts` (export `extractUrlDetailed`, `scanHidden`)
- Modify: `packages/core/src/validate.ts`, `rules/src/bundle.ts` (`CATEGORIES` adds `'hidden'`)
- Modify: `rules/knowledge.json` (entries `hidden`, `hidden-bidi`)
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json` (`category.hidden`)
- Test: `packages/core/test/hidden.test.ts`, `packages/core/test/extract.test.ts`, `packages/core/test/process.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UrlPart = 'host' | 'path' | 'query' | 'fragment';
  export interface HiddenChar { code: string; part: UrlPart; removed: boolean; encoded?: true } // code like 'U+200B'
  export function scanHidden(url: string): { url: string; found: HiddenChar[] }; // found is de-duplicated
  export interface Extracted { url: string; raw: string; hidden: HiddenChar[] } // raw: the candidate as written
  export function extractUrlDetailed(text: string): Extracted | null;
  ```
  `ProcessResult.removed` gets items `key: 'hidden'` (or `'hidden-bidi'` for U+202A–U+202E), `value: 'U+200B'`. `ProcessResult.hiddenKept?: HiddenChar[]` lists found-but-kept characters (joiners, direction marks outside the host, percent-encoded ones).

- [ ] **Step 1: Write the failing tests** — `packages/core/test/hidden.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { scanHidden } from '../src/hidden';

describe('scanHidden', () => {
  it('removes zero-width space, BOM, soft hyphen and word joiner anywhere, once per kind and part', () => {
    expect(scanHidden('https://ex​ample.com/a﻿b­c⁠d​​')).toEqual({
      url: 'https://example.com/abcd',
      found: [
        { code: 'U+200B', part: 'host', removed: true },
        { code: 'U+FEFF', part: 'path', removed: true },
        { code: 'U+00AD', part: 'path', removed: true },
        { code: 'U+2060', part: 'path', removed: true },
        { code: 'U+200B', part: 'path', removed: true },
      ],
    });
  });
  it('removes direction embeddings and overrides anywhere', () => {
    expect(scanHidden('https://evil‮.com/a?b=‭c').url).toBe('https://evil.com/a?b=c');
  });
  it('removes direction marks in the host but keeps them in path, query and fragment', () => {
    const r = scanHidden('https://ex‏ample.com/a‏b?q=⁦#‎');
    expect(r.url).toBe('https://example.com/a‏b?q=⁦#‎');
    expect(r.found).toEqual([
      { code: 'U+200F', part: 'host', removed: true },
      { code: 'U+200F', part: 'path', removed: false },
      { code: 'U+2066', part: 'query', removed: false },
      { code: 'U+200E', part: 'fragment', removed: false },
    ]);
  });
  it('never removes ZWJ or ZWNJ, but reports them', () => {
    const r = scanHidden('https://ex.com/‌‍');
    expect(r.url).toBe('https://ex.com/‌‍');
    expect(r.found.map((f) => [f.code, f.removed])).toEqual([['U+200C', false], ['U+200D', false]]);
  });
  it('removes Unicode tag characters (astral, matched as surrogate pairs)', () => {
    expect(scanHidden('https://ex.com/a\u{E0041}b').url).toBe('https://ex.com/ab');
  });
  it('reports percent-encoded hidden characters without changing them', () => {
    const r = scanHidden('https://ex.com/a%E2%80%8Bb?x=%ef%bb%bf');
    expect(r.url).toBe('https://ex.com/a%E2%80%8Bb?x=%ef%bb%bf');
    expect(r.found).toEqual([
      { code: 'U+200B', part: 'path', removed: false, encoded: true },
      { code: 'U+FEFF', part: 'query', removed: false, encoded: true },
    ]);
  });
  it('leaves an ordinary URL alone', () => {
    expect(scanHidden('https://例子.台灣/路徑?q=1#x')).toEqual({ url: 'https://例子.台灣/路徑?q=1#x', found: [] });
  });
});
```

Add to `test/extract.test.ts`:

```ts
  it('keeps a URL whole across a BOM and strips hidden characters', () => {
    expect(extractUrl('https://example.com/a﻿b')).toBe('https://example.com/ab');
    expect(extractUrl('看這個​https://x.com/a​。')).toBe('https://x.com/a');
  });
  it('strips hidden characters from a bare URL too', () => {
    expect(extractUrl('https://ex​ample.com/a')).toBe('https://example.com/a');
  });
  it('treats 。 as a host separator but as a sentence end elsewhere', () => {
    expect(extractUrl('https://example。com/a')).toBe('https://example.com/a');
    expect(extractUrl('請看https://example.com。謝謝')).toBe('https://example.com');
    expect(extractUrl('請看https://example.com/a。下一句')).toBe('https://example.com/a');
  });
  it('returns the candidate as written and what was found', () => {
    expect(extractUrlDetailed('看 https://x.com/a​b 。')).toEqual({
      url: 'https://x.com/ab',
      raw: 'https://x.com/a​b',
      hidden: [{ code: 'U+200B', part: 'path', removed: true }],
    });
  });
```

(import `extractUrlDetailed` alongside `extractUrl`.)

Add to `test/process.test.ts` (inside the main `describe`):

```ts
  it('lists hidden characters it removed and reports the ones it kept', async () => {
    const r = await processUrl('https://ex.com/a​b‍c‮d', rules, { expand: false, locale: 'en' });
    expect(r.cleanUrl).toBe('https://ex.com/ab‍cd');
    expect(r.removed.map((p) => [p.key, p.value])).toEqual(
      expect.arrayContaining([['hidden', 'U+200B'], ['hidden-bidi', 'U+202E']]),
    );
    expect(r.hiddenKept).toEqual([{ code: 'U+200D', part: 'path', removed: false }]);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/core && npx vitest run test/hidden.test.ts test/extract.test.ts test/process.test.ts`
Expected: FAIL — module `../src/hidden` missing; `extractUrlDetailed` not exported; extract stops at `﻿` and at `。` inside the host.

- [ ] **Step 3: Implement** — `packages/core/src/hidden.ts`

```ts
import type { HiddenChar, UrlPart } from './types';

// Invisible characters that can break a link, tag who copied it, or disguise it.
// Written as escapes and matched one character at a time, so no `u` flag is needed (Hermes).
const ALWAYS = /^[​﻿⁠­‪-‮]$/;
const HOST_ONLY = /^[‎‏⁦-⁩]$/; // direction marks/isolates: removed from the host only
const KEEP = /^[‌‍]$/; // ZWNJ/ZWJ: needed by IDN, Persian and emoji, never removed
const TAG = /^\uDB40[\uDC00-\uDC7F]$/; // U+E0000–U+E007F as a surrogate pair
// UTF-8 of U+200B/U+200E/U+200F, U+202A–U+202E, U+2060–U+2069, U+FEFF, U+00AD and tag characters.
const ENCODED = /%E2%80%8[BEF]|%E2%80%A[A-E]|%E2%81%A[0-9]|%EF%BB%BF|%C2%AD|%F3%A0%8[01]%[89AB][0-9A-F]/gi;

const code = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

function nextPart(part: UrlPart, ch: string): UrlPart {
  if (ch === '#') return 'fragment';
  if (ch === '?' && (part === 'host' || part === 'path')) return 'query';
  if ((ch === '/' || ch === '\\') && part === 'host') return 'path';
  return part;
}

export function scanHidden(url: string): { url: string; found: HiddenChar[] } {
  const scheme = /^[a-z][a-z0-9+.-]*:[/\\]*/i.exec(url)?.[0].length ?? 0;
  let part: UrlPart = scheme > 0 ? 'host' : 'path';
  let out = url.slice(0, scheme);
  const found: HiddenChar[] = [];
  const seen = new Set<string>();
  const note = (h: HiddenChar) => {
    const k = `${h.code}|${h.part}|${h.removed}|${h.encoded ?? ''}`;
    if (!seen.has(k)) {
      seen.add(k);
      found.push(h);
    }
  };
  const rest = url.slice(scheme);
  let i = 0;
  for (const ch of rest) {
    part = nextPart(part, ch);
    if (ch === '%') {
      ENCODED.lastIndex = 0;
      const m = ENCODED.exec(rest.slice(i, i + 12));
      if (m && m.index === 0) note({ code: code(decodeURIComponent(m[0])), part, removed: false, encoded: true });
    }
    i += ch.length;
    if (ALWAYS.test(ch) || TAG.test(ch) || (part === 'host' && HOST_ONLY.test(ch))) {
      note({ code: code(ch), part, removed: true });
      continue;
    }
    if (KEEP.test(ch) || HOST_ONLY.test(ch)) note({ code: code(ch), part, removed: false });
    out += ch;
  }
  return { url: out, found };
}
```

In `types.ts`: `Category` adds `'hidden'`; add `UrlPart`, `HiddenChar`, `hiddenKept?: HiddenChar[]` on `ProcessResult`.

Replace `packages/core/src/extract.ts`:

```ts
import { canonicalUrl } from './query';
import { scanHidden } from './hidden';
import type { HiddenChar } from './types';

// \s without U+FEFF: a BOM inside a link must not end it.
const WS = '\\t\\n\\v\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
// Stop at whitespace, '"', '<', '>' and full-width punctuation; raw non-ASCII
// (e.g. Chinese product names in shopee.tw paths) stays part of the URL. 。 is decided below.
const URL_RE = new RegExp(`https?:[/\\\\]+[^${WS}"<>《》“”‘’，、；：！？「」『』（）【】]+`, 'i');
const TRAILING = /[.,;:!?'*]+$/;

export interface Extracted {
  url: string; // what a browser would open, hidden characters removed
  raw: string; // the candidate as written, hidden characters included
  hidden: HiddenChar[];
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

// 。 separates labels inside a host (example。com); anywhere else it ends a Chinese sentence.
function cutAtSentenceEnd(s: string): string {
  const hostStart = /^https?:[/\\]+/i.exec(s)![0].length;
  const hostEnd = s.slice(hostStart).search(/[/\\?#]/);
  for (let i = s.indexOf('。'); i >= 0; i = s.indexOf('。', i + 1)) {
    const inHost = hostEnd < 0 || i < hostStart + hostEnd;
    if (!inHost || !/[A-Za-z0-9]/.test(s[i + 1] ?? '')) return s.slice(0, i);
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

export function extractUrlDetailed(text: string): Extracted | null {
  const m = URL_RE.exec(text);
  if (!m) return null;
  // A bare URL is taken verbatim; trailing punctuation is only trimmed when the URL sits in prose.
  const bare = text.trim() === m[0];
  let raw = cutAtSentenceEnd(m[0]);
  if (!bare) raw = trimTrailing(raw);
  const { url: stripped, found } = scanHidden(raw);
  // A hidden character may have sat between the URL and its punctuation.
  const url = canonicalUrl(bare ? stripped : trimTrailing(stripped));
  return url ? { url, raw, hidden: found } : null;
}

export function extractUrl(text: string): string | null {
  return extractUrlDetailed(text)?.url ?? null;
}
```

In `process.ts`: replace `extractUrl(input)` with `extractUrlDetailed(input)`; use `.url` as `extracted`; after `const removed: RemovedItem[] = [];` add:

```ts
  const host = getHost(found.url);
  for (const h of found.hidden.filter((x) => x.removed)) {
    removed.push({ key: /^U\+202[A-E]$/.test(h.code) ? 'hidden-bidi' : 'hidden', value: h.code, host });
  }
  const kept = found.hidden.filter((x) => !x.removed);
```

and after building `result`: `if (kept.length) result.hiddenKept = kept;`. Note the share-id `splice` in `processUrl` must keep hidden items (it already filters by `key !== 'share-id'`).

Add `'hidden'` to both `CATEGORIES` arrays. Add to `rules/knowledge.json`:

```json
  "hidden": {
    "category": "hidden",
    "risk": "medium",
    "desc": {
      "zh-TW": "看不見的字元。可能讓連結打不開、被用來辨識是誰複製的，或用來偽裝網址。",
      "en": "An invisible character. It can break the link, identify who copied it, or disguise the address.",
      "ja": "目に見えない文字です。リンクが開けなくなったり、コピーした人の特定や、アドレスの偽装に使われたりすることがあります。"
    }
  },
  "hidden-bidi": {
    "category": "hidden",
    "risk": "high",
    "desc": {
      "zh-TW": "改變文字顯示方向的隱藏字元，常被用來讓網址看起來像另一個網址。",
      "en": "An invisible character that changes text direction, often used to make an address look like a different one.",
      "ja": "文字の表示方向を変える隠し文字です。アドレスを別のものに見せかけるためによく使われます。"
    }
  },
```

Add `category.hidden`: zh-TW `"隱藏字元"`, en `"Hidden character"`, ja `"隠し文字"`. Export `extractUrlDetailed`, `scanHidden` and type `Extracted` from `index.ts`.

- [ ] **Step 4: Run tests**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && pnpm test && pnpm -s build:rules && pnpm -s test:regression && pnpm -s typecheck`
Expected: all pass (rules data test validates the new category; all `cases.json` cases unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/core rules apps/mobile/src/i18n
git commit -m "feat(core): find hidden characters in links; strip the deceptive ones"
```

---

### Task 3: Clipboard flow sees hidden characters

**Files:**
- Modify: `apps/mobile/src/lib/clipboardWatch.ts` (`decideText`)
- Test: `apps/mobile/src/lib/clipboardWatch.test.ts`

**Interfaces:**
- Consumes: `extractUrlDetailed` (Task 2).
- Produces: `decideText(...).url` is now the candidate **as written** (`Extracted.raw`), so `processUrl` re-extracts it and records the hidden characters; `clean` stays the canonical URL.

- [ ] **Step 1: Write the failing tests** — add to `clipboardWatch.test.ts` (reuse its `rules` fixture)

```ts
  it('offers a link whose only problem is a zero-width space, passing it on as written', () => {
    const text = 'https://example.com/a​b';
    const d = decideText(text, initialWatchState(), rules);
    expect(d.url).toBe(text);
    expect(d.clean).toBeNull();
  });
  it('treats a link with only a kept joiner as clean', () => {
    const d = decideText('https://example.com/a‍b', initialWatchState(), rules);
    expect(d.url).toBeNull();
    expect(d.clean).toBe('https://example.com/a‍b');
  });
```

Add to `cleaner.test.ts` (reuse its deps helper): cleaning `decideText(...).url` for `'看 https://example.com/a​b'` yields `result.removed` containing key `hidden`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/mobile && npx vitest run src/lib/clipboardWatch.test.ts src/lib/cleaner.test.ts`
Expected: FAIL — the zero-width-space link is reported as clean.

- [ ] **Step 3: Implement** — in `decideText`

```ts
  const found = fresh ? extractUrlDetailed(text) : null;
  // Removed hidden characters are something to clean even without tracking params.
  const offer = found && (needsCleaning(found.url, rules) || found.hidden.some((h) => h.removed)) ? found : null;
  return {
    url: offer ? offer.raw : null,
    fresh,
    clean: offer === null ? (found?.url ?? null) : null,
    next: { ...s, lastSeenText: text || s.lastSeenText },
  };
```

Import `extractUrlDetailed` instead of `extractUrl`. Update the comment above `decideText` to say the offered URL is passed on as written so hidden characters stay visible to `processUrl`.

- [ ] **Step 4: Run tests**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && pnpm test && pnpm -s typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib
git commit -m "fix(mobile): offer clipboard links that only carry hidden characters"
```

---

### Task 4: Hop-by-hop short-link expansion

**Files:**
- Modify: `packages/core/src/query.ts` (`parseUrl(url, base?)`)
- Modify: `packages/core/src/expand.ts` (`resolve` follows redirects itself; `Stopped` error)
- Modify: `packages/core/src/process.ts` (`destination`)
- Modify: `packages/core/src/types.ts` (`ProcessResult.destination?`)
- Modify: `rules/test/regression/cases.test.ts` (strict `replay`)
- Test: `packages/core/test/expand.test.ts`, `packages/core/test/process.test.ts`

**Interfaces:**
- Consumes: `siteOf`, `sameSite` (Task 1).
- Produces: unchanged `expandUrl` signature; every request uses `redirect: 'manual'`. On failure `ExpandResult.hops` ends with the last URL reached. `ProcessResult.destination?: { site: SiteInfo; complete: boolean }` — site of `cleanUrl` when the result is `clean`, otherwise of the last hop reached (`complete: false`); absent for `failed`.

- [ ] **Step 1: Convert the existing tests to explicit redirects**

In `test/expand.test.ts`, every `fakeFetch` entry that simulates an automatic redirect (status 200 with a `url` different from the key) becomes `{ url: <key>, status: 302, location: <target> }`, plus `[<target>]: { url: <target> }` when the target is on the same site (it will now be requested). Change the two `redirect: 'follow'` assertions to `'manual'`: in `'resolves a Threads share link…'` the expected calls become two HEAD requests (`THREADS`, then the same-site `THREADS_POST`), both `redirect: 'manual'`; `'lets other expanders keep following redirects'` is renamed `'uses manual redirects for every expander'` and asserts `'manual'`. Delete `'is unresolved when fetch reports an empty final URL'` — manual mode never reads `res.url` (record a ruling). Do the same conversion in `test/process.test.ts` for `threadsFetch` and the inline fetchers that return `{ url: next, status: 200 }`.

- [ ] **Step 2: Write the failing tests** — add inside `describe('expandUrl')`

```ts
  it('reads a cross-site destination from Location without requesting it', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      { 'https://bit.ly/TEST01': { url: 'https://bit.ly/TEST01', status: 301, location: 'https://example.com/post?utm_source=x' } },
      calls,
    );
    const r = await expandUrl('https://bit.ly/TEST01', expanders, opts(fetch));
    expect(r.url).toBe('https://example.com/post?utm_source=x');
    expect(calls.map((c) => c.url)).toEqual(['https://bit.ly/TEST01']);
    expect(calls.every((c) => c.redirect === 'manual')).toBe(true);
  });

  it('follows a relative redirect that stays on the same site', async () => {
    const fetch = fakeFetch({
      [THREADS]: { url: THREADS, status: 301, location: '../../@someone/post/DTest00001?xmt=AQGtest&slof=1' },
      [THREADS_POST]: { url: THREADS_POST, status: 200 },
    });
    expect((await expandUrl(THREADS, expanders, opts(fetch))).url).toBe(THREADS_POST);
  });

  it('never requests a Facebook login wall, even one that would answer 403', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      { [FB]: { url: FB, status: 302, location: loginFor(FB_POST) }, [loginFor(FB_POST)]: { url: loginFor(FB_POST), status: 403 } },
      calls,
    );
    const r = await expandUrl(FB, expanders, opts(fetch));
    expect(r.url).toBe(FB_POST);
    expect(calls.map((c) => c.url)).toEqual([FB]);
  });

  it('gives up on an endless same-site redirect chain, keeping where it got to', async () => {
    const loop = 'https://www.threads.com/share/LOOP0001/';
    const fetch = fakeFetch({ [loop]: { url: loop, status: 302, location: loop } });
    const r = await expandUrl(loop, expanders, opts(fetch));
    expect(r.reason).toBe('unresolved');
  });

  it('does not request the next hop after the deadline', async () => {
    const calls: Call[] = [];
    let release!: () => void;
    const late = new Promise<void>((r) => (release = r));
    const fetch: FetchFn = async (url, init) => {
      calls.push({ url, method: init.method, ua: undefined, redirect: init.redirect });
      if (url === THREADS) {
        await late; // ignores abort, answers after the deadline
        return { url, status: 302, location: THREADS_POST };
      }
      return { url, status: 200 };
    };
    const r = await expandUrl(THREADS, expanders, opts(fetch, 20));
    expect(r.reason).toBe('expand_timeout');
    release();
    await new Promise((r2) => setTimeout(r2, 30));
    expect(calls.map((c) => c.url)).toEqual([THREADS]);
  });

  it('keeps the hop reached when a later hop fails', async () => {
    const fetch = fakeFetch({
      [THREADS]: { url: THREADS, status: 302, location: THREADS_POST },
      [THREADS_POST]: new Error('offline'),
    });
    const r = await expandUrl(THREADS, expanders, opts(fetch));
    expect(r.reason).toBe('network');
    expect(r.hops).toEqual([THREADS, THREADS_POST]);
  });
```

Add to `test/process.test.ts`:

```ts
  it('reports the destination reached so far when expansion stops early', async () => {
    const fetch: FetchFn = async (url) => {
      if (url === THREADS) return { url, status: 302, location: 'https://www.threads.com/@someone/post/DTest00001' };
      throw new Error('offline');
    };
    const r = await processUrl(THREADS, rules, { expand: true, locale: 'en', fetch });
    expect(r.destination).toMatchObject({ complete: false, site: { domain: 'threads.com' } });
  });
  it('reports a finished destination for a clean result', async () => {
    const r = await processUrl('https://shopee.tw.secure-login.xyz/a?utm_source=x', rules, { expand: false, locale: 'en' });
    expect(r.destination).toMatchObject({ complete: true, site: { domain: 'secure-login.xyz' } });
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd packages/core && npx vitest run test/expand.test.ts test/process.test.ts`
Expected: FAIL — requests still use `follow`; the login page is requested; `destination` is undefined.

- [ ] **Step 4: Implement**

`query.ts` — let `parseUrl` take a base:

```ts
export function parseUrl(url: string, base?: string): URL | null {
  try {
    return base === undefined ? new WhatwgURL(url) : new WhatwgURL(url, base);
  } catch {
    return null;
  }
}
```

`expand.ts` — remove `absolute()`, `TimeoutError` and `HttpError`; import `sameSite` from `./site` and `parseUrl` from `./query`; add:

```ts
const MAX_HOPS = 6;

// Why expansion stopped, and the last URL it reached.
class Stopped extends Error {
  constructor(
    readonly reason: ExpandFailure,
    readonly lastUrl: string,
  ) {
    super(reason);
  }
}

// The next hop a browser would take for a Location header; null when it would not open it.
function nextHop(location: string, base: string): string | null {
  const target = HTTP.test(location) ? location : parseUrl(location, base)?.href;
  return target ? canonicalUrl(target) : null;
}

// Follows redirects one at a time in manual mode, under one deadline. A hop to another site, a login
// wall (its next param is the answer) and any hop after the first for firstHop expanders are taken
// from Location and returned without being requested, so expansion never contacts the destination.
async function resolve(
  url: string,
  expanders: Record<string, Expander>,
  opts: ExpandOptions,
  firstHop: boolean,
): Promise<string> {
  const controller = new AbortController();
  const headers = { 'User-Agent': opts.userAgent };
  let current = url;
  const send = (method: 'HEAD' | 'GET') => {
    // Never start a request after the deadline has passed.
    if (controller.signal.aborted) throw new Stopped('expand_timeout', current);
    return opts.fetch(current, { method, headers, signal: controller.signal, redirect: 'manual' });
  };
  const work = (async () => {
    try {
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        let res = await send('HEAD');
        // Some services reject HEAD outright (405) or answer it with 404; GET still redirects.
        if (res.status === 405 || res.status === 404) res = await send('GET');
        if (!(res.status >= 300 && res.status < 400 && res.location)) {
          if (res.status >= 400) throw new Stopped('network', current);
          return current;
        }
        const next = nextHop(res.location, current);
        if (!next) throw new Stopped('unresolved', current);
        if (firstHop || findLoginWall(next, expanders) || !sameSite(next, current)) return next;
        current = next;
      }
      throw new Stopped('unresolved', current); // too many redirects on one site
    } catch (e) {
      if (controller.signal.aborted) throw new Stopped('expand_timeout', current);
      throw e instanceof Stopped ? e : new Stopped('network', current);
    }
  })();
  work.catch(() => {}); // a rejection after the deadline must not surface as unhandled

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Stopped('expand_timeout', current));
    }, opts.timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
```

In `expandUrl` call `resolve(requestUrl, expanders, opts, expander.firstHop === true)` and replace the catch with:

```ts
  } catch (e) {
    const s = e instanceof Stopped ? e : new Stopped('network', requestUrl);
    const reached = s.lastUrl === url || s.lastUrl === requestUrl ? [url] : [url, s.lastUrl];
    return fail(s.reason, reached);
  }
```

`raw` is now already canonical; keep the `canonicalUrl(raw)` line (harmless) so the rest of `expandUrl` is unchanged.

`process.ts` — import `siteOf`; after building `result`:

```ts
  const reached = reason ? hops[hops.length - 1]! : cleaned.url;
  const site = siteOf(reached);
  if (site) result.destination = { site, complete: !reason };
```

`types.ts`: `destination?: { site: SiteInfo; complete: boolean };` on `ProcessResult`.

`rules/test/regression/cases.test.ts` — replace `replay` with a strict version that only answers recorded short links and same-site final destinations:

```ts
import { processUrl, sameSite } from '@linkclean/core';

// Each recorded short link answers with a redirect to its final URL. A final URL is answered only
// when it is on the same site as the link that pointed to it; anything else is an unexpected request.
function replay(responses: Record<string, string | undefined>): FetchFn {
  const source = new Map(Object.entries(responses).map(([from, to]) => [to, from]));
  return async (url) => {
    const final = responses[url];
    if (final !== undefined) return { url, status: 302, location: final };
    const from = source.get(url);
    if (from !== undefined && sameSite(from, url)) return { url, status: 200 };
    throw new Error(`unexpected request to ${url}`);
  };
}
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && pnpm test && pnpm -s build:rules && pnpm -s test:regression`
Expected: all pass, including every existing `cases.json` case. A case that now throws `unexpected request` means a cross-site destination was being contacted — fix the code, not the replay.

- [ ] **Step 6: Live check (network)**

Run: `pnpm -s test:live`
Expected: same result as before the change (it may only warn when no live cases are configured). Then, by hand with links the user provides **only as environment variables** (never written to files), compare Facebook, Threads, TikTok, bilibili `b23.tv`, Xiaohongshu and Reddit `/s/` results against the 0.1.1 build on the phone. A changed result is a finding to report, not something to patch over.

- [ ] **Step 7: Commit**

```bash
git add packages/core rules/test
git commit -m "feat(core): expand short links hop by hop without contacting the destination"
```

---

### Task 5: LINE short links (`lin.ee`)

**Files:**
- Modify: `rules/expanders.json` (add `line` before `generic`)
- Modify: `rules/overrides.json` (provider for LINE Official Account links only)
- Modify: `rules/knowledge.json` (`line.me:oat_content`, `line.me:ts`)
- Modify: `rules/fixtures/cases.json`
- Modify: `apps/mobile/assets/rules.json` (via `sync-rules`, after building)

**Interfaces:**
- Consumes: Task 4 (lin.ee → line.me is cross-site, so line.me is never contacted).

- [ ] **Step 1: Write the failing fixtures** — append to `rules/fixtures/cases.json`

```json
  {
    "name": "LINE lin.ee link shows the LINE account it opens",
    "input": "https://lin.ee/TESTline1",
    "responses": { "https://lin.ee/TESTline1": "https://line.me/R/ti/p/@test0001?oat_content=url&ts=01010101" },
    "expected": { "cleanUrl": "https://line.me/R/ti/p/@test0001", "status": "clean", "removedKeys": ["oat_content", "ts"] }
  },
  {
    "name": "Other LINE links keep their ts parameter",
    "input": "https://line.me/S/sticker/1?ts=123",
    "responses": {},
    "expected": { "cleanUrl": "https://line.me/S/sticker/1?ts=123", "status": "clean", "removedKeys": [] }
  }
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -s build:rules && pnpm -s test:regression`
Expected: FAIL — the lin.ee cleanUrl stays `https://lin.ee/TESTline1`.

- [ ] **Step 3: Implement**

`rules/expanders.json`, before `"generic"`:

```json
  "line": {
    "match": "^https?://lin\\.ee/",
    "firstHop": true
  },
```

`rules/overrides.json` provider (only the Official Account add-friend path):

```json
    "line.me-oa": {
      "urlPattern": "^https?:\\/\\/line\\.me\\/R\\/ti\\/p\\/",
      "rules": ["oat_content", "ts"]
    },
```

`rules/knowledge.json`:

```json
  "line.me:oat_content": { "owner": "LINE", "category": "campaign", "risk": "low", "desc": {
    "zh-TW": "LINE 官方帳號的加入管道統計，記錄你是從哪種連結加入的。",
    "en": "LINE Official Account source tracking: records which kind of link you joined from.",
    "ja": "LINE 公式アカウントの流入元の計測です。どの種類のリンクから追加したかを記録します。" } },
  "line.me:ts": { "owner": "LINE", "category": "campaign", "risk": "low", "desc": {
    "zh-TW": "LINE 官方帳號連結的建立代碼，用於統計。",
    "en": "Code of the LINE Official Account link, used for statistics.",
    "ja": "LINE 公式アカウントのリンクを識別するコードで、計測に使われます。" } },
```

- [ ] **Step 4: Build, test, then sync** (in this order: sync copies the built `dist`)

Run: `pnpm -s build:rules && pnpm -s test:regression && pnpm test && pnpm --filter @linkclean/mobile sync-rules && git diff --stat apps/mobile/assets/rules.json`
Expected: all pass; the diff shows `apps/mobile/assets/rules.json` changed and it contains `lin\\.ee`.

- [ ] **Step 5: Commit**

```bash
git add rules apps/mobile/assets/rules.json
git commit -m "feat(rules): expand LINE lin.ee links and drop Official Account source tracking"
```

---

### Task 6: Show the site in the app

**Files:**
- Create: `apps/mobile/src/lib/siteLabel.ts`
- Modify: `apps/mobile/src/components/ResultCard.tsx` (site line, kept hidden characters)
- Modify: `apps/mobile/app/index.tsx` (clean-link notice shows the site)
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json`
- Test: `apps/mobile/src/lib/siteLabel.test.ts`

**Interfaces:**
- Consumes: `siteOf`, `SiteInfo` from `@linkclean/core`; `ProcessResult.destination`, `ProcessResult.hiddenKept`.
- Produces: `export function siteLabel(site: SiteInfo): { sub: string; main: string; ascii: string | null }` — `main` is the domain (or the whole host for IPs and bare suffixes), `sub` the part of the host before it, `ascii` the `xn--` host when it differs from the shown one.

- [ ] **Step 1: Write the failing test** — `apps/mobile/src/lib/siteLabel.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { siteOf } from '@linkclean/core';
import { siteLabel } from './siteLabel';

const label = (u: string) => siteLabel(siteOf(u)!);

describe('siteLabel', () => {
  it('splits the host into subdomain and main domain', () => {
    expect(label('https://shopee.tw.secure-login.xyz/a')).toEqual({ sub: 'shopee.tw.', main: 'secure-login.xyz', ascii: null });
    expect(label('https://example.com/')).toEqual({ sub: '', main: 'example.com', ascii: null });
  });
  it('shows the whole host for IPs and bare suffixes', () => {
    expect(label('http://203.0.113.5/')).toEqual({ sub: '', main: '203.0.113.5', ascii: null });
    expect(label('https://[2001:db8::1]/')).toEqual({ sub: '', main: '[2001:db8::1]', ascii: null });
    expect(label('https://co.uk/')).toEqual({ sub: '', main: 'co.uk', ascii: null });
  });
  it('shows an IDN host in both forms', () => {
    expect(label('https://www.例子.台灣/')).toEqual({ sub: 'www.', main: '例子.台灣', ascii: 'www.xn--fsqu00a.xn--kpry57d' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/mobile && npx vitest run src/lib/siteLabel.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`apps/mobile/src/lib/siteLabel.ts`:

```ts
import type { SiteInfo } from '@linkclean/core';

// The main domain is what tells you whose site it is; the subdomain can say anything.
export function siteLabel(site: SiteInfo): { sub: string; main: string; ascii: string | null } {
  const main = site.domain ?? site.host;
  const sub = site.host.endsWith(main) ? site.host.slice(0, site.host.length - main.length) : '';
  return { sub, main, ascii: site.asciiHost !== site.host ? site.asciiHost : null };
}
```

In `ResultCard.tsx`, right after the headline `<Text>`:

```tsx
      {result.destination && (() => {
        const l = siteLabel(result.destination.site);
        return (
          <Text style={{ color: c.muted }}>
            {t(result.destination.complete ? 'result.site' : 'result.siteSoFar')}
            {l.sub}
            <Text style={{ color: c.text, fontWeight: '700' }}>{l.main}</Text>
            {l.ascii ? ` (${l.ascii})` : ''}
          </Text>
        );
      })()}
      {result.hiddenKept && result.hiddenKept.length > 0 && (
        <Text style={{ color: c.muted, fontSize: 12 }}>
          {t('result.hiddenKept', { codes: [...new Set(result.hiddenKept.map((h) => h.code))].join(', ') })}
        </Text>
      )}
```

In `index.tsx` the clean-link notice text becomes `t('home.clipboardNoTrackingSite', { site })` where `site` is `siteLabel(s).main` for `s = siteOf(cleanClipboardLink)`, plus ` (ascii)` when `ascii` is set; fall back to `home.clipboardNoTracking` when `siteOf` returns null.

Strings:
- `result.site`: zh-TW `"網站："`, en `"Site: "`, ja `"サイト："`
- `result.siteSoFar`: zh-TW `"目前取得的目的地："`, en `"Destination so far: "`, ja `"現時点の行き先："`
- `result.hiddenKept`: zh-TW `"網址含有看不見的字元（{{codes}}），Untail 沒有修改。"`, en `"The link contains invisible characters ({{codes}}). Untail left them unchanged."`, ja `"リンクに目に見えない文字（{{codes}}）が含まれています。Untail は変更していません。"`
- `home.clipboardNoTrackingSite`: zh-TW `"沒有找到追蹤碼。網站：{{site}}。Untail 只清除追蹤碼，不會檢查連結是否安全。"`, en `"No tracking codes found. Site: {{site}}. Untail only removes trackers; it doesn't check whether a link is safe."`, ja `"追跡コードは見つかりませんでした。サイト：{{site}}。Untail は追跡コードを取り除くだけで、リンクが安全かどうかは確認しません。"`

- [ ] **Step 4: Run tests**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && pnpm test && pnpm -s typecheck`
Expected: all pass (i18n key-parity test included).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): show the main domain of every link"
```

---

### Task 7: Android build — R8, orientation, Expo patch

Play Console flagged versionCode 1: DEX obfuscation 1% (must reach 25% by 2027-02) and an orientation lock that Android 16 ignores on large screens. `apps/mobile/android/` is generated by prebuild and git-ignored, so both changes go into app config.

**Files:**
- Modify: `apps/mobile/package.json` (Expo patch, `expo-build-properties`)
- Modify: `apps/mobile/app.json` (`orientation`, `expo-build-properties` plugin)
- Modify: `apps/mobile/proguard-rules.pro` only if Step 4 shows a crash (create it then)

- [ ] **Step 1: Update Expo to the latest SDK 57 patch and add build properties**

Run: `cd apps/mobile && npx expo install expo@~57.0.30 expo-build-properties && npx expo install --fix && npx expo-doctor`
Expected: `expo` 57.0.30+, `expo-build-properties` 57.x; expo-doctor reports no SDK mismatch.

- [ ] **Step 2: Configure**

In `app.json`: `"orientation": "default"`, and add to `plugins`:

```json
      ["expo-build-properties", { "android": { "enableMinifyInReleaseBuilds": true, "enableShrinkResourcesInReleaseBuilds": true } }],
```

- [ ] **Step 3: Rebuild natively**

Run: `cd apps/mobile && npx expo prebuild -p android --no-install && grep -n "enableMinifyInReleaseBuilds\|enableShrinkResources" android/gradle.properties`
Expected: both properties `true`.

- [ ] **Step 4: Release build smoke test on the emulator**

Run (in `apps/mobile/android`): `./gradlew createBundleReleaseJsAndAssets --rerun assembleRelease bundleRelease`, install the APK on the emulator, then: open the app, clean a typed link, share a link into Untail, open Settings, History, Privacy and Licenses, rotate to landscape on each screen.
Expected: no crash; `adb logcat -d | grep -E "FATAL|ClassNotFound|NoSuchMethod"` is empty; `android/app/build/outputs/mapping/release/mapping.txt` exists (the AAB carries it to Play). If a class is stripped, add a `-keep` rule through `expo-build-properties` `android.extraProguardRules` and record a ruling.

- [ ] **Step 5: Landscape and large screen**

On the emulator in landscape and on a tablet-size AVD: every screen scrolls, nothing is cut off, buttons stay reachable. Fix layout only where something is unusable.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.json pnpm-lock.yaml
git commit -m "build(android): enable R8, drop the orientation lock, Expo 57 patch update"
```

---

### Task 8: Privacy, licences, data safety, release

**Files:**
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json` (`privacy.p3`, licences strings)
- Modify: `docs/site/privacy.html` (same text, `Last updated`)
- Modify: `apps/mobile/app/licenses.tsx`, `NOTICE.md` (tldts MIT, Public Suffix List MPL-2.0, punycode MIT)
- Modify: `docs/store/google-play-data-safety.md` (expansion row)
- Modify: `apps/mobile/app.json` (`android.versionCode` + 1, `version` patch + 1)

- [ ] **Step 1: Update `privacy.p3`** (three languages and the site): the app contacts the short-link service and follows a redirect only while it stays on that service's own site; a redirect to an ordinary website is read from the reply and that website is not contacted; when the redirect points to another short-link service Untail knows (for example one short link that leads to another), Untail contacts that service too. Keep the HEAD/GET sentence, the automatic-mode sentence, the HTTPS sentence and the opt-out.

- [ ] **Step 2: Licences** — add to `NOTICE.md` and the Licenses screen: `tldts` (MIT, link to its licence), the Public Suffix List data it bundles (MPL-2.0, https://mozilla.org/MPL/2.0/), `punycode` (MIT).

- [ ] **Step 3: Data safety doc** expansion row: "短網址服務（以及同一網站內的轉址、它轉到的其他已知短網址服務）；轉到一般網站時只讀取目的網址，不會連過去".

- [ ] **Step 4: Bump version** in `app.json` and run `npx expo prebuild -p android --no-install` in `apps/mobile`.

- [ ] **Step 5: Full verification**

Run: `pnpm test && pnpm -s build:rules && pnpm -s test:regression && pnpm -s typecheck`
Expected: all pass.

- [ ] **Step 6: Build, install, verify on the phone (Hermes release build)**

Run (in `apps/mobile/android`): `./gradlew createBundleReleaseJsAndAssets --rerun assembleRelease bundleRelease`, then `adb install -r app/build/outputs/apk/release/app-release.apk` **only after asking the user**: the phone runs the Play-installed build, and a sideloaded build signed with the upload key cannot replace it (uninstall first, losing local history), so prefer the emulator and let the user decide about the phone.
Expected, with test links typed on the device (never real links in files): a link with `​` lists a "隱藏字元" item; `https://例子.台灣/` shows `網站：例子.台灣 (xn--fsqu00a.xn--kpry57d)`; `https://ｅｘａｍｐｌｅ.com/` shows `example.com`; `https://alice.github.io/` shows `alice.github.io`; a bit.ly link resolves without delay; a lin.ee link shows `網站：line.me`. These confirm dynamic `RegExp`, surrogate-pair matching, `String.prototype.normalize`, `tldts` and `punycode` on Hermes.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile docs NOTICE.md
git commit -m "docs: describe hop-by-hop expansion and new licences; bump version"
```

---

## Not in this plan (deliberate)

- Blocklists (165, global) and heuristics (S3) — phases 2 and 3 of the spec.
- `。` before a non-ASCII label (`例子。台灣`) is treated as a sentence end: Chinese prose follows a URL with `。` and a Chinese word far more often than an IDN uses `。` before a Chinese TLD. `example。com` (ASCII after `。`) is kept.
- The clipboard gate (`needsCleaning`) stays, extended with removed hidden characters (Task 3). A link with nothing to clean still reaches the clean-link notice, which now shows its site (Task 6), so every clipboard link gets S2 in phase 1. Kept-only characters (joiners) are shown when the user processes the link, not in the notice.
- Splitting the LINE rule into its own release: kept here, narrowed to the Official Account path, because it is what makes a scam `lin.ee` link show its real destination.
- Upgrading to Expo SDK 58: `expo-share-intent` 8.0.1 declares `expo: ^57` only; revisit when it supports 58 or when iOS work starts.
