# Link Safety Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show users where a link really goes (main domain, both Unicode and `xn--` forms), find and conservatively strip invisible characters in URLs, and stop short-link expansion from contacting destination sites — without ever claiming a link is safe. The same release also fixes the two Play Console findings (DEX obfuscation, orientation lock).

**Architecture:** All logic lives in `@linkclean/core` (pure TypeScript, vitest on Node) and is consumed by the Expo app. One host mapping (`mapHost` in `query.ts`: drop ignorable characters, NFKC, ideographic dots → `.`, lower case) is used by `canonicalUrl` (a host that maps to plain ASCII is rewritten, so `ｂｉｔ.ly` is `bit.ly` for rules and requests) and by `siteOf` (punycode + `tldts` with private suffixes). Expansion becomes hop-by-hop with `redirect: 'manual'`: it follows a redirect only when the next hop is on the same registrable domain, is not a login wall, and the deadline has not passed; anything else is read from `Location` and never requested; the full trail is kept, also on failure. Hidden characters are scanned on every URL the pipeline takes up (input, unwrapped, expanded); removed ones join `removed`, kept ones go to `hiddenKept`. `ProcessResult` gains `destination` (site + whether expansion finished), derived by one helper so history rows get it too.

**Tech Stack:** TypeScript, vitest, `tldts` (MIT, bundled Public Suffix List, MPL-2.0 data), `punycode` 2.3.1 (MIT), `whatwg-url-minimum` (already used), Expo SDK 57 / React Native 0.86 / Hermes, `expo-build-properties`, i18next (zh-TW / en / ja).

**Spec:** `docs/superpowers/specs/2026-10-16-link-safety-design.md` (phase 1 = §3, §4, §5, §9 licences, plus the §8 wording rules that apply without blocklists)

**Revision 3:** 2026-10-16, after two codex + agy review rounds. Round 2 changes: one host mapping shared by rules, requests and display (ignorables, full-width); bare URLs keep every `。` in the host; userinfo is its own part and never modified; encoded set matches the character policy and host-decoded characters are re-scanned; the clipboard passes the whole text on; any finding (kept ones too) is offered; every URL taken up by the pipeline is scanned; expansion keeps the full trail; all test fetchers migrated (core and mobile) and the replay checks method and mode; history rows derive the new fields; R8 verified on the real AAB; removed hidden items de-duplicated by code.

## Global Constraints

- Never say a link is "safe" or that Untail checked it; wording says what was found or done.
- Links are never sent anywhere for the purpose of checking; only short-link expansion makes requests.
- Comments in English; UI strings in zh-TW, en and ja, all three updated together.
- Existing behaviour of `rules/fixtures/cases.json` must not regress (all cases still pass).
- No real share links from the user in any file, fixture or commit; use `TEST…` IDs.
- `tldts` must be called with `{ allowPrivateDomains: true }`.
- ZWJ (U+200D) and ZWNJ (U+200C) are never removed; direction marks/isolates are removed only from the hostname; nothing in userinfo is ever modified.
- No invisible character may appear literally in any source, test or doc file: always write `\u200B`-style escapes. **Tool gotcha:** the Write/Edit tools decode `\uXXXX` in their input, so after every write that involves such escapes run `python3 scripts/check-invisible.py <files>` (Task 2 Step 0) and fix what it reports.
- Regexes on hidden characters use `\u` escapes without the `u` flag (Hermes compiles dynamic `new RegExp` at runtime); astral characters are matched as surrogate pairs.
- Percent-encoded hidden characters are detected only, never decoded or changed by Untail. (A browser decodes an encoded host itself; such a host is re-scanned after `canonicalUrl`.)
- Bump `apps/mobile/app.json` `android.versionCode` by 1 and `version` patch by 1 for the build that ships this (Task 8 only).
- Run codex + agy review on the finished branch before pushing.

## Review Focus

1. A short link whose `Location` carries a hidden character (`https://example.com/a\u200Bb`) must come out cleaned and list the removed character — Task 4 test.
2. A Facebook share link that redirects to `m.facebook.com/login.php?next=<post>` must yield the post without the login page ever being requested, even when the login page would answer 403 — Task 4 test.
3. Chinese prose `請看https://example.com。謝謝` must extract `https://example.com`, while a bare `https://例子。台灣/` must stay one URL — Task 2 test.
4. A link copied with only a zero-width space and no tracking params must be offered for cleaning from the clipboard, and the result must list the removed character; manual and clipboard processing of the same text must agree — Task 3 test.
5. When expansion fails after one same-site hop, the result must show that hop as "destination so far" and keep every hop in `hops`, also when reopened from history — Task 4 + Task 6 tests.

---

### Task 1: Host mapping and site info in core

**Files:**
- Create: `packages/core/src/site.ts`, `packages/core/src/punycode.d.ts`
- Modify: `packages/core/src/query.ts` (`mapHost`, `canonicalUrl` rewrites hosts that map to ASCII)
- Modify: `packages/core/src/types.ts` (add `SiteInfo`)
- Modify: `packages/core/src/index.ts` (export `siteOf`, `sameSite`)
- Modify: `packages/core/package.json` (add `tldts`, `punycode`)
- Test: `packages/core/test/site.test.ts`, `packages/core/test/query.test.ts`, `packages/core/test/process.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // query.ts
  export function mapHost(host: string): string; // ignorables dropped, NFKC, ideographic dots → '.', lower case, no trailing dot
  // types.ts
  export interface SiteInfo {
    host: string;               // for display: Unicode form
    domain: string | null;      // registrable domain for display (Unicode); null for IPs and bare public suffixes
    asciiHost: string;          // for comparison: ASCII (punycode) form
    asciiDomain: string | null; // for comparison
    isIp: boolean;
  }
  // site.ts
  export function siteOf(url: string): SiteInfo | null;  // null when unparsable or no host
  export function sameSite(a: string, b: string): boolean; // same asciiDomain (or asciiHost when no domain)
  ```

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter @linkclean/core add tldts punycode@2.3.1`
Expected: both listed in `packages/core/package.json` dependencies.

- [ ] **Step 2: Write the failing tests**

`packages/core/test/site.test.ts`:

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
  it('maps full-width letters, ideographic dots and ignorable characters like a browser', () => {
    expect(siteOf('https://ｅｘａｍｐｌｅ.com/')?.asciiHost).toBe('example.com');
    expect(siteOf('https://a\u034Fb.com/')?.asciiHost).toBe('ab.com');
    expect(sameSite('https://example。com/', 'https://www.example.com/')).toBe(true);
  });
  it('refuses a host that maps to a URL delimiter, as a browser does', () => {
    expect(siteOf('https://shopee.tw／.evil.com/')).toBeNull();
    expect(siteOf('https://shopee.tw＠evil.com/')).toBeNull();
  });
  it('does not throw on an invalid punycode label', () => {
    expect(siteOf('https://xn--zz.example/')?.domain).toBe('xn--zz.example');
  });
  it('returns null for something that is not a URL', () => {
    expect(siteOf('')).toBeNull();
    expect(siteOf('not a url')).toBeNull();
  });
});
```

