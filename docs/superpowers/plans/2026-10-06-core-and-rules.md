# LinkClean Plan 1: Core Engine + Rules Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出可在 Node 上執行、有完整測試的清理引擎 `@linkclean/core`，以及把 ClearURLs 和我們自己的規則合併成 `rules.json` 並由 GitHub Actions 發佈的規則管線；完成後可以用 `pnpm clean-url "<連結>"` 在命令列清理真實連結。

**Architecture:** pnpm monorepo。`packages/core` 是零依賴的純 TypeScript（不用 `URL`/`URLSearchParams`，網路透過注入的 `fetch`），拆成 query / extract / unwrap / expand / clean / analyze / process 七個小模組。`rules/` 存放我們的資料檔與建置腳本，建置時下載 ClearURLs、合併、驗證、輸出 `rules.json` + `rules.meta.json`，離線回歸測試用錄好的跳轉結果。App（Plan 2）之後直接 import `@linkclean/core` 與 `rules.json`。

**Tech Stack:** Node 24、pnpm 10、TypeScript 5、Vitest、tsx、GitHub Actions + GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-10-06-link-cleaner-design.md`

**範圍：** 本計畫涵蓋 spec 的 §4（core）、§5（規則包與 CI）、§7 中 core 與規則的測試。§6（App 畫面、歷史、多語系 UI、規則下載快取）與 §9（上架）由 Plan 2 處理。

## Global Constraints

- `packages/core` 不可依賴任何 npm 套件、Node API（`fs`、`crypto`、`Buffer`）或 RN API；只能使用 ES2022 + `AbortController` + `setTimeout`
- `packages/core` 不使用 `URL` / `URLSearchParams`；query 一律手動切，保留的參數原樣（raw）輸出
- 所有正規表示式一律透過 `compile()`（Task 2）建立；無效的 regex 回傳 `null` 並略過，不可 throw
- 展開只對 `expanders` 內的網域連網；固定 UA，預設值 `LinkClean/0.1`；不可使用瀏覽器 UA
- 展開總逾時預設 5000 ms
- 失敗原因列舉值：`'expand_disabled' | 'expand_timeout' | 'unresolved' | 'network' | 'invalid_input'`
- 展開失敗時不可把 `share-id` 列入 `removed`（網址裡其實還在）
- 沒有刪除任何東西時，`cleanUrl` 必須與輸入**逐字相同**（不可改動空參數、編碼、標點）
- 任何「網址可能仍帶追蹤資訊」的情況（包裝層數超過上限、展開次數超過上限、登入牆解析失敗）都必須回報 `partial / unresolved`，不可回報 `clean`
- 語系：`zh-TW` / `en` / `ja`；`zh*` → `zh-TW`、`ja*` → `ja`、其他 → `en`；說明 fallback：目前語系 → `en` → 無
- ClearURLs 來源：`https://gitlab.com/ClearURLs/rules/-/raw/master/data.min.json`（LGPL-3.0，需標示）
- `rules/regression.json` 與 `rules/fixtures/` 會放進公開 repo：**不可放入真實個人分享連結**，fixtures 一律用假 ID
- 程式碼註解用英文；使用者可見文字（knowledge 說明）用 zh-TW / en / ja
- 每個 commit 訊息結尾加：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **分享文字裡網址後面緊接全形標點或中文**（`連結：https://x.com/a?x=1。謝謝`）→ 只取出網址本身。測試在 Task 2。
2. **保留下來的參數必須維持原本的編碼**（`q=%E4%B8%AD`、`x=a+b` 不可被改寫；沒刪東西時逐字回傳；沒刪 query 參數時連 `&&` 也保留）→ 測試在 Task 1 與 Task 3。
3. **不合法的 percent-encoding**（`%E0%A4%A`）不可讓程式 throw → 測試在 Task 1。
4. **遠端規則包含無效 regex**（ClearURLs 或我們的資料出錯）→ 略過該條規則，其他規則照常運作 → 測試在 Task 2 與 Task 3。
5. **大寫的 scheme / 網域**（`HTTPS://WWW.Threads.com/share/x`）→ 仍要比對到 expander 與 provider → 測試在 Task 1 與 Task 5。

---

## File Structure

```
trackurlapp/
├── package.json                 # workspace root: scripts only
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── NOTICE.md                    # ClearURLs LGPL-3.0 attribution
├── packages/core/
│   ├── package.json             # @linkclean/core
│   ├── tsconfig.json
│   ├── src/
│   │   ├── types.ts             # all shared types
│   │   ├── query.ts             # split/join URL, decode, host/path helpers
│   │   ├── regex.ts             # safe cached RegExp compile
│   │   ├── extract.ts           # pull first URL out of shared text
│   │   ├── providers.ts         # select providers active for a URL
│   │   ├── clean.ts             # remove params via providers
│   │   ├── unwrap.ts            # follow provider redirections offline
│   │   ├── expand.ts            # network expansion via injected fetch
│   │   ├── analyze.ts           # knowledge lookup + locale
│   │   ├── process.ts           # pipeline: processUrl()
│   │   └── index.ts             # public exports
│   └── test/                    # one *.test.ts per module
├── rules/
│   ├── package.json             # @linkclean/rules
│   ├── tsconfig.json
│   ├── overrides.json           # extra ClearURLs-format providers/rules
│   ├── expanders.json
│   ├── knowledge.json
│   ├── regression.json          # live cases (public-safe links only)
│   ├── fixtures/cases.json      # offline regression cases (fake IDs)
│   ├── src/
│   │   ├── merge.ts             # mergeProviders()
│   │   ├── bundle.ts            # buildBundle, validateOwnData, sha256, ...
│   │   ├── build.ts             # CLI: download → merge → write dist/
│   │   ├── node.ts              # Node fetch adapter + rules loader
│   │   ├── cli.ts               # CLI: clean one link with dist/rules.json
│   │   └── live.ts              # CLI: run regression.json against network
│   └── test/
│       ├── unit/                # merge/bundle/data tests
│       └── regression/          # offline cases against dist/rules.json
└── .github/workflows/rules.yml
```

---

### Task 1: Workspace scaffold + query helpers

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/query.ts`
- Test: `packages/core/test/query.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `safeDecode(s: string, plusAsSpace?: boolean): string`
  - `interface QueryPair { raw: string; key: string; value: string }`
  - `interface SplitUrl { base: string; pairs: QueryPair[]; hash: string }`（`pairs` 會保留空的元件，例如 `&&` 之間的 `raw: ''`）
  - `splitUrl(url: string): SplitUrl`
  - `joinUrl(parts: SplitUrl): string`
  - `getParam(url: string, name: string): string | undefined`
  - `getHost(url: string): string`（小寫，不含 port / userinfo）
  - `getPath(url: string): string`（無路徑時回傳 `/`；非 http(s) 形式回傳 `''`）

- [ ] **Step 1: 建立 workspace 設定檔**

`package.json`:
```json
{
  "name": "linkclean",
  "private": true,
  "packageManager": "pnpm@10.29.3",
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "build:rules": "pnpm --filter @linkclean/rules build",
    "test:regression": "pnpm --filter @linkclean/rules test:regression",
    "test:live": "pnpm --filter @linkclean/rules test:live",
    "clean-url": "pnpm --filter @linkclean/rules clean-url"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - rules
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`.gitignore`:
```
node_modules/
rules/dist/
site/
*.log
.DS_Store
```

`packages/core/package.json`:
```json
{
  "name": "@linkclean/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p ."
  }
}
```

`packages/core/tsconfig.json`（`DOM` lib 只為了 `AbortController` / `setTimeout` 的型別）:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM"] },
  "include": ["src", "test"]
}
```

Run:
```bash
cd trackurlapp
pnpm --filter @linkclean/core add -D vitest typescript
```
Expected: 安裝成功，產生 `pnpm-lock.yaml`。

- [ ] **Step 2: 寫失敗測試**

`packages/core/test/query.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { splitUrl, joinUrl, getParam, getHost, getPath, safeDecode } from '../src/query';

describe('splitUrl / joinUrl', () => {
  it('round-trips a URL byte-for-byte', () => {
    const u = 'https://ex.com/a/b?q=%E4%B8%AD&x=a+b&flag#frag?x=1';
    expect(joinUrl(splitUrl(u))).toBe(u);
  });

  it('keeps empty query components so untouched URLs round-trip', () => {
    const u = 'https://ex.com/?q=a&&x=1';
    expect(joinUrl(splitUrl(u))).toBe(u);
  });

  it('decodes keys and values for matching only', () => {
    const s = splitUrl('https://ex.com/?q=%E4%B8%AD&x=a+b&flag');
    expect(s.pairs.map((p) => [p.key, p.value])).toEqual([
      ['q', '中'],
      ['x', 'a b'],
      ['flag', ''],
    ]);
    expect(s.pairs.map((p) => p.raw)).toEqual(['q=%E4%B8%AD', 'x=a+b', 'flag']);
  });

  it('drops the "?" when no pairs remain and keeps the hash', () => {
    const s = splitUrl('https://ex.com/p?utm_source=x#top');
    expect(joinUrl({ ...s, pairs: [] })).toBe('https://ex.com/p#top');
  });

  it('handles URLs without query', () => {
    const s = splitUrl('https://ex.com/p#h');
    expect(s).toEqual({ base: 'https://ex.com/p', pairs: [], hash: '#h' });
  });

  it('does not throw on malformed percent-encoding', () => {
    const u = 'https://ex.com/?bad=%E0%A4%A&ok=1';
    const s = splitUrl(u);
    expect(s.pairs[0]!.value).toBe('%E0%A4%A');
    expect(joinUrl(s)).toBe(u);
  });
});

describe('getParam', () => {
  it('returns the decoded value of the first match', () => {
    expect(getParam('https://m.facebook.com/login.php?next=https%3A%2F%2Fex.com%2Fa%3Fb%3D1&x=2', 'next'))
      .toBe('https://ex.com/a?b=1');
  });
  it('returns undefined when missing', () => {
    expect(getParam('https://ex.com/?a=1', 'next')).toBeUndefined();
  });
});

describe('getHost / getPath', () => {
  it('lowercases host and ignores scheme case', () => {
    expect(getHost('HTTPS://WWW.Threads.com/share/x')).toBe('www.threads.com');
  });
  it('strips userinfo and port', () => {
    expect(getHost('https://user:pw@ex.com:8080/a')).toBe('ex.com');
  });
  it('returns empty host for non-URLs and host-less authorities', () => {
    expect(getHost('not a url')).toBe('');
    expect(getHost('https://@/')).toBe('');
  });
  it('returns path without query or hash', () => {
    expect(getPath('https://ex.com/a/b?x=1#y')).toBe('/a/b');
    expect(getPath('https://ex.com')).toBe('/');
    expect(getPath('https://ex.com?x=1')).toBe('/');
  });
});

describe('safeDecode', () => {
  it('keeps "+" unless asked to treat it as space', () => {
    expect(safeDecode('a+b')).toBe('a+b');
    expect(safeDecode('a+b', true)).toBe('a b');
  });
  it('returns input unchanged when decoding fails', () => {
    expect(safeDecode('%E0%A4%A')).toBe('%E0%A4%A');
  });
});
```

- [ ] **Step 3: 確認測試失敗**

Run: `pnpm --filter @linkclean/core test`
Expected: FAIL，`Failed to resolve import "../src/query"`

- [ ] **Step 4: 實作**

`packages/core/src/query.ts`:
```ts
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
```

- [ ] **Step 5: 確認測試通過**

Run: `pnpm --filter @linkclean/core test && pnpm --filter @linkclean/core typecheck`
Expected: 全部 PASS，typecheck 無錯誤

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .gitignore packages/core
git commit -m "feat(core): scaffold workspace and add query helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Types, safe regex, URL extraction

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/regex.ts`, `packages/core/src/extract.ts`
- Test: `packages/core/test/regex.test.ts`, `packages/core/test/extract.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `types.ts` 內所有型別（見 Step 1，後續 task 依此命名）
  - `compile(src: string, flags?: string): RegExp | null`（預設 flags `'i'`，有快取）
  - `matches(src: string, s: string): boolean`（無效 regex → `false`）
  - `extractUrl(text: string): string | null`（沒有網域的網址回傳 `null`；整段輸入就是網址時原樣回傳，只有夾在文字中時才修剪尾端標點）

- [ ] **Step 1: 寫型別檔（純型別，無需測試）**

`packages/core/src/types.ts`:
```ts
// ClearURLs provider format (subset we use), merged with our overrides.
export interface Provider {
  urlPattern: string;
  completeProvider?: boolean;
  rules?: string[];
  rawRules?: string[];
  referralMarketing?: string[];
  exceptions?: string[];
  redirections?: string[];
  forceRedirection?: boolean;
}

export interface Expander {
  match: string; // regex on the full URL
  loginWall?: { match: string; param: string }; // match: regex on the full URL of the login page
  normalizeHost?: Record<string, string>;
  shareId?: string; // regex on the path, capture group 1 = share ID
}

export type Locale = 'zh-TW' | 'en' | 'ja';
export type Category = 'sharer_id' | 'ad_click' | 'affiliate' | 'campaign' | 'session' | 'unknown';
export type Risk = 'high' | 'medium' | 'low';

export interface KnowledgeEntry {
  owner?: string;
  category: Category;
  risk: Risk;
  desc: Partial<Record<Locale, string>>;
}

export interface RuleBundle {
  schemaVersion: 1;
  version: string;
  providers: Record<string, Provider>;
  expanders: Record<string, Expander>;
  knowledge: Record<string, KnowledgeEntry>;
}

// A param or path segment removed from a URL, before analysis.
export interface RemovedItem {
  key: string; // param name, or "share-id" for path-based IDs
  value: string;
  host: string; // host of the URL it was removed from
}

export interface AnalyzedParam {
  key: string;
  value: string;
  owner?: string;
  category: Category;
  risk: Risk;
  desc?: string;
}

export type Status = 'clean' | 'partial' | 'failed';
export type ExpandFailure = 'expand_timeout' | 'unresolved' | 'network';
export type Reason = 'expand_disabled' | ExpandFailure | 'invalid_input';

export interface ProcessResult {
  originalUrl: string;
  cleanUrl: string;
  status: Status;
  reason?: Reason;
  removed: AnalyzedParam[];
  hops: string[];
}

export interface FetchInit {
  method: 'HEAD' | 'GET';
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface FetchResponse {
  url: string;
  status: number;
}

export type FetchFn = (url: string, init: FetchInit) => Promise<FetchResponse>;
```

