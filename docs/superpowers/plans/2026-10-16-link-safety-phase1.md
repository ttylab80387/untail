# Link Safety Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show users where a link really goes (main domain), strip deceptive invisible characters from URLs, and stop short-link expansion from contacting destination sites — without ever claiming a link is safe.

**Architecture:** All logic lives in `@linkclean/core` (pure TypeScript, tested on Node with vitest) and is consumed by the Expo app. Expansion becomes hop-by-hop with `redirect: 'manual'`, continuing only while the next hop stays on the same registrable domain; the destination of a cross-site redirect is read from `Location` and never requested. `ProcessResult` gains a `site` field computed with `tldts`. Hidden characters are found during extraction and reported as removed items of a new category `hidden`.

**Tech Stack:** TypeScript, vitest, `tldts` (MIT, bundled Public Suffix List), `whatwg-url-minimum` (already used), Expo SDK 57 / React Native, i18next (zh-TW / en / ja).

**Spec:** `docs/superpowers/specs/2026-10-16-link-safety-design.md` (phase 1 = §3, §4, §5, plus the §8 wording rules that apply without blocklists)

## Global Constraints

- Never say a link is "safe" or that Untail checked it; wording says what was found or done.
- Links are never sent anywhere for the purpose of checking; only short-link expansion makes requests.
- Comments in English; UI strings in zh-TW, en and ja, all three updated together.
- Existing behaviour of `rules/fixtures/cases.json` must not regress (all cases still pass).
- No real share links from the user in any file, fixture or commit; use `TEST…` IDs.
- `tldts` must be called with `{ allowPrivateDomains: true }`.
- ZWJ (U+200D) and ZWNJ (U+200C) are never removed; direction marks/isolates are removed only from the host.
- Bump `apps/mobile/app.json` `android.versionCode` by 1 for the build that ships this.

## Review Focus

1. Facebook / Threads / TikTok share links must expand to the same post URLs as before under hop-by-hop expansion (same-domain redirects are still followed) — pinned by the existing `cases.json` regression plus Task 3 tests.
2. Chinese prose around a URL with a zero-width space right before or after it (`看這個​https://x.com/a​。`) must extract exactly the URL — Task 2 test.
3. A Unicode (IDN) host must display readably and never be treated as an error — Task 1 test.
4. `alice.github.io` and `bob.github.io` must show as different sites — Task 1 test.
5. A redirect loop or a long chain on one domain must stop at the hop limit with `unresolved`, not hang — Task 3 test.

---

### Task 1: Site info (main domain) in core

**Files:**
- Create: `packages/core/src/site.ts`
- Modify: `packages/core/src/types.ts` (add `SiteInfo`, `ProcessResult.site`)
- Modify: `packages/core/src/process.ts` (set `site`)
- Modify: `packages/core/src/index.ts` (export `siteOf`)
- Modify: `packages/core/package.json` (add `tldts`)
- Test: `packages/core/test/site.test.ts`

**Interfaces:**
- Produces: `export interface SiteInfo { host: string; domain: string | null; isIp: boolean }` and `export function siteOf(url: string): SiteInfo | null` (null when the URL cannot be parsed or has no host). `ProcessResult.site?: SiteInfo` (absent for `failed`).

- [ ] **Step 1: Add dependency**

Run: `pnpm --filter @linkclean/core add tldts`
Expected: `packages/core/package.json` lists `tldts`.

- [ ] **Step 2: Write the failing test** — `packages/core/test/site.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { siteOf } from '../src/site';

describe('siteOf', () => {
  it('returns the registrable domain under the public suffix list', () => {
    expect(siteOf('https://shopee.tw.secure-login.xyz/a')).toEqual({
      host: 'shopee.tw.secure-login.xyz',
      domain: 'secure-login.xyz',
      isIp: false,
    });
    expect(siteOf('https://news.bbc.co.uk/x')?.domain).toBe('bbc.co.uk');
  });
  it('treats private suffixes as separate sites', () => {
    expect(siteOf('https://alice.github.io/')?.domain).toBe('alice.github.io');
    expect(siteOf('https://bob.github.io/')?.domain).toBe('bob.github.io');
  });
  it('handles IP hosts and Unicode hosts without throwing', () => {
    expect(siteOf('http://203.0.113.5/login')).toEqual({ host: '203.0.113.5', domain: null, isIp: true });
    expect(siteOf('https://例子.台灣/路徑')?.host).toBe('例子.台灣');
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

- [ ] **Step 4: Implement** — `packages/core/src/site.ts`

```ts
import { parse } from 'tldts';
import { getHost } from './query';
import type { SiteInfo } from './types';