Add to `packages/core/test/query.test.ts`:

```ts
  it('rewrites a host that a browser maps to plain ASCII', () => {
    expect(canonicalUrl('https://ｂｉｔ.ly/abc?x=ａ')).toBe('https://bit.ly/abc?x=%EF%BD%81');
    expect(canonicalUrl('https://例子.台灣/路徑')).toBe('https://例子.台灣/路徑');
  });
  it('refuses a host that maps to a URL delimiter', () => {
    expect(canonicalUrl('https://shopee.tw／.evil.com/')).toBeNull();
  });
```

(If `whatwg-url-minimum` serializes the query differently, keep the host assertion and adjust only the query part — record a ruling.)

Add to `packages/core/test/process.test.ts`:

```ts
  it('treats a full-width short link like the ASCII one', async () => {
    const r = await processUrl('https://www.ｔｈｒｅａｄｓ.com/share/BAAtest0001/', rules, { expand: false, locale: 'en' });
    expect(r.reason).toBe('expand_disabled');
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd packages/core && npx vitest run test/site.test.ts test/query.test.ts test/process.test.ts`
Expected: FAIL — module `../src/site` missing; the full-width host is kept; the full-width Threads link is reported clean.

- [ ] **Step 4: Implement**

`packages/core/src/punycode.d.ts`:

```ts
declare module 'punycode/punycode.js' {
  const punycode: { toASCII(s: string): string; toUnicode(s: string): string };
  export default punycode;
}
```

In `query.ts` add (and use in `canonicalUrl` as shown):

```ts
// Characters a browser drops from a host (UTS #46 "ignored"), and the ideographic/full-width full stops it reads as dots.
const HOST_IGNORED = /[\u00AD\u034F\u180B-\u180F\u200B\u2060\uFE00-\uFE0F\uFEFF]/g;
const HOST_DOTS = /[。．｡]/g;

export const FORBIDDEN_HOST = /[\s#%/:<>?@[\\\]^|]/;

// The host a browser connects to, before punycode. whatwg-url-minimum skips IDNA, so this mapping is done here.
export function mapHost(host: string): string {
  if (host.startsWith('[')) return host; // IPv6
  const kept = host.replace(HOST_IGNORED, '');
  const nfkc = typeof kept.normalize === 'function' ? kept.normalize('NFKC') : kept;
  return nfkc.replace(HOST_DOTS, '.').toLowerCase().replace(/\.$/, '');
}
```

In `canonicalUrl`, right after `if (!u?.hostname || …) return null;`:

```ts
  // A host that maps to plain ASCII (full-width letters, ignorable characters) is the ASCII site,
  // so rules, expansion and display all see it. Unicode (IDN) hosts stay as written.
  const mapped = mapHost(u.hostname);
  // A browser refuses a host that maps to a URL delimiter (full-width ／ ＠ ？ ＃ …): so does Untail,
  // otherwise https://shopee.tw／.evil.com would read as shopee.tw.
  if (FORBIDDEN_HOST.test(mapped.replace(/^\[.*\]$/, ''))) return null;
  if (mapped !== u.hostname && /^[a-z0-9.-]+$/.test(mapped)) {
    u.hostname = mapped;
    return u.href;
  }
```

`packages/core/src/site.ts`:

```ts
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
```

In `types.ts` add `SiteInfo`. In `index.ts`: `export { siteOf, sameSite } from './site';`.

- [ ] **Step 5: Run tests**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && pnpm test && pnpm -s build:rules && pnpm -s test:regression && pnpm -s typecheck`
Expected: all pass. If `a.b.notarealtld` or `xn--zz.example` give a different domain, keep tldts's answer and adjust only that expectation (record a ruling): the point is that it does not throw.

- [ ] **Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): one host mapping for rules and display; report the main domain"
```

---

### Task 2: Hidden characters in URLs

**Files:**
- Create: `scripts/check-invisible.py`, `packages/core/src/hidden.ts`
- Modify: `packages/core/src/extract.ts` (`extractUrlDetailed`, `。` handling, `extractUrl` delegates)
- Modify: `packages/core/src/process.ts` (scan every URL taken up; `removed`, `hiddenKept`)
- Modify: `packages/core/src/types.ts` (`Category` adds `'hidden'`; `UrlPart`, `HiddenChar`; `ProcessResult.hiddenKept?`)
- Modify: `packages/core/src/index.ts` (export `extractUrlDetailed`, `scanHidden`, type `Extracted`)
- Modify: `packages/core/src/validate.ts`, `rules/src/bundle.ts` (`CATEGORIES` adds `'hidden'`)
- Modify: `rules/knowledge.json` (entries `hidden`, `hidden-bidi`)
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json` (`category.hidden`)
- Test: `packages/core/test/hidden.test.ts`, `packages/core/test/extract.test.ts`, `packages/core/test/process.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UrlPart = 'userinfo' | 'host' | 'path' | 'query' | 'fragment';
  // code like 'U+200B'; index = offset of the first occurrence in the scanned string
  export interface HiddenChar { code: string; part: UrlPart; removed: boolean; index: number; encoded?: true }
  export function scanHidden(url: string): { url: string; found: HiddenChar[] }; // one entry per code+part+removed+encoded
  export interface Extracted { url: string; hidden: HiddenChar[] }
  export function extractUrlDetailed(text: string): Extracted | null;
  ```
  `ProcessResult.removed` gets one item per removed code: `key: 'hidden'` (or `'hidden-bidi'` for U+202A–U+202E), `value: 'U+200B'`. `ProcessResult.hiddenKept?: HiddenChar[]` lists found-but-kept characters (joiners, direction marks outside the hostname, anything in userinfo, percent-encoded ones).

- [ ] **Step 0: Guard against literal invisible characters** — `scripts/check-invisible.py`

```python
#!/usr/bin/env python3
"""Fail if any given file contains a literal invisible character (they must be written as escapes)."""
import sys