- [ ] **Step 2: 寫失敗測試**

`packages/core/test/regex.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { compile, matches } from '../src/regex';

describe('compile', () => {
  it('compiles case-insensitive by default', () => {
    expect(compile('abc')!.test('ABC')).toBe(true);
  });
  it('returns null for invalid patterns instead of throwing', () => {
    expect(compile('(unclosed')).toBeNull();
  });
  it('caches by pattern and flags', () => {
    expect(compile('x')).toBe(compile('x'));
    expect(compile('x', 'gi')).not.toBe(compile('x'));
  });
});

describe('matches', () => {
  it('is false for invalid patterns', () => {
    expect(matches('[', 'anything')).toBe(false);
  });
  it('tests against the string', () => {
    expect(matches('^https://ex\\.com', 'HTTPS://EX.COM/a')).toBe(true);
  });
});
```

`packages/core/test/extract.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractUrl } from '../src/extract';

describe('extractUrl', () => {
  it('returns a bare URL', () => {
    expect(extractUrl('https://ex.com/a?x=1')).toBe('https://ex.com/a?x=1');
  });
  it('finds a URL inside shared text with a title', () => {
    expect(extractUrl('看看這篇 https://www.threads.com/share/BAAtest0001/ 很好笑'))
      .toBe('https://www.threads.com/share/BAAtest0001/');
  });
  it('stops at full-width punctuation and CJK text', () => {
    expect(extractUrl('連結：https://ex.com/a?x=1。謝謝')).toBe('https://ex.com/a?x=1');
    expect(extractUrl('https://ex.com/a好文')).toBe('https://ex.com/a');
  });
  it('strips trailing ASCII punctuation', () => {
    expect(extractUrl('see https://ex.com/a.')).toBe('https://ex.com/a');
    expect(extractUrl('https://ex.com/a, and more')).toBe('https://ex.com/a');
  });
  it('strips an unbalanced closing paren but keeps balanced ones', () => {
    expect(extractUrl('(https://ex.com/a)')).toBe('https://ex.com/a');
    expect(extractUrl('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  });
  it('returns the first URL when there are several', () => {
    expect(extractUrl('https://a.com/1 https://b.com/2')).toBe('https://a.com/1');
  });
  it('accepts uppercase scheme', () => {
    expect(extractUrl('HTTPS://EX.COM/a')).toBe('HTTPS://EX.COM/a');
  });
  it('keeps a bare URL verbatim, including trailing punctuation', () => {
    expect(extractUrl('https://ex.com/?token=abc*')).toBe('https://ex.com/?token=abc*');
    expect(extractUrl('  https://ex.com/a.  ')).toBe('https://ex.com/a.');
  });
  it('rejects URLs without a host', () => {
    expect(extractUrl('https://?utm_source=x')).toBeNull();
    expect(extractUrl('https://@/')).toBeNull();
  });
  it('returns null when there is no http(s) URL', () => {
    expect(extractUrl('no link here')).toBeNull();
    expect(extractUrl('ftp://ex.com/file')).toBeNull();
    expect(extractUrl('')).toBeNull();
  });
});
```

- [ ] **Step 3: 確認測試失敗**

Run: `pnpm --filter @linkclean/core test`
Expected: regex 與 extract 兩個測試檔 FAIL（找不到模組），query 測試仍 PASS

- [ ] **Step 4: 實作**

`packages/core/src/regex.ts`:
```ts
const cache = new Map<string, RegExp | null>();

// Rules come from remote data; a bad pattern must never crash the app.
export function compile(src: string, flags = 'i'): RegExp | null {
  const key = `${flags}\u0000${src}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let re: RegExp | null;
  try {
    re = new RegExp(src, flags);
  } catch {
    re = null;
  }
  cache.set(key, re);
  return re;
}

export function matches(src: string, s: string): boolean {
  return compile(src)?.test(s) ?? false;
}
```

`packages/core/src/extract.ts`:
```ts
import { getHost } from './query';