// Where a link really goes: the host and its registrable ("main") domain.
// Private suffixes count, so alice.github.io and bob.github.io are different sites.
export function siteOf(url: string): SiteInfo | null {
  const host = getHost(url);
  if (!host) return null;
  const p = parse(host, { allowPrivateDomains: true });
  return { host, domain: p.isIp ? null : (p.domain ?? null), isIp: p.isIp === true };
}
```

In `types.ts` add:

```ts
export interface SiteInfo {
  host: string; // as the browser parses it (Unicode hosts stay Unicode)
  domain: string | null; // registrable domain; null for IPs and bare suffixes
  isIp: boolean;
}
```

and `site?: SiteInfo;` to `ProcessResult`. In `process.ts`, after building `result`: `const site = siteOf(cleaned.url); if (site) result.site = site;`. In `index.ts`: `export { siteOf } from './site';`.

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit -p .`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): report the main domain a link goes to"
```

---

### Task 2: Hidden characters in URLs

**Files:**
- Create: `packages/core/src/hidden.ts`
- Modify: `packages/core/src/extract.ts` (new `extractUrlDetailed`, `extractUrl` delegates)
- Modify: `packages/core/src/process.ts` (push hidden items into `removed`)
- Modify: `packages/core/src/types.ts` (`Category` adds `'hidden'`)
- Modify: `packages/core/src/validate.ts`, `rules/src/bundle.ts` (`CATEGORIES` adds `'hidden'`)
- Modify: `rules/knowledge.json` (entry `hidden`)
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json` (`category.hidden`)
- Test: `packages/core/test/hidden.test.ts`, `packages/core/test/extract.test.ts`, `packages/core/test/process.test.ts`

**Interfaces:**
- Produces: `export function stripHidden(url: string): { url: string; removed: string[] }` where `removed` holds code points like `'U+200B'`; `export function extractUrlDetailed(text: string): { url: string; hidden: string[] } | null`. Removed items in `ProcessResult.removed` use `key: 'hidden'`, `value: 'U+200B'`, category `hidden`.

- [ ] **Step 1: Write the failing tests** — `packages/core/test/hidden.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { stripHidden } from '../src/hidden';

describe('stripHidden', () => {
  it('removes zero-width space, BOM, word joiner and soft hyphen anywhere', () => {
    expect(stripHidden('https://ex​ample.com/a﻿b­c⁠d')).toEqual({
      url: 'https://example.com/abcd',
      removed: ['U+200B', 'U+FEFF', 'U+00AD', 'U+2060'],
    });
  });
  it('removes direction embeddings/overrides anywhere and marks/isolates only in the host', () => {
    expect(stripHidden('https://evil‮.com/a').url).toBe('https://evil.com/a');
    expect(stripHidden('https://ex‏ample.com/a‏b').url).toBe('https://example.com/a‏b');
  });
  it('never removes ZWJ or ZWNJ', () => {
    expect(stripHidden('https://ex.com/‌‍')).toEqual({ url: 'https://ex.com/‌‍', removed: [] });
  });
  it('removes Unicode tag characters', () => {
    expect(stripHidden('https://ex.com/a\u{E0041}b').url).toBe('https://ex.com/ab');
  });
});
```

Add to `test/extract.test.ts`:

```ts
  it('keeps a URL whole across a BOM and strips hidden characters', () => {
    expect(extractUrl('https://example.com/a﻿b')).toBe('https://example.com/ab');
    expect(extractUrl('看這個​https://x.com/a​。')).toBe('https://x.com/a');
  });
```

Add to `test/process.test.ts` (inside the main `describe`):

```ts
  it('lists hidden characters it removed from the link', async () => {
    const r = await processUrl('https://example.com/a​b', rules, { expand: false, locale: 'en' });
    expect(r.cleanUrl).toBe('https://example.com/ab');
    expect(r.removed.map((p) => [p.key, p.value])).toContainEqual(['hidden', 'U+200B']);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/core && npx vitest run test/hidden.test.ts test/extract.test.ts test/process.test.ts`
Expected: FAIL — module `../src/hidden` missing; extract keeps `﻿`-split URL as `https://example.com/a`.

- [ ] **Step 3: Implement** — `packages/core/src/hidden.ts`