def bad(c):
    o = ord(c)
    return (o in (0x00AD, 0x034F, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x2060, 0xFEFF)
            or 0x202A <= o <= 0x202E or 0x2066 <= o <= 0x2069 or 0xE0000 <= o <= 0xE007F)

status = 0
for path in sys.argv[1:]:
    text = open(path, encoding='utf-8').read()
    for line_no, line in enumerate(text.splitlines(), 1):
        hits = [f'U+{ord(c):04X}' for c in line if bad(c)]
        if hits:
            print(f'{path}:{line_no}: {", ".join(hits)}')
            status = 1
sys.exit(status)
```

Run after every file write in Tasks 2–4: `python3 scripts/check-invisible.py <changed files>` — Expected: no output, exit 0.

- [ ] **Step 1: Write the failing tests** — `packages/core/test/hidden.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { scanHidden } from '../src/hidden';

const codes = (r: ReturnType<typeof scanHidden>) => r.found.map((f) => [f.code, f.part, f.removed]);

describe('scanHidden', () => {
  it('removes zero-width space, BOM, soft hyphen and word joiner anywhere, once per kind and part', () => {
    const r = scanHidden('https://ex\u200Bample.com/a\uFEFFb\u00ADc\u2060d\u200B\u200B');
    expect(r.url).toBe('https://example.com/abcd');
    expect(codes(r)).toEqual([
      ['U+200B', 'host', true],
      ['U+FEFF', 'path', true],
      ['U+00AD', 'path', true],
      ['U+2060', 'path', true],
      ['U+200B', 'path', true],
    ]);
    expect(r.found[0]!.index).toBe(10);
  });
  it('removes direction embeddings and overrides outside userinfo', () => {
    expect(scanHidden('https://evil\u202E.com/a?b=\u202Dc').url).toBe('https://evil.com/a?b=c');
  });
  it('removes direction marks in the hostname but keeps them elsewhere', () => {
    const r = scanHidden('https://ex\u200Fample.com/a\u200Fb?q=\u2066#\u200E');
    expect(r.url).toBe('https://example.com/a\u200Fb?q=\u2066#\u200E');
    expect(codes(r)).toEqual([
      ['U+200F', 'host', true],
      ['U+200F', 'path', false],
      ['U+2066', 'query', false],
      ['U+200E', 'fragment', false],
    ]);
  });
  it('never modifies userinfo, and finds the hostname after the last @', () => {
    const r = scanHidden('https://u\u200F:p\u200B@a@ex\u200Fample.com/');
    expect(r.url).toBe('https://u\u200F:p\u200B@a@example.com/');
    expect(codes(r)).toEqual([
      ['U+200F', 'userinfo', false],
      ['U+200B', 'userinfo', false],
      ['U+200F', 'host', true],
    ]);
  });
  it('handles IPv6, a backslash and a query or fragment with no path', () => {
    expect(codes(scanHidden('https://[2001:db8::1]\\a\u200F'))).toEqual([['U+200F', 'path', false]]);
    expect(codes(scanHidden('https://ex.com?q=\u200F'))).toEqual([['U+200F', 'query', false]]);
    expect(codes(scanHidden('https://ex.com#\u200F'))).toEqual([['U+200F', 'fragment', false]]);
  });
  it('never removes ZWJ or ZWNJ, but reports them', () => {
    const r = scanHidden('https://ex.com/\u200C\u200D');
    expect(r.url).toBe('https://ex.com/\u200C\u200D');
    expect(codes(r)).toEqual([['U+200C', 'path', false], ['U+200D', 'path', false]]);
  });
  it('removes Unicode tag characters (astral, matched as surrogate pairs)', () => {
    expect(scanHidden('https://ex.com/a\u{E0041}b').url).toBe('https://ex.com/ab');
  });
  it('reports percent-encoded hidden characters in any case without changing them', () => {
    const r = scanHidden('https://ex.com/a%E2%80%8Bb?x=%ef%bb%bf#%E2%80%8d');
    expect(r.url).toBe('https://ex.com/a%E2%80%8Bb?x=%ef%bb%bf#%E2%80%8d');
    expect(r.found.map((f) => [f.code, f.part, f.removed, f.encoded])).toEqual([
      ['U+200B', 'path', false, true],
      ['U+FEFF', 'query', false, true],
      ['U+200D', 'fragment', false, true],
    ]);
  });
  it('does not report encoded characters outside the policy', () => {
    expect(scanHidden('https://ex.com/%E2%81%A3').found).toEqual([]); // U+2063, not in the table
  });
  it('leaves an ordinary URL alone', () => {
    expect(scanHidden('https://例子.台灣/路徑?q=1#x')).toEqual({ url: 'https://例子.台灣/路徑?q=1#x', found: [] });
  });
});
```

Add to `test/extract.test.ts` (import `extractUrlDetailed` too):

```ts
  it('keeps a URL whole across a BOM and strips hidden characters', () => {
    expect(extractUrl('https://example.com/a\uFEFFb')).toBe('https://example.com/ab');
    expect(extractUrl('看這個\u200Bhttps://x.com/a\u200B。')).toBe('https://x.com/a');
  });
  it('strips hidden characters from a bare URL too', () => {
    expect(extractUrl('https://ex\u200Bample.com/a')).toBe('https://example.com/a');
  });
  it('keeps every 。 in the host of a bare URL', () => {
    expect(extractUrl('https://example。com/a')).toBe('https://example.com/a');
    expect(extractUrl('https://例子。台灣/')).toBe('https://例子.台灣/');
    expect(extractUrl('https://a。b。example。com')).toBe('https://a.b.example.com');
  });
  it('treats 。 in prose as a sentence end unless an ASCII label follows it in the host', () => {
    expect(extractUrl('請看https://example。com/a 謝謝')).toBe('https://example.com/a');
    expect(extractUrl('請看https://example.com。謝謝')).toBe('https://example.com');
    expect(extractUrl('請看https://example.com。10點見')).toBe('https://example.com');
    expect(extractUrl('請看https://example.com/a。下一句')).toBe('https://example.com/a');
  });
  it('re-scans a host the browser decodes', () => {
    expect(extractUrlDetailed('https://ex%E2%80%8Bample.com/')).toEqual({
      url: 'https://example.com/',
      hidden: [{ code: 'U+200B', part: 'host', removed: true, index: 10 }],
    });
  });