// Printable ASCII except space, '"', '<', '>' (shared links are percent-encoded).
const URL_RE = /https?:\/\/[!#-;=?-~]+/i;
const TRAILING = /[.,;:!?'*]+$/;

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

export function extractUrl(text: string): string | null {
  const m = URL_RE.exec(text);
  if (!m || !getHost(m[0])) return null;
  // A bare URL is taken verbatim; trailing punctuation is only trimmed when the URL sits in prose.
  if (text.trim() === m[0]) return m[0];
  let url = m[0];
  for (;;) {
    const trimmed = url.replace(TRAILING, '');
    if (trimmed.endsWith(')') && count(trimmed, '(') < count(trimmed, ')')) {
      url = trimmed.slice(0, -1);
      continue;
    }
    return trimmed;
  }
}
```

- [ ] **Step 5: 確認測試通過**

Run: `pnpm --filter @linkclean/core test && pnpm --filter @linkclean/core typecheck`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): add types, safe regex compile and URL extraction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Provider selection + parameter cleaning

**Files:**
- Create: `packages/core/src/providers.ts`, `packages/core/src/clean.ts`
- Test: `packages/core/test/clean.test.ts`

**Interfaces:**
- Consumes: `Provider`, `RemovedItem`（types）；`compile`, `matches`（regex）；`splitUrl`, `joinUrl`, `getHost`（query）
- Produces:
  - `activeProviders(url: string, providers: Record<string, Provider>): Provider[]`
  - `interface CleanResult { url: string; removed: RemovedItem[] }`
  - `cleanUrl(url: string, providers: Record<string, Provider>): CleanResult`

規則語意（與 ClearURLs 一致）：`rawRules` 刪掉的片段以 `key: 'raw'` 列入 `removed`；沒有刪除任何東西時回傳原字串。provider 的 `urlPattern` 命中、且沒有任何 `exceptions` 命中，才會生效。`rules` 與 `referralMarketing` 都是**參數名稱**的 regex，必須完整比對（`^(?:rule)$`，不分大小寫）；`rawRules` 對整個網址做 regex 取代為空字串。`completeProvider` / `forceRedirection` 不處理。

- [ ] **Step 1: 寫失敗測試**

`packages/core/test/clean.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cleanUrl, activeProviders } from '../src/clean';
import type { Provider } from '../src/types';

const providers: Record<string, Provider> = {
  globalRules: { urlPattern: '.*', rules: ['(?:%3F)?utm(?:_[a-z_]*)?', 'fbclid', 'gclid'] },
  spotify: { urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?spotify\\.com', rules: ['si'] },
  amazon: { urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?amazon\\.com', rules: ['qid'], referralMarketing: ['tag'] },
  google: {
    urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google\\.com',
    rules: ['ved'],
    exceptions: ['^https?:\\/\\/accounts\\.google\\.com'],
  },
  raw: { urlPattern: '^https?:\\/\\/raw\\.example', rawRules: ['\\/ref=[^/?]*'] },
  broken: { urlPattern: '.*', rules: ['(unclosed'] },
  brokenPattern: { urlPattern: '(unclosed', rules: ['id'] },
};

describe('activeProviders', () => {
  it('skips providers whose exceptions match', () => {
    const names = activeProviders('https://accounts.google.com/x', providers).map((p) => p.urlPattern);
    expect(names).not.toContain(providers.google!.urlPattern);
  });
  it('skips providers with invalid urlPattern', () => {
    expect(activeProviders('https://ex.com/', providers)).not.toContain(providers.brokenPattern);
  });
});

describe('cleanUrl', () => {
  it('removes global tracking params and keeps others byte-for-byte', () => {
    const r = cleanUrl('https://ex.com/p?id=%E4%B8%AD&utm_source=fb&x=a+b&fbclid=IwAR1', providers);
    expect(r.url).toBe('https://ex.com/p?id=%E4%B8%AD&x=a+b');
    expect(r.removed).toEqual([
      { key: 'utm_source', value: 'fb', host: 'ex.com' },
      { key: 'fbclid', value: 'IwAR1', host: 'ex.com' },
    ]);
  });

  it('applies site rules only on matching hosts', () => {
    expect(cleanUrl('https://open.spotify.com/track/1?si=abc', providers).url).toBe('https://open.spotify.com/track/1');
    expect(cleanUrl('https://ex.com/?si=abc', providers).url).toBe('https://ex.com/?si=abc');
  });

  it('removes referralMarketing params', () => {
    expect(cleanUrl('https://www.amazon.com/dp/B0?tag=me-20&th=1', providers).url).toBe('https://www.amazon.com/dp/B0?th=1');
  });

  it('honours exceptions', () => {
    expect(cleanUrl('https://accounts.google.com/x?ved=1', providers).url).toBe('https://accounts.google.com/x?ved=1');
    expect(cleanUrl('https://www.google.com/s?ved=1&q=a', providers).url).toBe('https://www.google.com/s?q=a');
  });

  it('applies rawRules to the whole URL and reports what was removed', () => {
    expect(cleanUrl('https://raw.example/item/ref=abc?x=1', providers)).toEqual({
      url: 'https://raw.example/item?x=1',
      removed: [{ key: 'raw', value: '/ref=abc', host: 'raw.example' }],
    });
  });

  it('returns untouched URLs byte-for-byte', () => {
    expect(cleanUrl('https://ex.com/?q=a&&x=1', providers)).toEqual({ url: 'https://ex.com/?q=a&&x=1', removed: [] });
  });

  it('keeps the query byte-for-byte when only rawRules changed the URL', () => {
    expect(cleanUrl('https://raw.example/item/ref=abc?keep=a&&b=1', providers).url).toBe('https://raw.example/item?keep=a&&b=1');
  });

  it('drops empty query components once a query param was removed', () => {
    expect(cleanUrl('https://ex.com/?q=a&&utm_source=x', providers).url).toBe('https://ex.com/?q=a');
  });

  it('matches keys case-insensitively and after decoding', () => {
    expect(cleanUrl('https://ex.com/?UTM_Source=x&utm%5Fmedium=y&k=1', providers).url).toBe('https://ex.com/?k=1');
  });

  it('requires a full key match', () => {
    expect(cleanUrl('https://ex.com/?fbclidx=1', providers).url).toBe('https://ex.com/?fbclidx=1');
  });

  it('keeps the hash and URLs without query', () => {
    expect(cleanUrl('https://ex.com/p?utm_source=x#top', providers).url).toBe('https://ex.com/p#top');
    expect(cleanUrl('https://ex.com/p', providers)).toEqual({ url: 'https://ex.com/p', removed: [] });
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm --filter @linkclean/core exec vitest run clean`
Expected: FAIL，找不到 `../src/clean`

- [ ] **Step 3: 實作**

`packages/core/src/providers.ts`:
```ts
import type { Provider } from './types';
import { matches } from './regex';

export function activeProviders(url: string, providers: Record<string, Provider>): Provider[] {
  return Object.values(providers).filter(
    (p) => matches(p.urlPattern, url) && !(p.exceptions ?? []).some((e) => matches(e, url)),
  );
}
```

`packages/core/src/clean.ts`:
```ts
import type { Provider, RemovedItem } from './types';
import { compile } from './regex';
import { splitUrl, joinUrl, getHost } from './query';
import { activeProviders } from './providers';

export { activeProviders };

export interface CleanResult {
  url: string;
  removed: RemovedItem[];
}

export function cleanUrl(url: string, providers: Record<string, Provider>): CleanResult {
  const active = activeProviders(url, providers);
  const host = getHost(url);
  const removed: RemovedItem[] = [];

  let out = url;
  for (const p of active) {
    for (const r of p.rawRules ?? []) {
      const re = compile(r, 'gi');
      if (!re) continue;
      for (const hit of out.match(re) ?? []) {
        if (hit) removed.push({ key: 'raw', value: hit, host });
      }
      out = out.replace(re, '');
    }
  }

  const keyRes = active
    .flatMap((p) => [...(p.rules ?? []), ...(p.referralMarketing ?? [])])
    .map((r) => compile(`^(?:${r})$`))
    .filter((re): re is RegExp => re !== null);

  const parts = splitUrl(out);
  const kept = parts.pairs.filter((pair) => {
    if (pair.raw === '') return true;
    const hit = keyRes.some((re) => re.test(pair.key));
    if (hit) removed.push({ key: pair.key, value: pair.value, host });
    return !hit;
  });

  // Nothing removed: hand back the exact input so signed or unusual URLs stay intact.
  if (removed.length === 0) return { url, removed };
  // Only tidy empty components when the query itself was edited.
  const queryChanged = kept.length !== parts.pairs.length;
  return { url: joinUrl({ ...parts, pairs: queryChanged ? kept.filter((pair) => pair.raw !== '') : kept }), removed };
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm --filter @linkclean/core test && pnpm --filter @linkclean/core typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): clean query params using ClearURLs-format providers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Offline unwrapping of redirect wrappers

**Files:**
- Create: `packages/core/src/unwrap.ts`
- Test: `packages/core/test/unwrap.test.ts`

**Interfaces:**
- Consumes: `Provider`；`activeProviders`（providers）；`compile`（regex）；`safeDecode`（query）
- Produces:
  - `interface UnwrapResult { url: string; hops: string[]; complete: boolean }`
  - `unwrapUrl(url: string, providers: Record<string, Provider>): UnwrapResult`

行為：
- 最多拆 3 層；`hops` 依序記錄每一層（第一個元素是輸入）
- 拆到第 3 層後如果還能再拆 → `complete: false`（呼叫端要回報 `unresolved`，不可以當成已清乾淨）
- 擷取到的目標：先看原始擷取字串，可用就原樣使用（保留 `%2F` 等編碼）；不可用才解碼後再判斷。有 `http(s)://` 直接用；**沒有 scheme 但看起來是網域開頭**（ClearURLs 的 Google AMP `/amp/s/example.com/p` 規則就是這樣）→ 補上 `https://`；其他 scheme（`javascript:` 等）一律忽略

- [ ] **Step 1: 寫失敗測試**

`packages/core/test/unwrap.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { unwrapUrl } from '../src/unwrap';
import type { Provider } from '../src/types';

const providers: Record<string, Provider> = {
  facebook: {
    urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?facebook\\.com',
    redirections: ['^https?:\\/\\/l[a-z]?\\.facebook\\.com/l\\.php\\?.*?u=(https?%3A%2F%2F[^&]*)'],
  },
  google: {
    urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google(?:\\.[a-z]{2,}){1,}',
    redirections: [
      '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google(?:\\.[a-z]{2,}){1,}\\/url\\?.*?(?:url|q)=(https?[^&]+)',
      '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google(?:\\.[a-z]{2,}){1,}\\/amp\\/s\\/([^&]+)',
    ],
  },
  loose: { urlPattern: '^https?:\\/\\/loose\\.example', redirections: ['.*u=([^&]*)'] },
  excepted: {
    urlPattern: '^https?:\\/\\/exc\\.example',
    redirections: ['.*u=([^&]*)'],
    exceptions: ['^https?:\\/\\/exc\\.example\\/keep'],
  },
};

const googleWrap = (u: string) => `https://www.google.com/url?q=${encodeURIComponent(u)}`;

describe('unwrapUrl', () => {
  it('unwraps l.facebook.com links', () => {
    expect(unwrapUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fex.com%2Fa%3Fb%3D1&h=AT0x', providers)).toEqual({
      url: 'https://ex.com/a?b=1',
      hops: ['https://l.facebook.com/l.php?u=https%3A%2F%2Fex.com%2Fa%3Fb%3D1&h=AT0x', 'https://ex.com/a?b=1'],
      complete: true,
    });
  });

  it('unwraps google /url?q=', () => {
    expect(unwrapUrl('https://www.google.com/url?sa=t&q=https%3A%2F%2Fex.com%2F&ved=1', providers).url).toBe('https://ex.com/');
  });

  it('adds https:// to scheme-less targets such as Google AMP', () => {
    expect(unwrapUrl('https://www.google.com/amp/s/example.com/p', providers).url).toBe('https://example.com/p');
  });

  it('keeps encoded bytes of targets that are already usable', () => {
    expect(unwrapUrl('https://www.google.com/amp/s/example.com/p%2Fq', providers).url).toBe('https://example.com/p%2Fq');
  });

  it('records every layer of nested wrappers', () => {
    const middle = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fex.com%2Fz';
    const outer = googleWrap(middle);
    expect(unwrapUrl(outer, providers)).toEqual({ url: 'https://ex.com/z', hops: [outer, middle, 'https://ex.com/z'], complete: true });
  });

  it('reports incomplete when nesting exceeds the depth limit', () => {
    let u = 'https://ex.com/z';
    for (let i = 0; i < 4; i++) u = googleWrap(u);
    const r = unwrapUrl(u, providers);
    expect(r.complete).toBe(false);
    expect(r.hops).toHaveLength(4);
  });

  it('ignores non-http targets', () => {
    expect(unwrapUrl('https://loose.example/r?u=javascript%3Aalert(1)', providers).url)
      .toBe('https://loose.example/r?u=javascript%3Aalert(1)');
  });

  it('honours provider exceptions', () => {
    expect(unwrapUrl('https://exc.example/keep?u=https%3A%2F%2Fex.com', providers).url)
      .toBe('https://exc.example/keep?u=https%3A%2F%2Fex.com');
    expect(unwrapUrl('https://exc.example/go?u=https%3A%2F%2Fex.com', providers).url).toBe('https://ex.com');
  });

  it('returns the input when nothing matches', () => {
    expect(unwrapUrl('https://ex.com/a', providers)).toEqual({ url: 'https://ex.com/a', hops: ['https://ex.com/a'], complete: true });
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm --filter @linkclean/core exec vitest run unwrap`
Expected: FAIL，找不到 `../src/unwrap`

- [ ] **Step 3: 實作**

`packages/core/src/unwrap.ts`:
```ts
import type { Provider } from './types';
import { compile } from './regex';
import { safeDecode } from './query';
import { activeProviders } from './providers';

export interface UnwrapResult {
  url: string;
  hops: string[];
  complete: boolean; // false when more wrappers remain after MAX_DEPTH
}

const MAX_DEPTH = 3;
const HTTP = /^https?:\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BARE_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]|$)/i;

function toHttpUrl(captured: string): string | null {
  // Try the raw capture first so already-usable targets keep encoded bytes such as %2F;
  // only percent-encoded wrappers (u=https%3A%2F%2F...) need decoding.
  for (const candidate of [captured, safeDecode(captured)]) {
    if (HTTP.test(candidate)) return candidate;
    // ClearURLs captures may omit the scheme (e.g. Google AMP /amp/s/example.com/p).
    if (!SCHEME.test(candidate) && BARE_HOST.test(candidate)) return `https://${candidate}`;
  }
  return null;
}

function unwrapOnce(url: string, providers: Record<string, Provider>): string | null {
  for (const p of activeProviders(url, providers)) {
    for (const r of p.redirections ?? []) {
      const captured = compile(r)?.exec(url)?.[1];
      const target = captured ? toHttpUrl(captured) : null;
      if (target && target !== url) return target;
    }
  }
  return null;
}

export function unwrapUrl(url: string, providers: Record<string, Provider>): UnwrapResult {
  const hops = [url];
  let cur = url;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const next = unwrapOnce(cur, providers);
    if (!next) return { url: cur, hops, complete: true };
    cur = next;
    hops.push(cur);
  }
  return { url: cur, hops, complete: unwrapOnce(cur, providers) === null };
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm --filter @linkclean/core test && pnpm --filter @linkclean/core typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): unwrap redirect wrappers via provider redirections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Short-link expansion

**Files:**
- Create: `packages/core/src/expand.ts`
- Test: `packages/core/test/expand.test.ts`

**Interfaces:**
- Consumes: `Expander`, `FetchFn`, `RemovedItem`, `ExpandFailure`（types）；`compile`, `matches`（regex）；`getHost`, `getPath`, `getParam`（query）
- Produces:
  - `DEFAULT_USER_AGENT = 'LinkClean/0.1'`
  - `DEFAULT_TIMEOUT_MS = 5000`
  - `findExpander(url: string, expanders: Record<string, Expander>): Expander | undefined`
  - `interface ExpandOptions { fetch: FetchFn; userAgent: string; timeoutMs: number }`
  - `interface ExpandResult { url: string; hops: string[]; removed: RemovedItem[]; reason?: ExpandFailure }`
  - `expandUrl(url: string, expanders: Record<string, Expander>, opts: ExpandOptions): Promise<ExpandResult>`（**單次**展開；接收整份 expanders，因為登入牆與網域正規化可能來自其他 expander，例如 `bit.ly` → FB 登入頁）

行為：
1. 用 `findExpander` 找出 `url` 對應的 expander；找不到就原樣回傳 `{ url, hops: [url], removed: [] }`
2. 送 `HEAD`（header `User-Agent`），由 fetch 自動跟著跳轉；回應 405 時改送 `GET`（已過截止時間就不送）；狀態 ≥ 400 → `network`，`hops` 保留 fetch 回報的最終網址
3. **硬性截止時間**：整個請求與 `timeoutMs` 的計時器賽跑，時間到就 abort 並回報 `expand_timeout`。fetch 不理會 abort 也不會卡住
4. `res.url` 空字串時視為原網址
5. 最終網址符合**任何一個** expander 的 `loginWall.match` → 取 `loginWall.param`；取不到、不是 http(s)、或取出來的網址**仍是登入頁** → `unresolved`
6. 解析後的網址不是 http(s)，或**跟原網址相同**（沒有跳轉）→ `unresolved`。跳到**另一個**短網址 / 分享連結（例如 `bit.ly` → `t.co`、`fb.me` → FB `/share/`）算成功，交給 Task 7 的迴圈繼續展開
7. 套用任何 expander 的 `normalizeHost`
8. 成功時才把 `shareId` 擷取到的 ID 放進 `removed`
9. 失敗時回傳原網址、`removed: []`；`hops` 保留失敗前已走過的網址（連線失敗 / 逾時只有 `[url]`），方便除錯
10. `hops`：`[原網址, fetch 最終網址]`，登入牆解析或網域正規化產生不同網址時依序加入

- [ ] **Step 1: 寫失敗測試**

`packages/core/test/expand.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { expandUrl, findExpander, DEFAULT_USER_AGENT } from '../src/expand';
import type { Expander, FetchFn } from '../src/types';

const expanders: Record<string, Expander> = {
  facebook: {
    match: '^https://(www|m)\\.facebook\\.com/share/',
    loginWall: { match: '^https://(www|m)\\.facebook\\.com/login', param: 'next' },
    normalizeHost: { 'm.facebook.com': 'www.facebook.com' },
    shareId: '/share/(?:[a-z]/)?([^/?#]+)',
  },
  threads: { match: '^https://www\\.threads\\.(com|net)/share/', shareId: '/share/([^/?#]+)' },
  generic: { match: '^https?://(bit\\.ly|t\\.co)/' },
};

type Reply = { url: string; status?: number } | Error | 'hang' | 'ignore-abort';
interface Call { url: string; method: string; ua: string | undefined }

function fakeFetch(map: Record<string, Reply>, calls: Call[] = []): FetchFn {
  return async (url, init) => {
    calls.push({ url, method: init.method, ua: init.headers['User-Agent'] });
    const r = map[`${init.method} ${url}`] ?? map[url];
    if (r === undefined) throw new Error(`unexpected fetch ${init.method} ${url}`);
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    if (r === 'ignore-abort') return new Promise(() => {});
    if (r instanceof Error) throw r;
    return { url: r.url, status: r.status ?? 200 };
  };
}

const opts = (fetch: FetchFn, timeoutMs = 1000) => ({ fetch, userAgent: DEFAULT_USER_AGENT, timeoutMs });

const THREADS = 'https://www.threads.com/share/BAAtest0001/';
const THREADS_POST = 'https://www.threads.com/@someone/post/DTest00001?xmt=AQGtest&slof=1';
const FB = 'https://www.facebook.com/share/p/TEST01/';
const FB_POST = 'https://www.facebook.com/groups/somegroup/permalink/1234567890/?rdid=abc';
const loginFor = (next: string) => `https://m.facebook.com/login.php?next=${encodeURIComponent(next)}&refsrc=deprecated`;

describe('findExpander', () => {
  it('matches case-insensitively', () => {
    expect(findExpander('HTTPS://WWW.FACEBOOK.COM/share/p/X/', expanders)).toBe(expanders.facebook);
  });
  it('returns undefined for other URLs', () => {
    expect(findExpander('https://ex.com/share/x', expanders)).toBeUndefined();
  });
});

describe('expandUrl', () => {
  it('returns the input untouched when no expander matches', async () => {
    const r = await expandUrl('https://ex.com/a', expanders, opts(fakeFetch({})));
    expect(r).toEqual({ url: 'https://ex.com/a', hops: ['https://ex.com/a'], removed: [] });
  });

  it('resolves a Threads share link with a HEAD request and our UA', async () => {
    const calls: Call[] = [];
    const r = await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: { url: THREADS_POST } }, calls)));
    expect(r).toEqual({
      url: THREADS_POST,
      hops: [THREADS, THREADS_POST],
      removed: [{ key: 'share-id', value: 'BAAtest0001', host: 'www.threads.com' }],
    });
    expect(calls).toEqual([{ url: THREADS, method: 'HEAD', ua: DEFAULT_USER_AGENT }]);
  });

  it('resolves a Facebook share link that redirects straight to the post', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: FB_POST } })));
    expect(r.url).toBe(FB_POST);
    expect(r.reason).toBeUndefined();
    expect(r.removed).toEqual([{ key: 'share-id', value: 'TEST01', host: 'www.facebook.com' }]);
  });

  it('reads the post URL out of a login wall and normalizes the host', async () => {
    const mPost = 'https://m.facebook.com/groups/somegroup/permalink/1234567890/?rdid=xyz';
    const login = loginFor(mPost);
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: login } })));
    expect(r.url).toBe('https://www.facebook.com/groups/somegroup/permalink/1234567890/?rdid=xyz');
    expect(r.hops).toEqual([FB, login, mPost, r.url]);
    expect(r.reason).toBeUndefined();
  });

  it('handles a login wall reached through a generic short link', async () => {
    const login = loginFor('https://m.facebook.com/groups/g/permalink/1/');
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: login } })));
    expect(r).toMatchObject({ url: 'https://www.facebook.com/groups/g/permalink/1/', removed: [] });
    expect(r.reason).toBeUndefined();
  });

  it('is unresolved when the login wall has no usable next param', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: 'https://m.facebook.com/login.php' } })));
    expect(r).toEqual({ url: FB, hops: [FB, 'https://m.facebook.com/login.php'], removed: [], reason: 'unresolved' });
  });

  it('is unresolved when next points to another login page', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: loginFor('https://m.facebook.com/login.php') } })));
    expect(r.reason).toBe('unresolved');
    expect(r.removed).toEqual([]);
  });

  it('hands a different short link back to the caller instead of failing', async () => {
    const r = await expandUrl('https://bit.ly/a', expanders, opts(fakeFetch({ 'https://bit.ly/a': { url: 'https://t.co/b' } })));
    expect(r).toEqual({ url: 'https://t.co/b', hops: ['https://bit.ly/a', 'https://t.co/b'], removed: [] });
  });

  it('keeps the redirect target on HTTP errors', async () => {
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: 'https://ex.com/gone', status: 404 } })));
    expect(r).toEqual({ url: 'https://bit.ly/x', hops: ['https://bit.ly/x', 'https://ex.com/gone'], removed: [], reason: 'network' });
  });

  it('does not send GET after the deadline when a late HEAD returns 405', async () => {
    const calls: Call[] = [];
    const lateHead: FetchFn = async (url, init) => {
      calls.push({ url, method: init.method, ua: init.headers['User-Agent'] });
      if (init.method === 'GET') return { url: 'https://ex.com/a', status: 200 };
      await new Promise((r) => setTimeout(r, 40));
      return { url, status: 405 };
    };
    const r = await expandUrl('https://bit.ly/x', expanders, opts(lateHead, 10));
    expect(r.reason).toBe('expand_timeout');
    await new Promise((r) => setTimeout(r, 60));
    expect(calls.map((c) => c.method)).toEqual(['HEAD']);
  });

  it('is unresolved when the final URL is still the same share link', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: FB } })));
    expect(r.reason).toBe('unresolved');
    expect(r.removed).toEqual([]);
  });

  it('is unresolved when fetch reports an empty final URL', async () => {
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: '' } })));
    expect(r.reason).toBe('unresolved');
  });

  it('retries with GET when HEAD returns 405', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      { 'HEAD https://bit.ly/x': { url: 'https://bit.ly/x', status: 405 }, 'GET https://bit.ly/x': { url: 'https://ex.com/a' } },
      calls,
    );
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fetch));
    expect(r.url).toBe('https://ex.com/a');
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  it('reports network on HTTP error status', async () => {
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: 'https://bit.ly/x', status: 404 } })));
    expect(r).toEqual({ url: 'https://bit.ly/x', hops: ['https://bit.ly/x'], removed: [], reason: 'network' });
  });

  it('reports network when fetch throws', async () => {
    const r = await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: new Error('offline') })));
    expect(r).toEqual({ url: THREADS, hops: [THREADS], removed: [], reason: 'network' });
  });

  it('reports expand_timeout when the request exceeds the timeout', async () => {
    const r = await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: 'hang' }), 20));
    expect(r).toEqual({ url: THREADS, hops: [THREADS], removed: [], reason: 'expand_timeout' });
  });

  it('times out even when fetch ignores the abort signal', async () => {
    const r = await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: 'ignore-abort' }), 20));
    expect(r.reason).toBe('expand_timeout');
  });

  it('is unresolved when redirected to a non-http URL', async () => {
    const r = await expandUrl('https://t.co/x', expanders, opts(fakeFetch({ 'https://t.co/x': { url: 'intent://x' } })));
    expect(r.reason).toBe('unresolved');
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm --filter @linkclean/core exec vitest run expand`
Expected: FAIL，找不到 `../src/expand`

- [ ] **Step 3: 實作**

`packages/core/src/expand.ts`:
```ts
import type { Expander, ExpandFailure, FetchFn, RemovedItem } from './types';
import { compile, matches } from './regex';
import { getHost, getPath, getParam } from './query';

export const DEFAULT_USER_AGENT = 'LinkClean/0.1';
export const DEFAULT_TIMEOUT_MS = 5000;

const HTTP = /^https?:\/\//i;
const AUTHORITY_PREFIX = /^([a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?)[^/?#:]+/i;

export interface ExpandOptions {
  fetch: FetchFn;
  userAgent: string;
  timeoutMs: number;
}

export interface ExpandResult {
  url: string;
  hops: string[];
  removed: RemovedItem[];
  reason?: ExpandFailure;
}

class TimeoutError extends Error {}

class HttpError extends Error {
  constructor(readonly finalUrl: string) {
    super('HTTP error');
  }
}

export function findExpander(url: string, expanders: Record<string, Expander>): Expander | undefined {
  return Object.values(expanders).find((e) => matches(e.match, url));
}

function findLoginWall(url: string, expanders: Record<string, Expander>): Expander['loginWall'] {
  return Object.values(expanders).find((e) => e.loginWall && matches(e.loginWall.match, url))?.loginWall;
}

function normalizeHost(url: string, expanders: Record<string, Expander>): string {
  const host = getHost(url);
  for (const e of Object.values(expanders)) {
    const to = e.normalizeHost?.[host];
    if (to) return url.replace(AUTHORITY_PREFIX, `$1${to}`);
  }
  return url;
}

// Race the request against a hard deadline so a fetch that ignores abort cannot hang the caller.
async function resolve(url: string, opts: ExpandOptions): Promise<string> {
  const controller = new AbortController();
  const headers = { 'User-Agent': opts.userAgent };
  const work = (async () => {
    try {
      let res = await opts.fetch(url, { method: 'HEAD', headers, signal: controller.signal });
      if (res.status === 405) {
        // Never start a follow-up request after the deadline has passed.
        if (controller.signal.aborted) throw new TimeoutError();
        res = await opts.fetch(url, { method: 'GET', headers, signal: controller.signal });
      }
      if (res.status >= 400) throw new HttpError(res.url || url);
      return res.url || url;
    } catch (e) {
      throw controller.signal.aborted ? new TimeoutError() : e;
    }
  })();
  work.catch(() => {}); // a rejection after the deadline must not surface as unhandled

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

export async function expandUrl(url: string, expanders: Record<string, Expander>, opts: ExpandOptions): Promise<ExpandResult> {
  const expander = findExpander(url, expanders);
  if (!expander) return { url, hops: [url], removed: [] };
  const fail = (reason: ExpandFailure, hops: string[] = [url]): ExpandResult => ({ url, hops, removed: [], reason });

  let finalUrl: string;
  try {
    finalUrl = await resolve(url, opts);
  } catch (e) {
    if (e instanceof HttpError) return fail('network', e.finalUrl === url ? [url] : [url, e.finalUrl]);
    return fail(e instanceof TimeoutError ? 'expand_timeout' : 'network');
  }

  const hops = [url, finalUrl];
  let resolved = finalUrl;
  const wall = findLoginWall(finalUrl, expanders);
  if (wall) {
    const next = getParam(finalUrl, wall.param);
    if (!next || !HTTP.test(next) || findLoginWall(next, expanders)) return fail('unresolved', hops);
    resolved = next;
    hops.push(resolved);
  }
  // A different URL that is again a short/share link is handed back to processUrl's loop.
  if (!HTTP.test(resolved) || resolved === url) return fail('unresolved', hops);

  const normalized = normalizeHost(resolved, expanders);
  if (normalized !== resolved) hops.push(normalized);

  const removed: RemovedItem[] = [];
  const id = expander.shareId ? compile(expander.shareId)?.exec(getPath(url))?.[1] : undefined;
  if (id) removed.push({ key: 'share-id', value: id, host: getHost(url) });

  return { url: normalized, hops, removed };
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm --filter @linkclean/core test && pnpm --filter @linkclean/core typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): expand allow-listed short links via injected fetch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Knowledge lookup and analysis

**Files:**
- Create: `packages/core/src/analyze.ts`
- Test: `packages/core/test/analyze.test.ts`

**Interfaces:**
- Consumes: `KnowledgeEntry`, `RemovedItem`, `AnalyzedParam`, `Locale`, `Risk`（types）
- Produces:
  - `resolveLocale(tag: string): Locale`
  - `lookupKnowledge(item: RemovedItem, kb: Record<string, KnowledgeEntry>): KnowledgeEntry | undefined`
  - `analyze(removed: RemovedItem[], kb: Record<string, KnowledgeEntry>, localeTag: string): AnalyzedParam[]`（依風險高→低排序，同等級維持原順序）

知識庫 key 規則（全部小寫）：
1. `<host 後綴>:<參數>`，從完整 host 往上逐層找，至少保留兩段（`www.threads.com:xmt` → `threads.com:xmt`）
2. `<參數>` 精確比對
3. 以 `*` 結尾的萬用字元（如 `utm_*`），取最長前綴；萬用字元 key 不可含 `:`

- [ ] **Step 1: 寫失敗測試**

`packages/core/test/analyze.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { analyze, lookupKnowledge, resolveLocale } from '../src/analyze';
import type { KnowledgeEntry } from '../src/types';

const kb: Record<string, KnowledgeEntry> = {
  'utm_*': { category: 'campaign', risk: 'low', desc: { en: 'campaign', 'zh-TW': '活動' } },
  'utm_source*': { category: 'campaign', risk: 'low', desc: { en: 'source' } },
  fbclid: { owner: 'Meta', category: 'ad_click', risk: 'medium', desc: { en: 'fb click', ja: 'FBクリック' } },
  si: { category: 'session', risk: 'low', desc: { en: 'generic si' } },
  'spotify.com:si': { owner: 'Spotify', category: 'sharer_id', risk: 'high', desc: { en: 'spotify share' } },
  'threads.com:xmt': { owner: 'Meta', category: 'sharer_id', risk: 'high', desc: {} },
};

describe('resolveLocale', () => {
  it.each([
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-CN', 'zh-TW'],
    ['ja-JP', 'ja'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
    ['', 'en'],
  ])('%s → %s', (tag, expected) => {
    expect(resolveLocale(tag)).toBe(expected);
  });
});

describe('lookupKnowledge', () => {
  it('prefers host-specific entries, walking up host suffixes', () => {
    expect(lookupKnowledge({ key: 'si', value: 'x', host: 'open.spotify.com' }, kb)).toBe(kb['spotify.com:si']);
    expect(lookupKnowledge({ key: 'xmt', value: 'x', host: 'www.threads.com' }, kb)).toBe(kb['threads.com:xmt']);
  });
  it('falls back to the plain key', () => {
    expect(lookupKnowledge({ key: 'si', value: 'x', host: 'ex.com' }, kb)).toBe(kb.si);
  });
  it('matches wildcards, longest prefix first, case-insensitively', () => {
    expect(lookupKnowledge({ key: 'utm_medium', value: 'x', host: 'ex.com' }, kb)).toBe(kb['utm_*']);
    expect(lookupKnowledge({ key: 'UTM_Source', value: 'x', host: 'ex.com' }, kb)).toBe(kb['utm_source*']);
  });
  it('returns undefined for unknown keys', () => {
    expect(lookupKnowledge({ key: 'zzz', value: 'x', host: 'ex.com' }, kb)).toBeUndefined();
  });
  it('ignores inherited Object.prototype keys', () => {
    expect(lookupKnowledge({ key: 'constructor', value: 'x', host: 'ex.com' }, kb)).toBeUndefined();
    expect(lookupKnowledge({ key: '__proto__', value: 'x', host: 'ex.com' }, kb)).toBeUndefined();
  });
});

describe('analyze', () => {
  it('resolves desc by locale with en fallback', () => {
    const [ja] = analyze([{ key: 'fbclid', value: 'a', host: 'ex.com' }], kb, 'ja-JP');
    expect(ja).toEqual({ key: 'fbclid', value: 'a', owner: 'Meta', category: 'ad_click', risk: 'medium', desc: 'FBクリック' });
    const [zh] = analyze([{ key: 'fbclid', value: 'a', host: 'ex.com' }], kb, 'zh-TW');
    expect(zh!.desc).toBe('fb click');
  });
  it('leaves desc undefined when no translation exists', () => {
    const [r] = analyze([{ key: 'xmt', value: 'a', host: 'www.threads.com' }], kb, 'en');
    expect(r!.desc).toBeUndefined();
  });
  it('marks unknown params as unknown / low', () => {
    expect(analyze([{ key: 'zzz', value: '1', host: 'ex.com' }], kb, 'en')).toEqual([
      { key: 'zzz', value: '1', category: 'unknown', risk: 'low' },
    ]);
  });
  it('does not crash on prototype-named params', () => {
    expect(analyze([{ key: 'constructor', value: '1', host: 'ex.com' }], {}, 'en')).toEqual([
      { key: 'constructor', value: '1', category: 'unknown', risk: 'low' },
    ]);
  });
  it('sorts high risk first and keeps order within a level', () => {
    const r = analyze(
      [
        { key: 'utm_source', value: '1', host: 'ex.com' },
        { key: 'fbclid', value: '2', host: 'ex.com' },
        { key: 'zzz', value: '3', host: 'ex.com' },
        { key: 'si', value: '4', host: 'open.spotify.com' },
      ],
      kb,
      'en',
    );
    expect(r.map((p) => p.key)).toEqual(['si', 'fbclid', 'utm_source', 'zzz']);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm --filter @linkclean/core exec vitest run analyze`
Expected: FAIL，找不到 `../src/analyze`

- [ ] **Step 3: 實作**

`packages/core/src/analyze.ts`:
```ts
import type { AnalyzedParam, KnowledgeEntry, Locale, RemovedItem, Risk } from './types';

const RISK_ORDER: Record<Risk, number> = { high: 0, medium: 1, low: 2 };

export function resolveLocale(tag: string): Locale {
  const t = tag.toLowerCase();
  if (t.startsWith('zh')) return 'zh-TW';
  if (t.startsWith('ja')) return 'ja';
  return 'en';
}

// Keys come from URLs; only own properties count ("constructor", "__proto__" must not hit Object.prototype).
function own(kb: Record<string, KnowledgeEntry>, k: string): KnowledgeEntry | undefined {
  return Object.prototype.hasOwnProperty.call(kb, k) ? kb[k] : undefined;
}

export function lookupKnowledge(item: RemovedItem, kb: Record<string, KnowledgeEntry>): KnowledgeEntry | undefined {
  const key = item.key.toLowerCase();
  const labels = item.host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const hit = own(kb, `${labels.slice(i).join('.')}:${key}`);
    if (hit) return hit;
  }
  const exact = own(kb, key);
  if (exact) return exact;

  let best: { len: number; entry: KnowledgeEntry } | undefined;
  for (const [k, entry] of Object.entries(kb)) {
    if (!k.endsWith('*') || k.includes(':')) continue;
    const prefix = k.slice(0, -1);
    if (key.startsWith(prefix) && (!best || prefix.length > best.len)) best = { len: prefix.length, entry };
  }
  return best?.entry;
}

export function analyze(removed: RemovedItem[], kb: Record<string, KnowledgeEntry>, localeTag: string): AnalyzedParam[] {
  const locale = resolveLocale(localeTag);
  const out = removed.map((item): AnalyzedParam => {
    const e = lookupKnowledge(item, kb);
    if (!e) return { key: item.key, value: item.value, category: 'unknown', risk: 'low' };
    const result: AnalyzedParam = { key: item.key, value: item.value, category: e.category, risk: e.risk };
    if (e.owner) result.owner = e.owner;
    const desc = e.desc[locale] ?? e.desc.en;
    if (desc) result.desc = desc;
    return result;
  });
  // Array.prototype.sort is stable (ES2019+), so order within a level is kept.
  return out.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm --filter @linkclean/core test && pnpm --filter @linkclean/core typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): explain removed params from knowledge base

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: processUrl pipeline + public exports

**Files:**
- Create: `packages/core/src/process.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/process.test.ts`

**Interfaces:**
- Consumes: `extractUrl`、`unwrapUrl` / `UnwrapResult`、`findExpander` / `expandUrl` / `DEFAULT_USER_AGENT` / `DEFAULT_TIMEOUT_MS`、`cleanUrl`、`analyze`，以及 types
- Produces:
  - `interface ProcessOptions { expand: boolean; locale: string; fetch?: FetchFn; userAgent?: string; timeoutMs?: number }`
  - `processUrl(input: string, rules: RuleBundle, opts: ProcessOptions): Promise<ProcessResult>`
  - `index.ts` 匯出：`processUrl`、`ProcessOptions`、`cleanUrl`、`unwrapUrl`、`UnwrapResult`、`expandUrl`、`findExpander`、`analyze`、`resolveLocale`、`extractUrl`、`DEFAULT_USER_AGENT`、`DEFAULT_TIMEOUT_MS`，以及 `types.ts` 的所有型別

流程：extract → unwrap →（只要網址還符合某個 expander）expand → unwrap，**最多展開 3 次，全部共用一個 `timeoutMs` 時間預算** → clean → analyze。
- 沒抓到網址 → `failed / invalid_input`，`cleanUrl: ''`
- unwrap 回報 `complete: false` → `partial / unresolved`
- 網址符合 expander 但 `expand: false` 或沒有傳 `fetch` → 不連網，`partial / expand_disabled`
- 展開失敗 → `partial / <原因>`，仍會清理目前網址上看得到的參數
- 展開 3 次後網址仍符合某個 expander（例如 `fb.me` → FB `/share/` → Threads `/share/` → …）→ `partial / unresolved`
- `hops` 起點是擷取到的網址，每次網址改變就加入（連續相同的網址不重複）

- [ ] **Step 1: 寫失敗測試**

`packages/core/test/process.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { processUrl } from '../src/process';
import type { FetchFn, RuleBundle } from '../src/types';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: {
    globalRules: { urlPattern: '.*', rules: ['(?:%3F)?utm(?:_[a-z_]*)?', 'fbclid'] },
    facebook: {
      urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?facebook\\.com',
      rules: ['rdid', 'share_url'],
      redirections: ['^https?:\\/\\/l[a-z]?\\.facebook\\.com/l\\.php\\?.*?u=(https?%3A%2F%2F[^&]*)'],
    },
    threads: { urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?threads\\.(?:com|net)(?:[/:?#]|$)', rules: ['xmt', 'slof'] },
  },
  expanders: {
    threads: { match: '^https://www\\.threads\\.(com|net)/share/', shareId: '/share/([^/?#]+)' },
    facebook: { match: '^https://(www|m)\\.facebook\\.com/share/', shareId: '/share/(?:[a-z]/)?([^/?#]+)' },
    generic: { match: '^https?://(bit\\.ly|fb\\.me)/' },
  },
  knowledge: {
    'threads.com:share-id': { owner: 'Meta', category: 'sharer_id', risk: 'high', desc: { en: 'share id' } },
    'threads.com:xmt': { owner: 'Meta', category: 'sharer_id', risk: 'high', desc: { en: 'xmt' } },
    'facebook.com:share-id': { owner: 'Meta', category: 'sharer_id', risk: 'high', desc: { en: 'fb share id' } },
    'utm_*': { category: 'campaign', risk: 'low', desc: { en: 'utm' } },
  },
};

const THREADS = 'https://www.threads.com/share/BAAtest0001/';
const THREADS_POST = 'https://www.threads.com/@someone/post/DTest00001?xmt=AQGtest&slof=1';

const noFetch: FetchFn = async (url) => {
  throw new Error(`fetch must not be called: ${url}`);
};
const threadsFetch: FetchFn = async () => ({ url: THREADS_POST, status: 200 });
const mapFetch = (map: Record<string, string>): FetchFn => async (url) => {
  const next = map[url];
  if (next === undefined) throw new Error(`unexpected fetch ${url}`);
  return { url: next, status: 200 };
};

describe('processUrl', () => {
  it('fails on input without a URL', async () => {
    expect(await processUrl('hello', rules, { expand: true, locale: 'en', fetch: noFetch })).toEqual({
      originalUrl: 'hello',
      cleanUrl: '',
      status: 'failed',
      reason: 'invalid_input',
      removed: [],
      hops: [],
    });
  });

  it('cleans a normal link offline', async () => {
    const r = await processUrl('https://ex.com/a?utm_source=x&id=1', rules, { expand: true, locale: 'en', fetch: noFetch });
    expect(r).toMatchObject({ cleanUrl: 'https://ex.com/a?id=1', status: 'clean', hops: ['https://ex.com/a?utm_source=x&id=1'] });
    expect(r.removed.map((p) => p.key)).toEqual(['utm_source']);
  });

  it('unwraps then cleans, recording the hop', async () => {
    const wrapped = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fex.com%2Fa%3Futm_source%3Dfb%26id%3D5&h=AT0';
    const r = await processUrl(wrapped, rules, { expand: true, locale: 'en', fetch: noFetch });
    expect(r.cleanUrl).toBe('https://ex.com/a?id=5');
    expect(r.hops).toEqual([wrapped, 'https://ex.com/a?utm_source=fb&id=5']);
  });

  it('reports unresolved when wrappers nest deeper than the unwrap limit', async () => {
    let u = 'https://ex.com/z';
    for (let i = 0; i < 4; i++) u = `https://l.facebook.com/l.php?u=${encodeURIComponent(u)}`;
    const r = await processUrl(u, rules, { expand: true, locale: 'en', fetch: noFetch });
    expect(r).toMatchObject({ status: 'partial', reason: 'unresolved' });
  });

  it('expands and cleans a Threads share link from shared text', async () => {
    const r = await processUrl(`來看 ${THREADS}`, rules, { expand: true, locale: 'en', fetch: threadsFetch });
    expect(r.originalUrl).toBe(THREADS);
    expect(r.cleanUrl).toBe('https://www.threads.com/@someone/post/DTest00001');
    expect(r.status).toBe('clean');
    expect(r.reason).toBeUndefined();
    expect(r.hops).toEqual([THREADS, THREADS_POST]);
    expect(r.removed.map((p) => [p.key, p.risk])).toEqual([
      ['share-id', 'high'],
      ['xmt', 'high'],
      ['slof', 'low'],
    ]);
  });

  it('follows a generic short link into another expander', async () => {
    const FB_SHARE = 'https://www.facebook.com/share/p/TEST01/';
    const FB_POST = 'https://www.facebook.com/groups/g/permalink/1/?rdid=x';
    const r = await processUrl('https://fb.me/abc', rules, {
      expand: true,
      locale: 'en',
      fetch: mapFetch({ 'https://fb.me/abc': FB_SHARE, [FB_SHARE]: FB_POST }),
    });
    expect(r).toMatchObject({
      cleanUrl: 'https://www.facebook.com/groups/g/permalink/1/',
      status: 'clean',
      hops: ['https://fb.me/abc', FB_SHARE, FB_POST],
    });
    expect(r.removed.map((p) => p.key)).toEqual(['share-id', 'rdid']);
  });

  it('stops after three expansions and reports unresolved', async () => {
    const T1 = 'https://www.threads.com/share/A/';
    const F2 = 'https://www.facebook.com/share/p/B/';
    const T3 = 'https://www.threads.com/share/C/';
    const r = await processUrl('https://fb.me/x', rules, {
      expand: true,
      locale: 'en',
      fetch: mapFetch({ 'https://fb.me/x': T1, [T1]: F2, [F2]: T3 }),
    });
    expect(r).toMatchObject({ status: 'partial', reason: 'unresolved', cleanUrl: T3 });
  });

  it('applies the timeout to the whole expansion chain', async () => {
    const slow = (next: string): FetchFn => async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { url: next, status: 200 };
    };
    const FB_SHARE = 'https://www.facebook.com/share/p/TEST01/';
    const fetch: FetchFn = (url, init) =>
      url === 'https://fb.me/abc' ? slow(FB_SHARE)(url, init) : slow('https://www.facebook.com/groups/g/permalink/1/')(url, init);
    const r = await processUrl('https://fb.me/abc', rules, { expand: true, locale: 'en', fetch, timeoutMs: 50 });
    expect(r).toMatchObject({ status: 'partial', reason: 'expand_timeout' });
  });

  it('does not touch the network when expansion is disabled', async () => {
    const r = await processUrl(THREADS, rules, { expand: false, locale: 'en', fetch: noFetch });
    expect(r).toMatchObject({ cleanUrl: THREADS, status: 'partial', reason: 'expand_disabled', removed: [] });
  });

  it('treats a missing fetch as expansion disabled', async () => {
    const r = await processUrl(THREADS, rules, { expand: true, locale: 'en' });
    expect(r.reason).toBe('expand_disabled');
  });

  it('keeps the hops recorded before an unresolved expansion', async () => {
    const stuck: FetchFn = async () => ({ url: THREADS, status: 200 });
    const r = await processUrl(THREADS, rules, { expand: true, locale: 'en', fetch: stuck });
    expect(r).toMatchObject({ status: 'partial', reason: 'unresolved', cleanUrl: THREADS, hops: [THREADS] });
  });

  it('returns partial with the failure reason when expansion fails', async () => {
    const offline: FetchFn = async () => {
      throw new Error('offline');
    };
    const r = await processUrl(`${THREADS}?utm_source=x`, rules, { expand: true, locale: 'en', fetch: offline });
    expect(r).toMatchObject({ cleanUrl: THREADS, status: 'partial', reason: 'network' });
    expect(r.removed.map((p) => p.key)).toEqual(['utm_source']);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm --filter @linkclean/core exec vitest run process`
Expected: FAIL，找不到 `../src/process`

- [ ] **Step 3: 實作**

`packages/core/src/process.ts`:
```ts
import type { FetchFn, ProcessResult, Reason, RemovedItem, RuleBundle } from './types';
import { extractUrl } from './extract';
import { unwrapUrl } from './unwrap';
import { findExpander, expandUrl, DEFAULT_USER_AGENT, DEFAULT_TIMEOUT_MS } from './expand';
import { cleanUrl } from './clean';
import { analyze } from './analyze';

const MAX_EXPANSIONS = 3;

export interface ProcessOptions {
  expand: boolean;
  locale: string;
  fetch?: FetchFn;
  userAgent?: string;
  timeoutMs?: number;
}

export async function processUrl(input: string, rules: RuleBundle, opts: ProcessOptions): Promise<ProcessResult> {
  const extracted = extractUrl(input);
  if (!extracted) {
    return { originalUrl: input.trim(), cleanUrl: '', status: 'failed', reason: 'invalid_input', removed: [], hops: [] };
  }

  const hops = [extracted];
  const visit = (next: string) => {
    if (next !== hops[hops.length - 1]) hops.push(next);
  };
  const removed: RemovedItem[] = [];
  let reason: Reason | undefined;

  const first = unwrapUrl(extracted, rules.providers);
  first.hops.forEach(visit);
  let url = first.url;
  if (!first.complete) reason = 'unresolved';

  // One time budget for the whole chain, not per expansion.
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // Keep expanding while the URL is still a known short/share link.
  for (let i = 0; !reason && findExpander(url, rules.expanders); i++) {
    const remaining = deadline - Date.now();
    if (i === MAX_EXPANSIONS) {
      reason = 'unresolved';
    } else if (!opts.expand || !opts.fetch) {
      reason = 'expand_disabled';
    } else if (remaining <= 0) {
      reason = 'expand_timeout';
    } else {
      const r = await expandUrl(url, rules.expanders, {
        fetch: opts.fetch,
        userAgent: opts.userAgent ?? DEFAULT_USER_AGENT,
        timeoutMs: remaining,
      });
      r.hops.forEach(visit);
      reason = r.reason;
      if (!reason) {
        removed.push(...r.removed);
        const u = unwrapUrl(r.url, rules.providers);
        u.hops.forEach(visit);
        url = u.url;
        if (!u.complete) reason = 'unresolved';
      }
    }
  }

  const cleaned = cleanUrl(url, rules.providers);
  removed.push(...cleaned.removed);

  const result: ProcessResult = {
    originalUrl: extracted,
    cleanUrl: cleaned.url,
    status: reason ? 'partial' : 'clean',
    removed: analyze(removed, rules.knowledge, opts.locale),
    hops,
  };
  if (reason) result.reason = reason;
  return result;
}
```

`packages/core/src/index.ts`:
```ts
export * from './types';
export { processUrl } from './process';
export type { ProcessOptions } from './process';
export { cleanUrl } from './clean';
export { unwrapUrl } from './unwrap';
export type { UnwrapResult } from './unwrap';
export { expandUrl, findExpander, DEFAULT_USER_AGENT, DEFAULT_TIMEOUT_MS } from './expand';
export { analyze, resolveLocale } from './analyze';
export { extractUrl } from './extract';
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm --filter @linkclean/core test && pnpm --filter @linkclean/core typecheck`
Expected: 全部 PASS（query、regex、extract、clean、unwrap、expand、analyze、process 共 8 個測試檔）

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add processUrl pipeline and public exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Rules package — data files, merge, bundle build

**Files:**
- Create: `rules/package.json`, `rules/tsconfig.json`
- Create: `rules/overrides.json`, `rules/expanders.json`, `rules/knowledge.json`
- Create: `rules/src/merge.ts`, `rules/src/bundle.ts`, `rules/src/build.ts`
- Test: `rules/test/unit/merge.test.ts`, `rules/test/unit/bundle.test.ts`, `rules/test/unit/data.test.ts`

**Interfaces:**
- Consumes: `@linkclean/core` 的型別 `Provider`, `Expander`, `KnowledgeEntry`, `RuleBundle`
- Produces:
  - `ARRAY_FIELDS: readonly ['rules','rawRules','referralMarketing','exceptions','redirections']`
  - `mergeProviders(base: Record<string, Provider>, overrides: Record<string, Partial<Provider>>): Record<string, Provider>`（陣列欄位串接，其他欄位以 override 取代；新的 provider 沒有 `urlPattern` → throw）
  - `interface OwnData { overrides: { providers: Record<string, Partial<Provider>> }; expanders: Record<string, Expander>; knowledge: Record<string, KnowledgeEntry> }`
  - `validateOwnData(data: OwnData): string[]`（錯誤訊息陣列；空陣列代表通過。**缺翻譯（含英文）不算錯誤**，只由 `missingTranslations` 產生警告）
  - `missingTranslations(kb: Record<string, KnowledgeEntry>): string[]`
  - `buildBundle(input: OwnData & { clearurls: { providers: Record<string, Provider> }; version: string }): RuleBundle`
  - `sha256(text: string): string`（hex）
  - `makeVersion(d: Date): string`（UTC，格式 `YYYY.MM.DD.HHmm`；**只用於顯示**，App 判斷要不要更新是比對 `sha256`，見 spec §5.3）
  - CLI：`pnpm build:rules [--clearurls <file>]`（pnpm 會把 script 名稱後的參數直接轉給腳本，不要加 `--`） → `rules/dist/rules.json`、`rules/dist/rules.meta.json`
  - `rules.meta.json`：`{ schemaVersion: 1, version, sha256, generatedAt }`，`sha256` 是 `rules.json` 檔案內容（UTF-8）的 hex

- [ ] **Step 1: 建立 package 與資料檔**

`rules/package.json`:
```json
{
  "name": "@linkclean/rules",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsx src/build.ts",
    "test": "vitest run test/unit",
    "test:regression": "vitest run test/regression",
    "test:live": "tsx src/live.ts",
    "clean-url": "tsx src/cli.ts",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@linkclean/core": "workspace:*"
  }
}
```

`rules/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM"], "types": ["node"] },
  "include": ["src", "test"]
}
```

Run:
```bash
pnpm --filter @linkclean/rules add -D vitest typescript tsx @types/node
pnpm install
```

`rules/overrides.json`（ClearURLs 沒有 Threads 規則，FB 也沒有 `rdid` / `share_url`；spike 已確認）:
```json
{
  "providers": {
    "threads": {
      "urlPattern": "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?threads\\.(?:com|net)(?:[/:?#]|$)",
      "rules": ["xmt", "slof"]
    },
    "facebook": {
      "rules": ["rdid", "share_url"]
    }
  }
}
```

`rules/expanders.json`:
```json
{
  "facebook": {
    "match": "^https://(www|m)\\.facebook\\.com/share/",
    "loginWall": { "match": "^https://(www|m)\\.facebook\\.com/login", "param": "next" },
    "normalizeHost": { "m.facebook.com": "www.facebook.com" },
    "shareId": "/share/(?:[a-z]/)?([^/?#]+)"
  },
  "threads": {
    "match": "^https://www\\.threads\\.(com|net)/share/",
    "shareId": "/share/([^/?#]+)"
  },
  "generic": {
    "match": "^https?://(bit\\.ly|t\\.co|lnkd\\.in|amzn\\.to|shp\\.ee|fb\\.me)/"
  }
}
```

`rules/knowledge.json`（只收錄已確認用途的參數；說不準的寫「用途未公開」，不臆測）:
```json
{
  "utm_*": {
    "category": "campaign",
    "risk": "low",
    "desc": {
      "zh-TW": "行銷活動標記（來源、媒介、活動名稱），網站用來統計流量從哪裡來。",
      "en": "Marketing campaign tag (source, medium, campaign name) used by sites to attribute traffic.",
      "ja": "マーケティングキャンペーンのタグ（参照元・媒体・キャンペーン名）。サイトが流入元を集計するために使います。"
    }
  },
  "fbclid": {
    "owner": "Meta",
    "category": "ad_click",
    "risk": "medium",
    "desc": {
      "zh-TW": "Facebook 點擊識別碼，讓網站與 Meta 把這次造訪和你在 Facebook 上的活動關聯起來。",
      "en": "Facebook click identifier that lets the site and Meta link this visit to your Facebook activity.",
      "ja": "Facebook のクリック識別子。サイトと Meta がこの訪問をあなたの Facebook 上の行動と結び付けられます。"
    }
  },
  "gclid": {
    "owner": "Google",
    "category": "ad_click",
    "risk": "medium",
    "desc": {
      "zh-TW": "Google 廣告點擊識別碼，用來追蹤廣告的轉換成效。",
      "en": "Google Ads click identifier used for ad conversion tracking.",
      "ja": "Google 広告のクリック識別子。広告のコンバージョン計測に使われます。"
    }
  },
  "_ga": {
    "owner": "Google",
    "category": "session",
    "risk": "medium",
    "desc": {
      "zh-TW": "Google Analytics 跨網站識別碼，可在不同網站之間延續對你的追蹤。",
      "en": "Google Analytics cross-domain identifier that carries your tracking session across sites.",
      "ja": "Google アナリティクスのクロスドメイン識別子。サイトをまたいで追跡を引き継ぎます。"
    }
  },
  "_gl": {
    "owner": "Google",
    "category": "session",
    "risk": "medium",
    "desc": {
      "zh-TW": "Google Analytics 跨網站識別碼，可在不同網站之間延續對你的追蹤。",
      "en": "Google Analytics cross-domain identifier that carries your tracking session across sites.",
      "ja": "Google アナリティクスのクロスドメイン識別子。サイトをまたいで追跡を引き継ぎます。"
    }
  },
  "igsh": {
    "owner": "Meta",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "Instagram 分享識別碼，可能讓 Instagram 得知是誰分享了這個連結。",
      "en": "Instagram share identifier that may reveal to Instagram who shared this link.",
      "ja": "Instagram の共有識別子。誰がこのリンクを共有したかを Instagram が把握できる可能性があります。"
    }
  },
  "igshid": {
    "owner": "Meta",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "Instagram 分享識別碼（舊版），可能讓 Instagram 得知是誰分享了這個連結。",
      "en": "Legacy Instagram share identifier that may reveal to Instagram who shared this link.",
      "ja": "旧形式の Instagram 共有識別子。誰がこのリンクを共有したかを Instagram が把握できる可能性があります。"
    }
  },
  "spotify.com:si": {
    "owner": "Spotify",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "Spotify 分享識別碼，可能讓 Spotify 得知是誰分享給你的。",
      "en": "Spotify share identifier that may reveal to Spotify who shared this with you.",
      "ja": "Spotify の共有識別子。誰があなたに共有したかを Spotify が把握できる可能性があります。"
    }
  },
  "youtube.com:si": {
    "owner": "Google",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "YouTube 分享識別碼，可能讓 YouTube 得知是誰分享給你的。",
      "en": "YouTube share identifier that may reveal to YouTube who shared this with you.",
      "ja": "YouTube の共有識別子。誰があなたに共有したかを YouTube が把握できる可能性があります。"
    }
  },
  "youtu.be:si": {
    "owner": "Google",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "YouTube 分享識別碼，可能讓 YouTube 得知是誰分享給你的。",
      "en": "YouTube share identifier that may reveal to YouTube who shared this with you.",
      "ja": "YouTube の共有識別子。誰があなたに共有したかを YouTube が把握できる可能性があります。"
    }
  },
  "facebook.com:share-id": {
    "owner": "Meta",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "Facebook 分享連結的專屬 ID，可能讓 Facebook 得知是誰分享給你的。",
      "en": "Unique ID of a Facebook share link that may reveal to Facebook who shared it with you.",
      "ja": "Facebook 共有リンク固有の ID。誰があなたに共有したかを Facebook が把握できる可能性があります。"
    }
  },
  "facebook.com:share_url": {
    "owner": "Meta",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "夾帶原始分享連結（含分享 ID）的參數。",
      "en": "Carries the original share link, including its share ID.",
      "ja": "共有 ID を含む元の共有リンクを保持するパラメータです。"
    }
  },
  "facebook.com:rdid": {
    "owner": "Meta",
    "category": "session",
    "risk": "low",
    "desc": {
      "zh-TW": "Facebook 轉址時加入的識別碼，每次都不同，用途未公開。",
      "en": "Identifier Facebook adds while redirecting; changes every time, purpose undocumented.",
      "ja": "Facebook がリダイレクト時に付与する識別子。毎回変わり、用途は非公開です。"
    }
  },
  "threads.com:share-id": {
    "owner": "Meta",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "Threads 分享連結的專屬 ID，可能讓 Threads 得知是誰分享給你的。",
      "en": "Unique ID of a Threads share link that may reveal to Threads who shared it with you.",
      "ja": "Threads 共有リンク固有の ID。誰があなたに共有したかを Threads が把握できる可能性があります。"
    }
  },
  "threads.com:xmt": {
    "owner": "Meta",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "Threads 分享參數，可能與分享者的帳號關聯。",
      "en": "Threads share parameter that may be linked to the sharer's account.",
      "ja": "共有者のアカウントと関連付けられている可能性がある Threads の共有パラメータです。"
    }
  },
  "threads.com:slof": {
    "owner": "Meta",
    "category": "session",
    "risk": "low",
    "desc": {
      "zh-TW": "Threads 分享來源標記，用途未公開。",
      "en": "Threads share-source flag; purpose undocumented.",
      "ja": "Threads の共有元フラグ。用途は非公開です。"
    }
  },
  "threads.net:share-id": {
    "owner": "Meta",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "Threads 分享連結的專屬 ID，可能讓 Threads 得知是誰分享給你的。",
      "en": "Unique ID of a Threads share link that may reveal to Threads who shared it with you.",
      "ja": "Threads 共有リンク固有の ID。誰があなたに共有したかを Threads が把握できる可能性があります。"
    }
  },
  "threads.net:xmt": {
    "owner": "Meta",
    "category": "sharer_id",
    "risk": "high",
    "desc": {
      "zh-TW": "Threads 分享參數，可能與分享者的帳號關聯。",
      "en": "Threads share parameter that may be linked to the sharer's account.",
      "ja": "共有者のアカウントと関連付けられている可能性がある Threads の共有パラメータです。"
    }
  },
  "threads.net:slof": {
    "owner": "Meta",
    "category": "session",
    "risk": "low",
    "desc": {
      "zh-TW": "Threads 分享來源標記，用途未公開。",
      "en": "Threads share-source flag; purpose undocumented.",
      "ja": "Threads の共有元フラグ。用途は非公開です。"
    }
  },
  "amazon.com:tag": {
    "owner": "Amazon",
    "category": "affiliate",
    "risk": "medium",
    "desc": {
      "zh-TW": "Amazon 聯盟行銷代碼：透過這個連結購買，分享者會獲得分潤。",
      "en": "Amazon affiliate tag: the sharer earns a commission if you buy through this link.",
      "ja": "Amazon アソシエイトのタグ。このリンク経由で購入すると共有者に報酬が入ります。"
    }
  },
  "amazon.co.jp:tag": {
    "owner": "Amazon",
    "category": "affiliate",
    "risk": "medium",
    "desc": {
      "zh-TW": "Amazon 聯盟行銷代碼：透過這個連結購買，分享者會獲得分潤。",
      "en": "Amazon affiliate tag: the sharer earns a commission if you buy through this link.",
      "ja": "Amazon アソシエイトのタグ。このリンク経由で購入すると共有者に報酬が入ります。"
    }
  }
}
```

- [ ] **Step 2: 寫失敗測試**

`rules/test/unit/merge.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mergeProviders } from '../../src/merge';