```ts
// Invisible characters that can break a link, tag who copied it, or disguise it.
// ZWJ/ZWNJ are legitimate in IDN hosts, Persian text and emoji, so they are never removed.
const ALWAYS = /[​﻿⁠­‪-‮]|[\u{E0000}-\u{E007F}]/u;
const HOST_ONLY = /[‎‏⁦-⁩]/u;

const code = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

export function stripHidden(url: string): { url: string; removed: string[] } {
  const scheme = /^[a-z][a-z0-9+.-]*:[/\\]*/i.exec(url)?.[0].length ?? 0;
  let inHost = scheme > 0;
  let out = url.slice(0, scheme);
  const removed: string[] = [];
  for (const ch of url.slice(scheme)) {
    if (inHost && /[/\\?#]/.test(ch)) inHost = false;
    if (ALWAYS.test(ch) || (inHost && HOST_ONLY.test(ch))) removed.push(code(ch));
    else out += ch;
  }
  return { url: out, removed };
}
```

In `extract.ts`: change `URL_RE` so hidden characters do not end the match:

```ts
const HIDDEN = '\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF\\u00AD';
const URL_RE = new RegExp(`https?:[/\\\\]+(?:[^\\s"<>《》“”‘’。，、；：！？「」『』（）【】]|[${HIDDEN}])+`, 'iu');
```

Then rename the existing body to `extractUrlDetailed(text)`: after trimming trailing punctuation, call `stripHidden(trimmed)`, trim trailing punctuation again (a hidden char may have sat before `。`), then `canonicalUrl` on the stripped URL; return `{ url, hidden: removed }` or `null`. Strip hidden characters at the start of the match too (they precede `https`). Keep `export function extractUrl(text: string): string | null { return extractUrlDetailed(text)?.url ?? null; }`.

In `process.ts` use `extractUrlDetailed`; after extraction push `...hidden.map((value) => ({ key: 'hidden', value, host: getHost(extracted) }))` into `removed`.

Add `'hidden'` to `Category` in `types.ts` and to both `CATEGORIES` arrays. Add to `rules/knowledge.json`:

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
```

Add `category.hidden`: zh-TW `"隱藏字元"`, en `"Hidden character"`, ja `"隠し文字"`.

- [ ] **Step 4: Run tests**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && pnpm test && pnpm -s build:rules && pnpm -s test:regression && pnpm -s typecheck`
Expected: all pass (rules data test validates the new category).

- [ ] **Step 5: Commit**

```bash
git add packages/core rules apps/mobile/src/i18n
git commit -m "feat(core): find and strip hidden characters in links"
```

---

### Task 3: Hop-by-hop short-link expansion

**Files:**
- Modify: `packages/core/src/expand.ts` (`resolve` follows redirects itself)
- Modify: `rules/test/regression/cases.test.ts` (`replay` answers unknown URLs with 200)
- Test: `packages/core/test/expand.test.ts`

**Interfaces:**
- Consumes: `siteOf(url)` from Task 1 (`domain` comparison).
- Produces: unchanged `expandUrl` signature; every request now uses `redirect: 'manual'`.

- [ ] **Step 1: Write the failing tests** — add to `test/expand.test.ts` inside `describe('expandUrl')`

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

  it('follows redirects that stay on the same site', async () => {
    const fetch = fakeFetch({
      [THREADS]: { url: THREADS, status: 301, location: '/@someone/post/DTest00001?xmt=AQGtest&slof=1' },
      [THREADS_POST]: { url: THREADS_POST, status: 200 },
    });
    const r = await expandUrl(THREADS, expanders, opts(fetch));
    expect(r.url).toBe(THREADS_POST);
  });

  it('gives up on an endless same-site redirect chain', async () => {
    const loop = 'https://www.threads.com/share/LOOP0001/';
    const fetch = fakeFetch({ [loop]: { url: loop, status: 302, location: loop } });
    const r = await expandUrl(loop, expanders, opts(fetch));
    expect(r.reason).toBe('unresolved');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/core && npx vitest run test/expand.test.ts`
Expected: FAIL — the bit.ly test sees `redirect: 'follow'` and the Threads relative-Location test resolves to the share URL.

- [ ] **Step 3: Implement** — in `expand.ts` replace `resolve` with a hop loop

```ts
const MAX_HOPS = 6;

// Follows redirects one at a time with manual mode. A hop to another site is taken from
// Location and returned without being requested, so expansion never contacts the destination.
async function resolve(url: string, opts: ExpandOptions, firstHop: boolean): Promise<string> {
  const controller = new AbortController();
  const headers = { 'User-Agent': opts.userAgent };
  const request = async (target: string) => {
    let res = await opts.fetch(target, { method: 'HEAD', headers, signal: controller.signal, redirect: 'manual' });
    // Some services reject HEAD outright (405) or answer it with 404; GET still redirects.
    if (res.status === 405 || res.status === 404) {
      if (controller.signal.aborted) throw new TimeoutError();
      res = await opts.fetch(target, { method: 'GET', headers, signal: controller.signal, redirect: 'manual' });
    }
    return res;
  };
  const work = (async () => {
    try {
      let current = url;
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        const res = await request(current);
        const isRedirect = res.status >= 300 && res.status < 400 && !!res.location;
        if (!isRedirect) {
          if (res.status >= 400) throw new HttpError(current);
          return res.url || current;
        }
        const next = canonicalUrl(absolute(res.location!, current)) ?? absolute(res.location!, current);
        if (firstHop || siteOf(next)?.domain !== siteOf(current)?.domain) return next;
        current = next;
      }
      throw new HttpError(current); // too many same-site redirects
    } catch (e) {
      throw controller.signal.aborted ? new TimeoutError() : e;
    }
  })();
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError());
    }, opts.timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
```

Import `siteOf` from `./site`. The `HttpError` from the loop maps to `fail('network', …)` in `expandUrl` — change that branch so a redirect-limit error returns `unresolved`: throw a distinct `class RedirectLimitError extends Error {}` and catch it as `fail('unresolved')`.

In `rules/test/regression/cases.test.ts` `replay`: answer URLs not in `responses` with `{ url, status: 200 }`, and recorded ones in manual mode with `{ url, status: 302, location: final }`.

- [ ] **Step 4: Run tests**

Run: `cd /Users/ttyusb0978/Desktop/myproject/trackurlapp && pnpm test && pnpm -s build:rules && pnpm -s test:regression`
Expected: all pass, including every existing `cases.json` case.

- [ ] **Step 5: Live check (network)**

Run: `pnpm -s test:live`
Expected: same result as before the change (it may only warn when no live cases are configured).

- [ ] **Step 6: Commit**

```bash
git add packages/core rules/test
git commit -m "feat(core): expand short links hop by hop without contacting the destination"
```

---

### Task 4: LINE short links (`lin.ee`)

**Files:**
- Modify: `rules/expanders.json` (add `line` before `generic`)
- Modify: `rules/overrides.json` (provider `line.me` removes `oat_content`, `ts`)
- Modify: `rules/knowledge.json` (`line.me:oat_content`, `line.me:ts`)
- Modify: `rules/fixtures/cases.json`
- Modify: `apps/mobile/assets/rules.json` (via `pnpm --filter @linkclean/mobile sync-rules`)

**Interfaces:**
- Consumes: Task 3 hop-by-hop expansion (lin.ee → line.me is cross-site, so line.me is never contacted).

- [ ] **Step 1: Write the failing fixture** — append to `rules/fixtures/cases.json`

```json
  {
    "name": "LINE lin.ee link shows the LINE account it opens",
    "input": "https://lin.ee/TESTline1",
    "responses": { "https://lin.ee/TESTline1": "https://line.me/R/ti/p/@test0001?oat_content=url&ts=01010101" },
    "expected": { "cleanUrl": "https://line.me/R/ti/p/@test0001", "status": "clean", "removedKeys": ["oat_content", "ts"] }
  }
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -s build:rules && pnpm -s test:regression`
Expected: FAIL — cleanUrl stays `https://lin.ee/TESTline1`.

- [ ] **Step 3: Implement**

`rules/expanders.json`, before `"generic"`:

```json
  "line": {
    "match": "^https?://lin\\.ee/",
    "firstHop": true
  },
```

`rules/overrides.json` provider:

```json
    "line.me": {
      "urlPattern": "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?line\\.me(?:[/:?#]|$)",
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

Then `pnpm --filter @linkclean/mobile sync-rules`.

- [ ] **Step 4: Run tests**

Run: `pnpm -s build:rules && pnpm -s test:regression && pnpm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add rules apps/mobile/assets/rules.json
git commit -m "feat(rules): expand LINE lin.ee links and drop its source tracking"
```

---

### Task 5: Show the site in the app

**Files:**
- Modify: `apps/mobile/src/components/ResultCard.tsx` (site line under the headline)
- Modify: `apps/mobile/app/index.tsx` (clean-link notice shows the site)
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json` (`result.site`, `home.clipboardNoTrackingSite`)
- Test: `apps/mobile/src/lib/siteLabel.test.ts`, Create: `apps/mobile/src/lib/siteLabel.ts`

**Interfaces:**
- Consumes: `siteOf`, `SiteInfo` from `@linkclean/core` (Task 1); `ProcessResult.site`.
- Produces: `export function siteLabel(site: SiteInfo): { sub: string; main: string }` — `main` is the domain (or the host for IPs/unknown), `sub` is the part of the host before it, e.g. `{ sub: 'shopee.tw.', main: 'secure-login.xyz' }`.

- [ ] **Step 1: Write the failing test** — `apps/mobile/src/lib/siteLabel.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { siteOf } from '@linkclean/core';
import { siteLabel } from './siteLabel';

describe('siteLabel', () => {
  it('splits the host into subdomain and main domain', () => {
    expect(siteLabel(siteOf('https://shopee.tw.secure-login.xyz/a')!)).toEqual({ sub: 'shopee.tw.', main: 'secure-login.xyz' });
    expect(siteLabel(siteOf('https://example.com/')!)).toEqual({ sub: '', main: 'example.com' });
  });
  it('shows the whole host for IPs', () => {
    expect(siteLabel(siteOf('http://203.0.113.5/')!)).toEqual({ sub: '', main: '203.0.113.5' });
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
export function siteLabel(site: SiteInfo): { sub: string; main: string } {
  const main = site.domain ?? site.host;
  const sub = site.host.endsWith(main) ? site.host.slice(0, site.host.length - main.length) : '';
  return { sub, main };
}
```

In `ResultCard.tsx`, right after the headline `<Text>`:

```tsx
      {result.site && (
        <Text style={{ color: c.muted }}>
          {t('result.site')}
          <Text style={{ color: c.muted }}>{siteLabel(result.site).sub}</Text>
          <Text style={{ color: c.text, fontWeight: '700' }}>{siteLabel(result.site).main}</Text>
        </Text>
      )}
```

In `index.tsx` the clean-link notice text becomes `t('home.clipboardNoTrackingSite', { site: siteLabel(siteOf(cleanClipboardLink)!).main })` when `siteOf` returns a value, else the existing `home.clipboardNoTracking`.

Strings:
- `result.site`: zh-TW `"網站："`, en `"Site: "`, ja `"サイト："`
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

### Task 6: Privacy policy, data safety and release

**Files:**
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json` (`privacy.p3`)
- Modify: `docs/site/privacy.html` (same text, `Last updated`)
- Modify: `docs/store/google-play-data-safety.md` (expansion row)
- Modify: `apps/mobile/app.json` (`android.versionCode` + 1, `version` patch + 1)

- [ ] **Step 1: Update `privacy.p3`** (all three languages and the site) to say: the app contacts the short-link service and follows redirects only while they stay on that service's own site; a redirect to another site is read from the reply and that site is not contacted. Keep the HEAD/GET sentence, the automatic-mode sentence, the HTTPS sentence and the opt-out.

- [ ] **Step 2: Update the data safety doc** expansion row: "短網址服務（以及同一網站內的轉址）；轉到其他網站時只讀取目的網址，不會連過去".

- [ ] **Step 3: Bump version** in `app.json` and run `npx expo prebuild -p android --no-install` in `apps/mobile`.

- [ ] **Step 4: Full verification**

Run: `pnpm test && pnpm -s build:rules && pnpm -s test:regression && pnpm -s typecheck`
Expected: all pass.

- [ ] **Step 5: Build and install**

Run (in `apps/mobile/android`): `./gradlew createBundleReleaseJsAndAssets --rerun assembleRelease bundleRelease`, then `adb install -r app/build/outputs/apk/release/app-release.apk`.
Expected: install `Success`; on the phone, sharing a `lin.ee` link shows `網站：line.me` and the account path; a link with a zero-width space shows a "隱藏字元" item; a bit.ly link resolves without delay.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile docs
git commit -m "docs: describe hop-by-hop expansion; bump version"
```

---

## Not in this plan (deliberate)

- Blocklists (165, global) and heuristics (S3) — phases 2 and 3 of the spec.
- Treating the full-width full stop `。` as an IDN label separator in hosts: extraction keeps stopping at `。` because Chinese prose ends sentences with it right after URLs far more often than an IDN uses it.
- Showing the `xn--` form next to Unicode hosts — the Unicode host is shown as parsed; add when a confusable check needs it.
- Excluding the clipboard-detection gate (`needsCleaning`) — clean links already reach the notice, which now shows the site (Task 5).