```

(If the encoded-host case comes out with a different `index`, adjust only the index — record a ruling.)

Add to `test/process.test.ts` (inside the main `describe`):

```ts
  it('lists each removed hidden character once and reports the ones it kept', async () => {
    const r = await processUrl('https://ex\u200B.com/a\u200Bb\u200Dc\u202Ed', rules, { expand: false, locale: 'en' });
    expect(r.cleanUrl).toBe('https://ex.com/ab\u200Dcd');
    expect(r.removed.filter((p) => p.category === 'hidden').map((p) => [p.key, p.value])).toEqual([
      ['hidden-bidi', 'U+202E'],
      ['hidden', 'U+200B'],
    ]);
    expect(r.hiddenKept?.map((h) => h.code)).toEqual(['U+200D']);
  });
  it('cleans hidden characters in an unwrapped link', async () => {
    const wrapped = `https://l.facebook.com/l.php?u=${encodeURIComponent('https://example.com/a\u200Bb')}`;
    const r = await processUrl(wrapped, rules, { expand: false, locale: 'en' });
    expect(r.cleanUrl).toBe('https://example.com/ab');
    expect(r.removed.map((p) => p.key)).toContain('hidden');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/core && npx vitest run test/hidden.test.ts test/extract.test.ts test/process.test.ts`
Expected: FAIL — module `../src/hidden` missing; `extractUrlDetailed` not exported; extract stops at `\uFEFF` and at `。`.

- [ ] **Step 3: Implement** — `packages/core/src/hidden.ts`

```ts
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
  const rest = url.slice(scheme);
  const authEnd = scheme + (rest.search(/[/\\?#]/) < 0 ? rest.length : rest.search(/[/\\?#]/));
  const at = url.lastIndexOf('@', authEnd - 1);
  const hostStart = at >= scheme ? at + 1 : scheme;
  const q = url.indexOf('?', authEnd);
  const h = url.indexOf('#', authEnd);
  const fragStart = h < 0 ? Infinity : h;
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
    const hidden = ALWAYS.test(ch) || TAG.test(ch) || HOST_ONLY.test(ch) || KEEP.test(ch);
    const remove = hidden && p !== 'userinfo' && (ALWAYS.test(ch) || TAG.test(ch) || (p === 'host' && HOST_ONLY.test(ch)));
    if (hidden) note({ code: code(ch), part: p, removed: remove, index: i });
    if (!remove) out += ch;
    i += ch.length;
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
const STOP = '。';

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
    const label = /^[^.。]*/.exec(s.slice(i + 1, hostEnd))![0];
    const inHost = i < hostEnd;
    if (!inHost || (!bare && !/^[A-Za-z0-9-]+$/.test(label))) return s.slice(0, i);
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
  const hidden = [...first.found, ...second.found.filter((h) => h.removed && !h.encoded)];
  return { url, hidden };
}

export function extractUrlDetailed(text: string): Extracted | null {
  const m = URL_RE.exec(text);
  if (!m) return null;
  // A bare URL is taken verbatim; trailing punctuation is only trimmed when the URL sits in prose.
  const bare = text.trim() === m[0];
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
```

In `process.ts` (import `extractUrlDetailed`, `takeUrl`, `getHost`):
- Start with `const found = extractUrlDetailed(input)`; `const extracted = found.url`.
- Keep a `const hidden: HiddenChar[] = [...found.hidden]` and a helper used on every URL the pipeline takes up after unwrapping or expansion:

```ts
  // Redirect targets and unwrapped links get the same hidden-character handling as the input.
  const take = (u: string): string => {
    const r = takeUrl(u);
    if (!r) return u;
    hidden.push(...r.hidden);
    return r.url;
  };
```

  and apply it as `let url = take(first.url)` and `url = take(u.url)` (the two places that assign `url`).
- Before `cleanUrl`, turn the findings into results:

```ts
  const host = getHost(extracted);
  const removedCodes = new Set<string>();
  for (const h of hidden.filter((x) => x.removed)) {
    if (removedCodes.has(h.code)) continue; // one row per character kind
    removedCodes.add(h.code);
    removed.push({ key: /^U\+202[A-E]$/.test(h.code) ? 'hidden-bidi' : 'hidden', value: h.code, host });
  }
  const kept = hidden.filter((x) => !x.removed);
```

  and after building `result`: `if (kept.length) result.hiddenKept = kept;`. The share-id `splice` keeps hidden items (it filters by `key !== 'share-id'`).

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

- [ ] **Step 4: Run tests and the invisible-character check**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && python3 scripts/check-invisible.py packages/core/src/*.ts packages/core/test/*.ts && pnpm test && pnpm -s build:rules && pnpm -s test:regression && pnpm -s typecheck`
Expected: no invisible characters; all tests pass; all `cases.json` cases unchanged.

- [ ] **Step 5: Commit**

```bash
git add scripts packages/core rules apps/mobile/src/i18n
git commit -m "feat(core): find hidden characters in every link taken up; strip the deceptive ones"
```

---

### Task 3: Clipboard flow sees hidden characters

**Files:**
- Modify: `apps/mobile/src/lib/clipboardWatch.ts` (`decideText`)
- Test: `apps/mobile/src/lib/clipboardWatch.test.ts`, `apps/mobile/src/lib/cleaner.test.ts`

**Interfaces:**
- Consumes: `extractUrlDetailed` (Task 2).
- Produces: when a link is offered, `decideText(...).url` is the **whole clipboard text**, so `processUrl` extracts it exactly as manual input would; `clean` stays the canonical URL. Any hidden-character finding (removed or kept) makes the link an offer, so its findings reach the result card.

- [ ] **Step 1: Write the failing tests** — add to `clipboardWatch.test.ts` (reuse its `rules` fixture)

```ts
  it('offers a link whose only problem is a zero-width space, passing the whole text on', () => {
    const text = '看 https://example.com/a\u200Bb 。';
    const d = decideText(text, initialWatchState(), rules);
    expect(d.url).toBe(text);
    expect(d.clean).toBeNull();
  });
  it('also offers a link that only carries a kept joiner, so the finding can be shown', () => {
    const d = decideText('https://example.com/a\u200Db', initialWatchState(), rules);
    expect(d.url).toBe('https://example.com/a\u200Db');
  });
```

Add to `cleaner.test.ts` (reuse its deps helper):

```ts
  it('gives the same result for clipboard text and for the same text typed in', async () => {
    const text = '看 https://example.com/a.\u200B';
    const offered = decideText(text, initialWatchState(), deps.rules).url!;
    const a = await cleanInput(offered, deps);
    const b = await cleanInput(text, deps);
    expect(a.result.cleanUrl).toBe(b.result.cleanUrl);
    expect(a.result.cleanUrl).toBe('https://example.com/a');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/mobile && npx vitest run src/lib/clipboardWatch.test.ts src/lib/cleaner.test.ts`
Expected: FAIL — the zero-width-space link is reported as clean.

- [ ] **Step 3: Implement** — in `decideText`

```ts
  const found = fresh ? extractUrlDetailed(text) : null;
  // Hidden characters (removed or kept) are worth showing even without tracking params.
  const offer = found !== null && (needsCleaning(found.url, rules) || found.hidden.length > 0);
  return {
    url: offer ? text : null,
    fresh,
    clean: found && !offer ? found.url : null,
    next: { ...s, lastSeenText: text || s.lastSeenText },
  };
```

Import `extractUrlDetailed` instead of `extractUrl`. Update the comment above `decideText`: the offered value is the whole text, processed exactly like typed input.

- [ ] **Step 4: Run tests**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && python3 scripts/check-invisible.py apps/mobile/src/lib/*.ts && pnpm test && pnpm -s typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib
git commit -m "fix(mobile): offer clipboard links that carry hidden characters"
```

---

### Task 4: Hop-by-hop short-link expansion

**Files:**
- Modify: `packages/core/src/query.ts` (`parseUrl(url, base?)`)
- Modify: `packages/core/src/expand.ts` (`resolve` follows redirects itself and keeps a trail; `Stopped` error)
- Modify: `packages/core/src/process.ts` (`destination` via `destinationOf`)
- Modify: `packages/core/src/types.ts` (`ProcessResult.destination?`)
- Modify: `packages/core/src/index.ts` (export `destinationOf`, and `canonicalUrl` for the regression replay)
- Modify: `rules/test/regression/cases.test.ts` (strict `replay`)
- Test: `packages/core/test/expand.test.ts`, `packages/core/test/process.test.ts`, `apps/mobile/src/lib/cleaner.test.ts`

**Interfaces:**
- Consumes: `siteOf`, `sameSite` (Task 1), `takeUrl` (Task 2, already applied by `processUrl` to expanded URLs).
- Produces: unchanged `expandUrl` signature; every request uses `redirect: 'manual'`. `ExpandResult.hops` is the full trail (every hop requested or read), also on failure.
  ```ts
  export function destinationOf(r: Pick<ProcessResult, 'status' | 'cleanUrl' | 'hops'>): ProcessResult['destination'];
  // ProcessResult.destination?: { site: SiteInfo; complete: boolean }
  // complete only for 'clean'; otherwise the site of the last hop reached. Undefined for 'failed'.
  ```

- [ ] **Step 1: Migrate every test fetcher to explicit redirects**

Run `grep -rn "status: 200\|=> ({ url" packages/core/test apps/mobile/src` and convert each fetcher that simulates an automatic redirect (status 200 with a `url` different from the one requested):
- `packages/core/test/expand.test.ts`: `{ url: <target> }` under key `<short>` becomes `{ url: <short>, status: 302, location: <target> }`, plus `[<target>]: { url: <target> }` when the target is on the same site (it will now be requested). The second key must be the target as `canonicalUrl` spells it (e.g. in `'keeps the path when a redirect spells it with a backslash'` the key is `'https://m.facebook.com/photo.php?fbid=123'`, not the backslash form). Change the two `redirect: 'follow'` assertions: in `'resolves a Threads share link…'` the expected calls become two HEAD requests (`THREADS`, then the same-site `THREADS_POST`), both `redirect: 'manual'`; `'lets other expanders keep following redirects'` becomes `'uses manual redirects for every expander'` and asserts `'manual'`. Delete `'is unresolved when fetch reports an empty final URL'` (manual mode never reads `res.url`; record a ruling). Rewrite `'keeps the redirect target on HTTP errors'` on one site — a cross-site target is no longer requested:

  ```ts
  it('keeps the redirect target on HTTP errors', async () => {
    const fetch = fakeFetch({ [THREADS]: { url: THREADS, status: 302, location: THREADS_POST }, [THREADS_POST]: { url: THREADS_POST, status: 404 } });
    const r = await expandUrl(THREADS, expanders, opts(fetch));
    expect(r).toEqual({ url: THREADS, hops: [THREADS, THREADS_POST], removed: [], reason: 'network' });
  });
  ```
- `packages/core/test/process.test.ts`: `threadsFetch` answers `THREADS` with `302 → THREADS_POST` and `THREADS_POST` with 200; `mapFetch(map)` answers a mapped URL with `{ url, status: 302, location: map[url] }` and any URL that is a mapped value with `{ url, status: 200 }`; the inline fetcher at the `expand_timeout` test likewise.
- `apps/mobile/src/lib/cleaner.test.ts`: its fetcher answers the short link with `302 → POST` and `POST` with 200.

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

  it.each([
    ['../../@someone/post/DTest00001?xmt=AQGtest&slof=1'],
    ['/@someone/post/DTest00001?xmt=AQGtest&slof=1'],
  ])('follows a relative redirect %s that stays on the same site', async (location) => {
    const fetch = fakeFetch({ [THREADS]: { url: THREADS, status: 301, location }, [THREADS_POST]: { url: THREADS_POST, status: 200 } });
    expect((await expandUrl(THREADS, expanders, opts(fetch))).url).toBe(THREADS_POST);
  });

  it('resolves a sibling or query-only Location like a browser', async () => {
    const page = 'https://www.threads.com/share/BAAtest0002/x';
    const fetch = fakeFetch({
      [page]: { url: page, status: 302, location: 'y' },
      'https://www.threads.com/share/BAAtest0002/y': { url: 'https://www.threads.com/share/BAAtest0002/y', status: 302, location: '?x=1' },
      'https://www.threads.com/share/BAAtest0002/y?x=1': { url: 'https://www.threads.com/share/BAAtest0002/y?x=1', status: 302, location: THREADS_POST },
      [THREADS_POST]: { url: THREADS_POST, status: 200 },
    });
    const r = await expandUrl(page, expanders, opts(fetch));
    expect(r.hops).toEqual([page, 'https://www.threads.com/share/BAAtest0002/y', 'https://www.threads.com/share/BAAtest0002/y?x=1', THREADS_POST]);
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

  it('stops at six requests on one site and keeps every hop', async () => {
    const calls: Call[] = [];
    const hop = (n: number) => `https://www.threads.com/share/LOOP000${n}/`;
    const map = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((n) => [hop(n), { url: hop(n), status: 302, location: hop(n + 1) }]));
    const r = await expandUrl(hop(0), expanders, opts(fakeFetch(map, calls)));
    expect(r.reason).toBe('unresolved');
    expect(calls).toHaveLength(6);
    expect(r.hops).toEqual([0, 1, 2, 3, 4, 5, 6].map(hop));
  });

  it('does not request the next hop after the deadline', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const late = new Promise<void>((r) => (release = r));
    const fetch: FetchFn = async (url) => {
      calls.push(url);
      if (url === THREADS) {
        await late; // ignores abort, answers after the deadline
        return { url, status: 302, location: THREADS_POST };
      }
      return { url, status: 200 };
    };
    const r = await expandUrl(THREADS, expanders, opts(fetch, 20));
    expect(r.reason).toBe('expand_timeout');
    release();
    await new Promise((done) => setTimeout(done, 30));
    expect(calls).toEqual([THREADS]);
  });

  it('keeps the hop reached when a later hop fails', async () => {
    const fetch = fakeFetch({ [THREADS]: { url: THREADS, status: 302, location: THREADS_POST }, [THREADS_POST]: new Error('offline') });
    const r = await expandUrl(THREADS, expanders, opts(fetch));
    expect(r.reason).toBe('network');
    expect(r.hops).toEqual([THREADS, THREADS_POST]);
  });
```

Add to `test/process.test.ts`:

```ts
  it('reports the destination reached so far when expansion stops early', async () => {
    const post = 'https://www.threads.com/@someone/post/DTest00001';
    const fetch: FetchFn = async (url) => {
      if (url === THREADS) return { url, status: 302, location: post };
      throw new Error('offline');
    };
    const r = await processUrl(THREADS, rules, { expand: true, locale: 'en', fetch });
    expect(r.hops).toEqual([THREADS, post]);
    expect(r.destination).toMatchObject({ complete: false, site: { domain: 'threads.com' } });
  });
  it('reports a finished destination for a clean result', async () => {
    const r = await processUrl('https://shopee.tw.secure-login.xyz/a?utm_source=x', rules, { expand: false, locale: 'en' });
    expect(r.destination).toMatchObject({ complete: true, site: { domain: 'secure-login.xyz' } });
  });
  it('cleans a hidden character that arrives in a Location header', async () => {
    const fetch: FetchFn = async (url) => ({ url, status: 301, location: 'https://example.com/a\u200Bb' });
    const r = await processUrl('https://bit.ly/TEST02', rules, { expand: true, locale: 'en', fetch });
    expect(r.cleanUrl).toBe('https://example.com/ab');
    expect(r.removed.map((p) => p.key)).toContain('hidden');
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

// Why expansion stopped, and every hop it got to.
class Stopped extends Error {
  constructor(
    readonly reason: ExpandFailure,
    readonly trail: string[],
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
// wall (its next param is the answer) and the first hop of a firstHop expander are taken from Location
// and returned without being requested, so expansion never contacts the destination.
// Resolves to the trail: [url, ...every later hop]; the last entry is the answer.
async function resolve(
  url: string,
  expanders: Record<string, Expander>,
  opts: ExpandOptions,
  firstHop: boolean,
): Promise<string[]> {
  const controller = new AbortController();
  const headers = { 'User-Agent': opts.userAgent };
  const trail = [url];
  const current = () => trail[trail.length - 1]!;
  const send = (method: 'HEAD' | 'GET') => {
    // Never start a request after the deadline has passed.
    if (controller.signal.aborted) throw new Stopped('expand_timeout', [...trail]);
    return opts.fetch(current(), { method, headers, signal: controller.signal, redirect: 'manual' });
  };
  const work = (async () => {
    try {
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        let res = await send('HEAD');
        // Some services reject HEAD outright (405) or answer it with 404; GET still redirects.
        if (res.status === 405 || res.status === 404) res = await send('GET');
        if (!(res.status >= 300 && res.status < 400 && res.location)) {
          if (res.status >= 400) throw new Stopped('network', [...trail]);
          return trail;
        }
        const next = nextHop(res.location, current());
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
```

In `expandUrl`:

```ts
  let trail: string[];
  try {
    trail = await resolve(requestUrl, expanders, opts, expander.firstHop === true);
  } catch (e) {
    const t = e instanceof Stopped ? e.trail : [requestUrl];
    return fail(e instanceof Stopped ? e.reason : 'network', [url, ...t.slice(1)]);
  }
  const raw = trail[trail.length - 1]!;
```

Then keep the existing code from `const finalUrl = canonicalUrl(raw)` on, but build `hops` as `[url, ...trail.slice(1)]` (then push the login-wall `next` and the normalized host as today). The 'unresolved when still the same share link' check stays.

`process.ts` — add and export:

```ts
// Where the link goes: the clean URL when finished, otherwise the last hop reached.
export function destinationOf(r: Pick<ProcessResult, 'status' | 'cleanUrl' | 'hops'>): ProcessResult['destination'] {
  if (r.status === 'failed') return undefined;
  const site = siteOf(r.status === 'clean' ? r.cleanUrl : (r.hops[r.hops.length - 1] ?? r.cleanUrl));
  return site ? { site, complete: r.status === 'clean' } : undefined;
}
```

and after building `result`: `const destination = destinationOf(result); if (destination) result.destination = destination;`.

`types.ts`: `destination?: { site: SiteInfo; complete: boolean };` on `ProcessResult`. `index.ts`: export `destinationOf` and `canonicalUrl` (from `./query`).

`rules/test/regression/cases.test.ts` — strict replay that also checks method and mode:

```ts
import { canonicalUrl, processUrl, sameSite } from '@linkclean/core';

const loginWalls = Object.values(rules.expanders).flatMap((e) => (e.loginWall ? [new RegExp(e.loginWall.match, 'i')] : []));

// Each recorded short link answers with a redirect to its final URL. A final URL is answered only
// when it is on the same site as the link that pointed to it and is not a login wall; anything else
// is an unexpected request.
function replay(responses: Record<string, string | undefined>): FetchFn {
  const source = new Map(Object.entries(responses).map(([from, to]) => [canonicalUrl(to ?? '') ?? to, from]));
  return async (url, init) => {
    if (init.redirect !== 'manual' || (init.method !== 'HEAD' && init.method !== 'GET')) {
      throw new Error(`unexpected ${init.method} ${init.redirect} request to ${url}`);
    }
    const final = responses[url];
    if (final === url) return { url, status: 200 }; // recorded as not redirecting
    if (final !== undefined) return { url, status: 302, location: final };
    if (loginWalls.some((re) => re.test(url))) throw new Error(`login wall requested: ${url}`);
    const from = source.get(url);
    if (from !== undefined && sameSite(from, url)) return { url, status: 200 };
    throw new Error(`unexpected request to ${url}`);
  };
}
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && python3 scripts/check-invisible.py packages/core/src/*.ts packages/core/test/*.ts && pnpm test && pnpm -s build:rules && pnpm -s test:regression && pnpm -s typecheck`
Expected: all pass, including every existing `cases.json` case. A case that throws `unexpected request` means a cross-site destination was being contacted — fix the code, not the replay.

- [ ] **Step 6: Live check (network)**

Run: `pnpm -s test:live`
Expected: same result as before the change (it may only warn when no live cases are configured). Then, with links the user provides **only as environment variables** (never written to files), compare Facebook, Threads, TikTok, bilibili `b23.tv`, Xiaohongshu and Reddit `/s/` results against the 0.1.1 build. A changed result is a finding to report, not something to patch over.

- [ ] **Step 7: Commit**

```bash
git add packages/core rules/test apps/mobile/src/lib/cleaner.test.ts
git commit -m "feat(core): expand short links hop by hop without contacting the destination"
```

---

### Task 5: LINE short links (`lin.ee`)

**Files:**
- Modify: `rules/expanders.json` (add `line` before `generic`)
- Modify: `rules/overrides.json` (provider for LINE Official Account add-friend links only)
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

Evidence for the two parameters: `oat_content` and `ts` are the parameters LINE Official Account Manager appends to add-friend links it generates (`oat_content=url` marks the "URL" channel; `ts` the link's creation code). Before committing, confirm on one add-friend link the user generates or already has (environment variable only) that removing them still opens the same account; if it does not, drop that parameter from the rule and record a ruling.

`rules/expanders.json`, before `"generic"`:

```json
  "line": {
    "match": "^https?://lin\\.ee/",
    "firstHop": true
  },
```

`rules/overrides.json` provider:

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

Run: `pnpm -s build:rules && pnpm -s test:regression && pnpm test && pnpm --filter @linkclean/mobile sync-rules && grep -c 'lin\\\\.ee' apps/mobile/assets/rules.json`
Expected: all pass; the count is at least 1.

- [ ] **Step 5: Commit**

```bash
git add rules apps/mobile/assets/rules.json
git commit -m "feat(rules): expand LINE lin.ee links and drop Official Account source tracking"
```

---

### Task 6: Show the site in the app (and in history)

**Files:**
- Create: `apps/mobile/src/lib/siteLabel.ts`
- Modify: `apps/mobile/src/components/ResultCard.tsx` (site line, kept hidden characters)
- Modify: `apps/mobile/app/index.tsx` (clean-link notice shows the site)
- Modify: `apps/mobile/src/lib/db.ts` (rows derive `destination` and `hiddenKept`)
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json`
- Test: `apps/mobile/src/lib/siteLabel.test.ts`, `apps/mobile/src/lib/db.test.ts`

**Interfaces:**
- Consumes: `siteOf`, `SiteInfo`, `destinationOf`, `scanHidden` from `@linkclean/core`; `ProcessResult.destination`, `ProcessResult.hiddenKept`.
- Produces: `export function siteLabel(site: SiteInfo): { sub: string; main: string; ascii: string | null }` — `main` is the domain (or the whole host for IPs and bare suffixes), `sub` the part of the host before it, `ascii` the `xn--` host when it differs from the shown one.

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/lib/siteLabel.test.ts`:

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

Add to `db.test.ts` (reuse its in-memory db helper): store a `partial` result whose `hops` end at a Threads post and whose `originalUrl` contains `\u200D`; reading it back gives `destination: { complete: false, site.domain: 'threads.com' }` and `hiddenKept` with `U+200D`; a row written by the old code (no new fields) reads back the same way.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/mobile && npx vitest run src/lib/siteLabel.test.ts src/lib/db.test.ts`
Expected: FAIL — module missing; history rows have no `destination`.

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

`db.ts` — in the row → result function, after building `result` (no schema change; both fields are derived from stored columns, so old rows get them too):

```ts
  const destination = destinationOf(result);
  if (destination) result.destination = destination;
  // Kept hidden characters stay in the stored original URL, so they can be found again.
  const kept = scanHidden(result.originalUrl).found.filter((h) => !h.removed);
  if (kept.length) result.hiddenKept = kept;
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

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && python3 scripts/check-invisible.py apps/mobile/src/lib/*.ts && pnpm test && pnpm -s typecheck`
Expected: all pass (i18n key-parity test included).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): show the main domain of every link, also in history"
```

---

### Task 7: Android build — R8, orientation, Expo patch

Play Console flagged versionCode 1: DEX obfuscation 1% (must reach 25% by 2027-02) and an orientation lock that Android 16 ignores on large screens. `apps/mobile/android/` is generated by prebuild and git-ignored, so every change goes into app config; keep rules, if any, live only in `expo-build-properties` `android.extraProguardRules`.

**Files:**
- Modify: `apps/mobile/package.json` (Expo patch, `expo-build-properties`)
- Modify: `apps/mobile/app.json` (`orientation`, `expo-build-properties` plugin)

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

- [ ] **Step 4: Release smoke test on the emulator**

Run (in `apps/mobile/android`): `./gradlew createBundleReleaseJsAndAssets --rerun assembleRelease bundleRelease`, install the APK on the emulator, then exercise: cold start; typing a link with tracking params; a short link that expands through `expo/fetch` (a Threads or bit.ly test link typed on the device); sharing a link into Untail while the app is closed (cold start from the share sheet); history list, open an entry, clear history (database); Settings toggles; Privacy and Licenses screens; rules download.
Expected: no crash; `adb logcat -d | grep -E "FATAL|ClassNotFound|NoSuchMethod|NoSuchField"` is empty. If something is stripped, add the narrowest `-keep` rule for that class through `android.extraProguardRules` (never a whole-package keep) and record a ruling.

- [ ] **Step 5: Landscape and large screen**

On the emulator in landscape and on a tablet-size AVD: every screen scrolls, nothing is cut off, buttons stay reachable. Fix layout only where something is unusable.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.json pnpm-lock.yaml
git commit -m "build(android): enable R8, drop the orientation lock, Expo 57 patch update"
```

- [ ] **Step 7 (after upload, Task 8): confirm in Play Console** that the DEX obfuscation finding no longer lists the new versionCode (Play re-evaluates each uploaded bundle; R8 being on is not proof by itself). If it still does, report it to the user with the numbers Play shows.

---

### Task 8: Privacy, licences, data safety, release

**Files:**
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json` (`privacy.p3`, licences strings)
- Modify: `docs/site/privacy.html` (same text, `Last updated`)
- Modify: `apps/mobile/app/licenses.tsx`, `NOTICE.md` (tldts MIT, Public Suffix List MPL-2.0, punycode MIT)
- Modify: `docs/store/google-play-data-safety.md` (expansion row)
- Modify: `apps/mobile/app.json` (`android.versionCode` + 1, `version` patch + 1)

- [ ] **Step 1: Update `privacy.p3`** (three languages and the site): the app contacts the short-link service and follows a redirect only while it stays on that service's own site; a redirect to an ordinary website is read from the reply and that website is not contacted; when the redirect points to another short-link service Untail knows (one short link leading to another), Untail contacts that service too. Keep the HEAD/GET sentence, the automatic-mode sentence, the HTTPS sentence and the opt-out.

- [ ] **Step 2: Licences** — add to `NOTICE.md` and the Licenses screen: `tldts` (MIT), the Public Suffix List data it bundles (MPL-2.0, https://mozilla.org/MPL/2.0/), `punycode` (MIT).

- [ ] **Step 3: Data safety doc** expansion row: "短網址服務（以及同一網站內的轉址、它轉到的其他已知短網址服務）；轉到一般網站時只讀取目的網址，不會連過去".

- [ ] **Step 4: Bump version** in `app.json` and run `npx expo prebuild -p android --no-install` in `apps/mobile`.

- [ ] **Step 5: Full verification**

Run: `python3 scripts/check-invisible.py $(git diff --name-only main -- '*.ts' '*.tsx' '*.json' '*.md') && pnpm test && pnpm -s build:rules && pnpm -s test:regression && pnpm -s typecheck`
Expected: all pass.

- [ ] **Step 6: Build and verify on Hermes (emulator first)**

Run (in `apps/mobile/android`): `./gradlew createBundleReleaseJsAndAssets --rerun assembleRelease bundleRelease`; install the APK on the emulator. Installing on the user's phone needs the user's go-ahead: the phone runs the Play-installed build, and a build signed with the upload key cannot replace it without uninstalling (losing local history).
Send test links into the app with the share intent so characters arrive exactly (never real links in files):

```bash
send() { adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'$1'" com.ttylab.untail; }
send "$(printf 'https://ex.com/a\u200Bb')"            # lists a 隱藏字元 item
send "$(printf 'https://ex.com/a\U000E0041b')"        # tag character removed (surrogate pair on Hermes)
send "https://例子.台灣/"                              # 網站：例子.台灣 (xn--fsqu00a.xn--kpry57d)
send "$(printf 'https://ｅｘａｍｐｌｅ.com/')"  # 網站：example.com
send "https://alice.github.io/"                        # 網站：alice.github.io
```

Expected: as commented, plus a typed bit.ly test link resolves without delay and a typed lin.ee test link shows `網站：line.me`. This confirms dynamic `RegExp`, surrogate pairs, `String.prototype.normalize`, `tldts` and `punycode` on Hermes.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile docs NOTICE.md
git commit -m "docs: describe hop-by-hop expansion and new licences; bump version"
```

---

## Not in this plan (deliberate)

- Blocklists (165, global) and heuristics (S3) — phases 2 and 3 of the spec.
- Full UTS #46: `mapHost` covers the cases that change which site a link opens in practice (ignored characters, full-width forms via NFKC, ideographic dots, case). Bidi and joiner validity rules for IDN labels are not checked; such hosts are shown as they parse.
- In prose, `。` before a non-ASCII label (`看 https://例子。台灣/`) ends the URL; a bare URL keeps it. Ambiguous prose is rarer than Chinese sentences ending right after a link.
- The clipboard gate (`needsCleaning`) stays, extended with hidden-character findings (Task 3). A link with nothing to clean still reaches the clean-link notice, which now shows its site (Task 6), so every clipboard link gets S2 in phase 1.
- A partial result keeps the short link as `cleanUrl` (copy/open use it, as today); the card shows the destination reached so far. Copying an unfinished destination would hand the user a link Untail did not finish cleaning.
- Splitting the LINE rule and the Android fixes into separate releases: kept here with the user's agreement; LINE is narrowed to the add-friend path because it makes a scam `lin.ee` link show its real destination.
- Upgrading to Expo SDK 58: `expo-share-intent` 8.0.1 declares `expo: ^57` only; revisit when it supports 58 or when iOS work starts.