describe('mergeProviders', () => {
  const base = {
    facebook: { urlPattern: 'fb', rules: ['a'], exceptions: ['x'] },
    google: { urlPattern: 'g', rules: ['ved'] },
  };

  it('appends array fields to existing providers', () => {
    const out = mergeProviders(base, { facebook: { rules: ['rdid'], redirections: ['r'] } });
    expect(out.facebook).toEqual({ urlPattern: 'fb', rules: ['a', 'rdid'], exceptions: ['x'], redirections: ['r'] });
  });

  it('adds new providers', () => {
    const out = mergeProviders(base, { threads: { urlPattern: 't', rules: ['xmt'] } });
    expect(out.threads).toEqual({ urlPattern: 't', rules: ['xmt'] });
  });

  it('replaces scalar fields', () => {
    expect(mergeProviders(base, { google: { urlPattern: 'g2' } }).google!.urlPattern).toBe('g2');
  });

  it('does not mutate the base', () => {
    mergeProviders(base, { facebook: { rules: ['z'] } });
    expect(base.facebook.rules).toEqual(['a']);
  });

  it('throws when a new provider has no urlPattern', () => {
    expect(() => mergeProviders(base, { nope: { rules: ['x'] } })).toThrow(/nope.*urlPattern/);
  });
});
```

`rules/test/unit/bundle.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildBundle, makeVersion, missingTranslations, sha256, validateOwnData } from '../../src/bundle';
import type { OwnData } from '../../src/bundle';

const own: OwnData = {
  overrides: { providers: { threads: { urlPattern: 'threads', rules: ['xmt'] } } },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/' } },
  knowledge: { xmt: { category: 'sharer_id', risk: 'high', desc: { en: 'x', 'zh-TW': 'x', ja: 'x' } } },
};

describe('validateOwnData', () => {
  it('accepts valid data', () => {
    expect(validateOwnData(own)).toEqual([]);
  });
  it('reports invalid regexes, categories and risks', () => {
    const errors = validateOwnData({
      overrides: { providers: { bad: { urlPattern: '(', rules: ['('] } } },
      expanders: { e: { match: '(', shareId: '(', loginWall: { match: '(', param: 'next' } } },
      knowledge: { k: { category: 'nope' as never, risk: 'huge' as never, desc: {} } },
    });
    expect(errors).toEqual([
      'overrides.bad.urlPattern: invalid regex (',
      'overrides.bad.rules: invalid regex (',
      'expanders.e.match: invalid regex (',
      'expanders.e.shareId: invalid regex (',
      'expanders.e.loginWall.match: invalid regex (',
      'knowledge.k: invalid category nope',
      'knowledge.k: invalid risk huge',
    ]);
  });
  it('rejects uppercase knowledge keys and wildcard keys with a host', () => {
    const errors = validateOwnData({
      ...own,
      knowledge: {
        Fbclid: { category: 'ad_click', risk: 'medium', desc: { en: 'x' } },
        'ex.com:utm_*': { category: 'campaign', risk: 'low', desc: { en: 'x' } },
      },
    });
    expect(errors).toEqual(['knowledge.Fbclid: key must be lowercase', 'knowledge.ex.com:utm_*: wildcard keys cannot have a host']);
  });
});

describe('missingTranslations', () => {
  it('lists entries missing any locale', () => {
    expect(missingTranslations({ a: { category: 'campaign', risk: 'low', desc: { en: 'x' } } })).toEqual([
      'knowledge.a: missing zh-TW, ja',
    ]);
  });
});

describe('buildBundle', () => {
  it('merges ClearURLs providers with overrides', () => {
    const b = buildBundle({ ...own, clearurls: { providers: { globalRules: { urlPattern: '.*', rules: ['utm'] } } }, version: 'v1' });
    expect(b.schemaVersion).toBe(1);
    expect(b.version).toBe('v1');
    expect(Object.keys(b.providers)).toEqual(['globalRules', 'threads']);
    expect(b.expanders).toBe(own.expanders);
    expect(b.knowledge).toBe(own.knowledge);
  });
});

describe('sha256 / makeVersion', () => {
  it('hashes UTF-8 text as hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('formats the version in UTC', () => {
    expect(makeVersion(new Date('2026-10-06T03:07:00Z'))).toBe('2026.10.06.0307');
  });
});
```

`rules/test/unit/data.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import overrides from '../../overrides.json';
import expanders from '../../expanders.json';
import knowledge from '../../knowledge.json';
import { validateOwnData } from '../../src/bundle';
import type { OwnData } from '../../src/bundle';

describe('checked-in rule data', () => {
  it('passes validation', () => {
    expect(validateOwnData({ overrides, expanders, knowledge } as OwnData)).toEqual([]);
  });
});
```

- [ ] **Step 3: 確認測試失敗**

Run: `pnpm --filter @linkclean/rules test`
Expected: FAIL，找不到 `../../src/merge`、`../../src/bundle`

- [ ] **Step 4: 實作**

`rules/src/merge.ts`:
```ts
import type { Provider } from '@linkclean/core';

export const ARRAY_FIELDS = ['rules', 'rawRules', 'referralMarketing', 'exceptions', 'redirections'] as const;

export function mergeProviders(
  base: Record<string, Provider>,
  overrides: Record<string, Partial<Provider>>,
): Record<string, Provider> {
  const out: Record<string, Provider> = structuredClone(base);
  for (const [name, o] of Object.entries(overrides)) {
    const b = out[name];
    if (!b) {
      if (!o.urlPattern) throw new Error(`override provider "${name}" is new and needs a urlPattern`);
      out[name] = structuredClone(o) as Provider;
      continue;
    }
    const merged: Provider = { ...b, ...structuredClone(o) };
    for (const f of ARRAY_FIELDS) {
      if (b[f] || o[f]) merged[f] = [...(b[f] ?? []), ...(o[f] ?? [])];
    }
    out[name] = merged;
  }
  return out;
}
```

`rules/src/bundle.ts`:
```ts
import { createHash } from 'node:crypto';
import type { Expander, KnowledgeEntry, Provider, RuleBundle } from '@linkclean/core';
import { ARRAY_FIELDS, mergeProviders } from './merge';

export interface OwnData {
  overrides: { providers: Record<string, Partial<Provider>> };
  expanders: Record<string, Expander>;
  knowledge: Record<string, KnowledgeEntry>;
}

const CATEGORIES = ['sharer_id', 'ad_click', 'affiliate', 'campaign', 'session', 'unknown'];
const RISKS = ['high', 'medium', 'low'];
const LOCALES = ['zh-TW', 'en', 'ja'] as const;
const KEY_PATTERN_FIELDS = new Set(['rules', 'referralMarketing']);

export function validateOwnData({ overrides, expanders, knowledge }: OwnData): string[] {
  const errors: string[] = [];
  const checkRe = (where: string, src: string, compiled = src) => {
    try {
      new RegExp(compiled, 'i');
    } catch {
      errors.push(`${where}: invalid regex ${src}`);
    }
  };

  for (const [name, p] of Object.entries(overrides.providers)) {
    if (p.urlPattern !== undefined) checkRe(`overrides.${name}.urlPattern`, p.urlPattern);
    for (const f of ARRAY_FIELDS) {
      for (const r of p[f] ?? []) checkRe(`overrides.${name}.${f}`, r, KEY_PATTERN_FIELDS.has(f) ? `^(?:${r})$` : r);
    }
  }

  for (const [name, e] of Object.entries(expanders)) {
    checkRe(`expanders.${name}.match`, e.match);
    if (e.shareId !== undefined) checkRe(`expanders.${name}.shareId`, e.shareId);
    if (e.loginWall) checkRe(`expanders.${name}.loginWall.match`, e.loginWall.match);
  }

  for (const [key, k] of Object.entries(knowledge)) {
    if (key !== key.toLowerCase()) errors.push(`knowledge.${key}: key must be lowercase`);
    if (key.endsWith('*') && key.includes(':')) errors.push(`knowledge.${key}: wildcard keys cannot have a host`);
    if (!CATEGORIES.includes(k.category)) errors.push(`knowledge.${key}: invalid category ${k.category}`);
    if (!RISKS.includes(k.risk)) errors.push(`knowledge.${key}: invalid risk ${k.risk}`);
  }
  return errors;
}

export function missingTranslations(kb: Record<string, KnowledgeEntry>): string[] {
  const out: string[] = [];
  for (const [key, k] of Object.entries(kb)) {
    const missing = LOCALES.filter((l) => !k.desc?.[l]);
    if (missing.length) out.push(`knowledge.${key}: missing ${missing.join(', ')}`);
  }
  return out;
}

export function buildBundle(
  input: OwnData & { clearurls: { providers: Record<string, Provider> }; version: string },
): RuleBundle {
  return {
    schemaVersion: 1,
    version: input.version,
    providers: mergeProviders(input.clearurls.providers, input.overrides.providers),
    expanders: input.expanders,
    knowledge: input.knowledge,
  };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function makeVersion(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
```

`rules/src/build.ts`:
```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Provider } from '@linkclean/core';
import { buildBundle, makeVersion, missingTranslations, sha256, validateOwnData } from './bundle';
import type { OwnData } from './bundle';

export const CLEARURLS_URL = 'https://gitlab.com/ClearURLs/rules/-/raw/master/data.min.json';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;

async function loadClearUrls(file: string | undefined): Promise<{ providers: Record<string, Provider> }> {
  let data: unknown;
  if (file) {
    data = await readJson(file);
  } else {
    const res = await fetch(CLEARURLS_URL);
    if (!res.ok) throw new Error(`ClearURLs download failed: HTTP ${res.status}`);
    data = await res.json();
  }
  const providers = (data as { providers?: unknown }).providers;
  if (!providers || typeof providers !== 'object') throw new Error('ClearURLs payload has no providers object');
  return { providers: providers as Record<string, Provider> };
}

async function main() {
  const { values } = parseArgs({
    options: { clearurls: { type: 'string' }, out: { type: 'string', default: here('../dist') } },
  });
  const outDir = values.out!;

  const own: OwnData = {
    overrides: await readJson(here('../overrides.json')),
    expanders: await readJson(here('../expanders.json')),
    knowledge: await readJson(here('../knowledge.json')),
  };
  const errors = validateOwnData(own);
  if (errors.length) throw new Error(`invalid rule data:\n${errors.join('\n')}`);

  const now = new Date();
  const bundle = buildBundle({ ...own, clearurls: await loadClearUrls(values.clearurls), version: makeVersion(now) });
  const json = JSON.stringify(bundle);
  const meta = { schemaVersion: bundle.schemaVersion, version: bundle.version, sha256: sha256(json), generatedAt: now.toISOString() };

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'rules.json'), json);
  await writeFile(join(outDir, 'rules.meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  for (const w of missingTranslations(own.knowledge)) {
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${w}` : `warning: ${w}`);
  }
  console.log(`built rules ${bundle.version}: ${Object.keys(bundle.providers).length} providers, sha256 ${meta.sha256}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 5: 確認單元測試通過**

Run: `pnpm --filter @linkclean/rules test && pnpm --filter @linkclean/rules typecheck`
Expected: merge、bundle、data 三個測試檔全部 PASS

- [ ] **Step 6: 實際建置一次**

Run: `pnpm build:rules`
Expected:
- 輸出 `built rules 2026.xx.xx.xxxx: 207 providers, sha256 <hex>`（206 個 ClearURLs provider + threads；數量隨 ClearURLs 更新可能不同，≥ 200 即正常）
- 輸出 `warning: knowledge.threads.net:...` 這類行**不應出現**（所有條目都有三語）
- `rules/dist/rules.json` 與 `rules/dist/rules.meta.json` 存在

Run: `shasum -a 256 rules/dist/rules.json && cat rules/dist/rules.meta.json`
Expected: 兩邊 sha256 相同

- [ ] **Step 7: Commit**

```bash
git add rules package.json pnpm-lock.yaml
git commit -m "feat(rules): merge ClearURLs with own overrides and build rule bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Offline regression, live regression, and CLI

**Files:**
- Create: `rules/fixtures/cases.json`, `rules/regression.json`
- Create: `rules/src/node.ts`, `rules/src/cli.ts`, `rules/src/live.ts`
- Test: `rules/test/regression/cases.test.ts`

**Interfaces:**
- Consumes: `processUrl`, `FetchFn`, `RuleBundle`（`@linkclean/core`）；Task 8 產出的 `rules/dist/rules.json`
- Produces:
  - `pnpm test:regression`：用真實 ClearURLs 規則 + 錄好的跳轉結果，離線驗證
  - `pnpm test:live`：用 `regression.json` 的真實連結連網驗證；清單為空時直接成功
  - `pnpm clean-url "<文字或網址>"`：印出 `ProcessResult` JSON
  - `fixtures/cases.json` 格式：`{ name, input, responses: { [url]: finalUrl }, expected: { cleanUrl, status, removedKeys } }[]`
  - `regression.json` 格式：`{ input, expectedCleanUrl }[]`

- [ ] **Step 1: 建立 fixtures 與空的 live 清單**

`rules/fixtures/cases.json`（全部用假 ID；跳轉結果依 2026-10-06 spike 實測的格式錄製）:
```json
[
  {
    "name": "threads share link",
    "input": "https://www.threads.com/share/BAAtest0001/",
    "responses": { "https://www.threads.com/share/BAAtest0001/": "https://www.threads.com/@someone/post/DTest00001?xmt=AQGtest&slof=1" },
    "expected": { "cleanUrl": "https://www.threads.com/@someone/post/DTest00001", "status": "clean", "removedKeys": ["share-id", "xmt", "slof"] }
  },
  {
    "name": "facebook share link, direct redirect (iOS-like UA)",
    "input": "https://www.facebook.com/share/p/TEST01/",
    "responses": { "https://www.facebook.com/share/p/TEST01/": "https://www.facebook.com/groups/somegroup/permalink/1234567890/?rdid=abcDEF&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fp%2FTEST01%2F" },
    "expected": { "cleanUrl": "https://www.facebook.com/groups/somegroup/permalink/1234567890/", "status": "clean", "removedKeys": ["share-id", "share_url", "rdid"] }
  },
  {
    "name": "facebook share link, login wall (Android-like UA)",
    "input": "https://www.facebook.com/share/p/TEST01/",
    "responses": { "https://www.facebook.com/share/p/TEST01/": "https://m.facebook.com/login.php?next=https%3A%2F%2Fm.facebook.com%2Fgroups%2Fsomegroup%2Fpermalink%2F1234567890%2F%3Frdid%3Dxyz%26share_url%3Dhttps%253A%252F%252Fm.facebook.com%252Fshare%252Fp%252FTEST01%252F%26refsrc%3Ddeprecated&refsrc=deprecated&rdid=xyz&_rdr" },
    "expected": { "cleanUrl": "https://www.facebook.com/groups/somegroup/permalink/1234567890/", "status": "clean", "removedKeys": ["share-id", "share_url", "rdid", "refsrc"] }
  },
  {
    "name": "l.facebook.com outbound wrapper",
    "input": "https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa%3Futm_source%3Dfb%26id%3D5&h=AT0test",
    "responses": {},
    "expected": { "cleanUrl": "https://example.com/a?id=5", "status": "clean", "removedKeys": ["utm_source"] }
  },
  {
    "name": "generic short link",
    "input": "https://bit.ly/3test",
    "responses": { "https://bit.ly/3test": "https://example.com/page?utm_campaign=x&id=7&gclid=Cj0test" },
    "expected": { "cleanUrl": "https://example.com/page?id=7", "status": "clean", "removedKeys": ["gclid", "utm_campaign"] }
  },
  {
    "name": "spotify si",
    "input": "https://open.spotify.com/track/4testTrack?si=abc123",
    "responses": {},
    "expected": { "cleanUrl": "https://open.spotify.com/track/4testTrack", "status": "clean", "removedKeys": ["si"] }
  },
  {
    "name": "youtu.be si",
    "input": "https://youtu.be/abcDEF12345?si=XyZtest",
    "responses": {},
    "expected": { "cleanUrl": "https://youtu.be/abcDEF12345", "status": "clean", "removedKeys": ["si"] }
  },
  {
    "name": "instagram igsh",
    "input": "https://www.instagram.com/reel/ABCtest123/?igsh=MWQ1test",
    "responses": {},
    "expected": { "cleanUrl": "https://www.instagram.com/reel/ABCtest123/", "status": "clean", "removedKeys": ["igsh"] }
  },
  {
    "name": "shared text with title and fbclid",
    "input": "好文推薦 https://example.com/post?id=1&fbclid=IwARtest。",
    "responses": {},
    "expected": { "cleanUrl": "https://example.com/post?id=1", "status": "clean", "removedKeys": ["fbclid"] }
  }
]
```

`removedKeys` 是**集合比對**（排序後比較），不檢查順序。

`rules/regression.json`（初始為空；之後只能放用測試帳號產生、可以公開的連結）:
```json
[]
```

- [ ] **Step 2: 寫回歸測試**

`rules/test/regression/cases.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { processUrl } from '@linkclean/core';
import type { FetchFn, RuleBundle } from '@linkclean/core';
import cases from '../../fixtures/cases.json';

const rulesPath = fileURLToPath(new URL('../../dist/rules.json', import.meta.url));
if (!existsSync(rulesPath)) throw new Error('rules/dist/rules.json missing: run `pnpm build:rules` first');
const rules = JSON.parse(readFileSync(rulesPath, 'utf8')) as RuleBundle;

function replay(responses: Record<string, string | undefined>): FetchFn {
  return async (url) => {
    const final = responses[url];
    if (final === undefined) throw new Error(`no recorded response for ${url}`);
    return { url: final, status: 200 };
  };
}

describe('offline regression against built rules', () => {
  it.each(cases)('$name', async (c) => {
    const r = await processUrl(c.input, rules, { expand: true, locale: 'en', fetch: replay(c.responses) });
    expect(r.cleanUrl).toBe(c.expected.cleanUrl);
    expect(r.status).toBe(c.expected.status);
    expect(r.removed.map((p) => p.key).sort()).toEqual([...c.expected.removedKeys].sort());
  });
});
```

- [ ] **Step 3: 執行回歸測試**

Run: `pnpm build:rules && pnpm test:regression`
Expected: 9 個案例全部 PASS。

若有案例失敗：**不可為了讓測試通過而修改 `expected`**。先在 `rules/dist/rules.json` 找出是哪個 ClearURLs provider 的 rule / exception 造成差異，再決定修 `overrides.json` 或 core。若確認是預期值本身寫錯（例如 ClearURLs 的全域規則還刪了別的參數），在 commit 訊息說明依據後再改。

- [ ] **Step 4: 實作 CLI 與 live 回歸**

`rules/src/node.ts`（Node 專用的共用函式）:
```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FetchFn, RuleBundle } from '@linkclean/core';

export const nodeFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, { ...init, redirect: 'follow' });
  return { url: res.url, status: res.status };
};

export async function loadRules(): Promise<RuleBundle> {
  const path = fileURLToPath(new URL('../dist/rules.json', import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as RuleBundle;
}
```

`rules/src/cli.ts`:
```ts
import { processUrl } from '@linkclean/core';
import { loadRules, nodeFetch } from './node';

async function main() {
  const input = process.argv.slice(2).join(' ').trim();
  if (!input) {
    console.error('usage: pnpm clean-url "<text or URL>"');
    process.exit(2);
  }
  const result = await processUrl(input, await loadRules(), {
    expand: true,
    locale: process.env.LINKCLEAN_LOCALE ?? 'zh-TW',
    fetch: nodeFetch,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

`rules/src/live.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { processUrl } from '@linkclean/core';
import { loadRules, nodeFetch } from './node';

interface LiveCase {
  input: string;
  expectedCleanUrl: string;
}

async function main() {
  const path = fileURLToPath(new URL('../regression.json', import.meta.url));
  const cases = JSON.parse(await readFile(path, 'utf8')) as LiveCase[];
  if (cases.length === 0) {
    const msg = 'regression.json is empty: live monitoring is not checking any platform';
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `warning: ${msg}`);
    return;
  }
  const rules = await loadRules();
  let failed = 0;
  for (const c of cases) {
    const r = await processUrl(c.input, rules, { expand: true, locale: 'en', fetch: nodeFetch });
    const ok = r.status === 'clean' && r.cleanUrl === c.expectedCleanUrl;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.input}\n  got: ${r.status}${r.reason ? `/${r.reason}` : ''} ${r.cleanUrl}\n  hops: ${r.hops.join(' -> ')}`);
  }
  if (failed) {
    console.error(`${failed}/${cases.length} live cases failed: a platform may have changed its redirect behaviour`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 5: 驗證 CLI 與 live**

Run: `pnpm test:live`
Expected: `warning: regression.json is empty: live monitoring is not checking any platform`，exit 0

Run: `pnpm clean-url "看這個 https://example.com/a?utm_source=x&id=1"`
Expected: JSON 輸出，`"cleanUrl": "https://example.com/a?id=1"`、`"status": "clean"`、`removed[0].desc` 是中文說明

Run（真實網路端到端驗證）。兩個環境變數的值是用戶在 2026-10-06 spike 時於對話中提供的真實分享連結；**只在本機 shell 設定，絕不寫進任何檔案、文件或 commit**（如果沒有這兩個連結，先請用戶提供）:
```bash
pnpm clean-url "$LINKCLEAN_SAMPLE_THREADS"
pnpm clean-url "$LINKCLEAN_SAMPLE_FB"
```
Expected:
- Threads：`status: "clean"`，`cleanUrl` 形如 `https://www.threads.com/@<user>/post/<id>`（無 query），`removed` 含 `share-id`、`xmt`
- FB：`status: "clean"`，`cleanUrl` 形如 `https://www.facebook.com/groups/<group>/permalink/<id>/`（無 query），`removed` 含 `share-id`、`share_url`、`rdid`

如果 FB 回傳 `partial / unresolved`：把 `hops` 貼到回報中，**停下來回報**，不要自行改 expander 設定（代表 Node fetch 的行為跟 spike 時的 curl 不同，需要討論）。

- [ ] **Step 6: Commit**

```bash
git add rules
git commit -m "test(rules): add offline regression cases, live regression and clean-url CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: GitHub Actions publishing + license notice

**Files:**
- Create: `.github/workflows/rules.yml`
- Create: `NOTICE.md`, `README.md`

**Interfaces:**
- Consumes: root scripts `test`、`typecheck`、`build:rules`、`test:regression`、`test:live`
- Produces: GitHub Pages 上的 `rules.json`、`rules.meta.json`（Plan 2 的 App 從這裡下載；網址形如 `https://<user>.github.io/<repo>/rules.json`）

- [ ] **Step 1: 寫 workflow**

`.github/workflows/rules.yml`:
```yaml
name: rules

on:
  schedule:
    - cron: '17 3 * * *'
  push:
    branches: [main]
    paths:
      - 'rules/**'
      - 'packages/core/**'
      - '.github/workflows/rules.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build:rules
      # Offline regression gates publishing.
      - run: pnpm test:regression
      - run: mkdir -p site && cp rules/dist/rules.json rules/dist/rules.meta.json site/
      - uses: actions/upload-pages-artifact@v5
        with:
          path: site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    outputs:
      page_url: ${{ steps.deployment.outputs.page_url }}
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5

  # Live checks never block publishing; a failure emails the repo owner.
  live:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # Check exactly the bundle users receive, not a fresh rebuild.
      - run: mkdir -p rules/dist && curl -fsSL "${{ needs.deploy.outputs.page_url }}rules.json" -o rules/dist/rules.json
      - run: pnpm test:live
```

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/rules.yml"); puts "ok"'`
Expected: `ok`

> action 版本已於 2026-10-06 對照各 repo 的 latest release 確認（checkout v7.0.1、setup-node v7.0.0、upload-pages-artifact v5.0.0、deploy-pages v5.0.1、pnpm/action-setup v6.1.0）。

- [ ] **Step 2: 寫授權聲明與 README**

`NOTICE.md`:
```markdown
# Third-party notices

## ClearURLs rules

`rules.json` includes tracking-parameter rules from the ClearURLs project
(https://gitlab.com/ClearURLs/rules), licensed under the GNU Lesser General
Public License v3.0 (LGPL-3.0). The rules are downloaded unmodified and merged
with this project's own additions in `rules/overrides.json`.

License text: https://www.gnu.org/licenses/lgpl-3.0.html
```

`README.md`:
````markdown
# LinkClean

Removes tracking parameters from shared links and explains what each one does.

## Layout

- `packages/core` — pure TypeScript cleaning engine (no runtime dependencies)
- `rules` — rule data, bundle builder, regression tests, CLI
- `docs/superpowers` — design spec and implementation plans

## Commands

```bash
pnpm install
pnpm test               # unit tests (core + rules)
pnpm build:rules        # download ClearURLs, merge, write rules/dist/
pnpm test:regression    # offline regression against rules/dist/rules.json
pnpm test:live          # live checks for links in rules/regression.json
pnpm clean-url "<url>"  # clean one link using rules/dist/rules.json
```

## Rule data

- `rules/overrides.json` — extra rules in ClearURLs provider format
- `rules/expanders.json` — which short-link domains may be expanded over the network
- `rules/knowledge.json` — explanations shown to users (zh-TW / en / ja)
- `rules/regression.json` — **public** live test links; only add links from a test account

Third-party licences: see `NOTICE.md`.
````

- [ ] **Step 3: 全套驗證**

Run:
```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build:rules && pnpm test:regression && pnpm test:live
```
Expected: 全部成功，exit 0

- [ ] **Step 4: Commit**

```bash
git add .github NOTICE.md README.md
git commit -m "ci(rules): publish rule bundle to GitHub Pages with regression gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: 交給用戶處理（需要用戶確認，執行者不可自行操作）**

以下動作會把程式碼公開到外部服務，必須由用戶決定與執行：
1. 在 GitHub 建立 repo（public，GitHub Pages 免費方案需要 public）
2. `git remote add origin <url> && git push -u origin main`
3. Settings → Pages → Source 選 **GitHub Actions**
4. Actions 頁面手動觸發一次 `rules` workflow，確認 `https://<user>.github.io/<repo>/rules.meta.json` 可以存取
5. 用**專門的測試帳號**在 FB、Threads 各發一則公開貼文並產生分享連結，連同預期的乾淨網址加進 `rules/regression.json`。在這之前，每日 live 監控只會發出「清單是空的」警告，**不會偵測到平台行為改變**
