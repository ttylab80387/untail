# Quick Settings Tile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android Quick Settings tile "Clean link" that opens Untail, cleans the link on the clipboard with the existing pipeline, copies the clean link, and returns to the previous app.

**Architecture:** A local Expo module (`apps/mobile/modules/untail-tile`, Kotlin) holds the TileService, records whether Untail was in the foreground when the tile was tapped, and hands one pending request to JS. Pure TypeScript decides what to do (`tileOutcome.ts`) and runs the steps with injected dependencies (`tileFlow.ts`), so the logic is unit-tested without a device. `AppContext.tsx` wires the flow into the existing queue and clipboard watch.

**Tech Stack:** Expo SDK 57 / React Native, expo-modules-core (Kotlin), expo-router, expo-clipboard, vitest, Android API 24–36.

**Spec:** `docs/superpowers/specs/2026-10-19-quick-settings-tile-design.md` (revision 2 + toast/last-result update, commit b77e5d2)

## Global Constraints

- Branch: `feat/qs-tile` (from `feat/link-safety-phase1` b0d6971). Do not merge or push without the user.
- Android only. iOS behaviour must not change; every native call is a no-op or "unsupported" on iOS.
- No new user-facing permissions. Only `android.permission.BIND_QUICK_SETTINGS_TILE` on the service declaration.
- Never read the clipboard in the background: read only after `waitForWindowFocus` reports focus.
- Never say a link is "safe". Toast texts: `已複製乾淨連結（移除 N 項）`, `已展開並複製連結`, `連結沒有追蹤碼，不用改` (plus en/ja).
- Show Untail's toast **before** `moveTaskToBack`.
- Already-clean link (row 2): do not write the clipboard, do not write history.
- Plain text without a link (row 3) must not be put into the home input box.
- Last tile result stores `{ row, removed, expandedOnly, at }` only — never the URL.
- Code comments in English; user-facing copy in zh-TW / en / ja with identical keys (`src/i18n/i18n.test.ts` enforces this).
- Tool gotcha: Write/Edit turn a typed `\u200b` into the real character. In tests build invisible characters with `String.fromCharCode(0x200b)`; after editing any file run `python3 scripts/check-invisible.py <file>` from the repo root.
- Version: `0.1.3`, Android `versionCode` 5.

## Review Focus

1. **Two taps in quick succession** (second tap while the first is still expanding a short link): only the newest request may copy, toast or return; the older one becomes row 7. → Task 4 test `a newer request makes the older one invalid`.
2. **Clipboard holds the clean link Untail itself wrote earlier** (user taps the tile twice on the same link): must be row 2 ("no tracking"), not a second copy and not a history row. → Task 1 test `treats a link with nothing to clean as already clean`.
3. **Short link with expansion turned off in Settings**: result is partial (`expand_disabled`) → row 6, stay in Untail, no toast. → Task 1 test `stays on partial results`.
4. **Link with only an invisible character** (no tracking params): must count as needing cleaning, be copied, and toast "移除 1 項". → Task 1 test `counts a removed hidden character as a change`.
5. **Cold start from the tile** (process not running): `wasInForeground` must be false, so a successful clean returns to the previous app. → Task 4 test `returns to the previous app after a cold start`; Task 8 device check.

---

## File Structure

| File | Responsibility |
|---|---|
| Create `apps/mobile/src/lib/tileOutcome.ts` | `precheckTile` (offline check of clipboard text) and `decideTileOutcome` (spec §3.2 table) — pure |
| Create `apps/mobile/src/lib/tileOutcome.test.ts` | Tests for the above |
| Create `apps/mobile/src/lib/tileFlow.ts` | `runTile`: focus → read → precheck → clean → decide → notice/remember/toast/back, all through injected deps |
| Create `apps/mobile/src/lib/tileFlow.test.ts` | Tests with fake deps |
| Modify `apps/mobile/src/lib/settings.ts` | `LastTileResult` load/save/clear, `formatHm` |
| Modify `apps/mobile/src/lib/settings.test.ts` | Tests for last tile result |
| Modify `apps/mobile/src/lib/cleaner.ts` | Optional `copyIf` predicate on `CleanDeps` |
| Modify `apps/mobile/src/lib/cleaner.test.ts` | `copyIf` tests |
| Create `apps/mobile/modules/untail-tile/` | Expo module: `expo-module.config.json`, `index.ts`, `android/build.gradle`, Kotlin sources, manifest, resources, icon |
| Modify `apps/mobile/src/state/AppContext.tsx` | `startTile`, enqueue modes, request validity, `tileNotice`, `lastTile`, `tileRequests`, `invalidateTile` |
| Modify `apps/mobile/app/_layout.tsx` | `TileWatcher`: go home on a tile request, invalidate on navigation |
| Modify `apps/mobile/app/index.tsx` | Row 3/4 notices and the "last tile tap" line |
| Modify `apps/mobile/app/history.tsx` | Clearing history also clears the last tile result |
| Create `apps/mobile/src/components/useAddTile.ts` | Shared "add to Quick Settings" action |
| Modify `apps/mobile/app/settings.tsx` | "Add to Quick Settings" row |
| Modify `apps/mobile/src/components/HowTo.tsx` | Fourth way (Android) |
| Modify `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json` | New strings, privacy p3/p5 |
| Modify `docs/site/privacy.html` | Same privacy additions in three languages |
| Modify `docs/store/google-play-data-safety.md` | Note that the tile adds no data type |
| Modify `apps/mobile/app.json` | Version 0.1.3 / versionCode 5 |
| Create `docs/superpowers/notes/2026-10-19-qs-tile-device-tests.md` | Device test results (Task 8) |

---

### Task 1: Tile decision logic (`tileOutcome.ts`)

**Files:**
- Create: `apps/mobile/src/lib/tileOutcome.ts`
- Test: `apps/mobile/src/lib/tileOutcome.test.ts`

**Interfaces:**
- Consumes: `extractUrlDetailed` (`@linkclean/core`), `needsCleaning(url, rules)` (`src/lib/clipboardWatch.ts`), `CleanOutcome` (`src/lib/cleaner.ts`)
- Produces:
  ```ts
  export type TilePrecheck = { kind: 'no_link' } | { kind: 'already_clean'; url: string } | { kind: 'needs_cleaning' };
  export function precheckTile(text: string, rules: RuleBundle): TilePrecheck;
  export type TileToast = { kind: 'copied'; removed: number } | { kind: 'expanded' } | { kind: 'noTracking' };
  export interface TileFacts { read: 'ok' | 'unreadable'; pre: TilePrecheck | null; outcome: CleanOutcome | null; wasInForeground: boolean; valid: boolean }
  export interface TileDecision { row: 1 | 2 | 3 | 4 | 5 | 6 | 7; toast: TileToast | null; goBack: boolean; remember: { row: 1 | 2; removed: number; expandedOnly: boolean } | null }
  export function decideTileOutcome(f: TileFacts): TileDecision;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/lib/tileOutcome.test.ts
import { describe, expect, it } from 'vitest';
import type { ProcessResult, RuleBundle } from '@linkclean/core';
import { decideTileOutcome, precheckTile } from './tileOutcome';
import type { TileFacts } from './tileOutcome';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: { globalRules: { urlPattern: '.*', rules: ['utm_source'] } },
  expanders: { bitly: { match: '^https://bit\\.ly/' } },
  knowledge: {},
};

const ZWSP = String.fromCharCode(0x200b);

const result = (over: Partial<ProcessResult>): ProcessResult => ({
  originalUrl: 'https://ex.com/a?utm_source=x',
  cleanUrl: 'https://ex.com/a',
  status: 'clean',
  removed: [],
  hops: ['https://ex.com/a?utm_source=x'],
  ...over,
});

const facts = (over: Partial<TileFacts>): TileFacts => ({
  read: 'ok',
  pre: { kind: 'needs_cleaning' },
  outcome: null,
  wasInForeground: false,
  valid: true,
  ...over,
});

const removedItem: ProcessResult['removed'][number] = { key: 'utm_source', value: 'x', category: 'campaign', risk: 'low' };

describe('precheckTile', () => {
  it('finds no link in empty or plain text', () => {
    expect(precheckTile('', rules)).toEqual({ kind: 'no_link' });
    expect(precheckTile('see you at 7', rules)).toEqual({ kind: 'no_link' });
  });

  it('treats a link with nothing to clean as already clean', () => {
    expect(precheckTile('https://ex.com/a', rules)).toEqual({ kind: 'already_clean', url: 'https://ex.com/a' });
  });

  it('needs cleaning for tracking params, short links and removable hidden characters', () => {
    expect(precheckTile('https://ex.com/a?utm_source=x', rules)).toEqual({ kind: 'needs_cleaning' });
    expect(precheckTile('https://bit.ly/abc', rules)).toEqual({ kind: 'needs_cleaning' });
    expect(precheckTile(`https://ex.com/a${ZWSP}b`, rules)).toEqual({ kind: 'needs_cleaning' });
  });

  it('finds the link inside surrounding text', () => {
    expect(precheckTile('look: https://ex.com/a?utm_source=x thanks', rules)).toEqual({ kind: 'needs_cleaning' });
  });
});

describe('decideTileOutcome', () => {
  it('row 1: copied, toast with the count, returns when Untail was not in front', () => {
    const d = decideTileOutcome(facts({ outcome: { result: result({ removed: [removedItem] }), copied: true } }));
    expect(d).toEqual({ row: 1, toast: { kind: 'copied', removed: 1 }, goBack: true, remember: { row: 1, removed: 1, expandedOnly: false } });
  });

  it('row 1: an expansion with nothing removed says expanded', () => {
    const d = decideTileOutcome(facts({ outcome: { result: result({ removed: [] }), copied: true } }));
    expect(d.toast).toEqual({ kind: 'expanded' });
    expect(d.remember).toEqual({ row: 1, removed: 0, expandedOnly: true });
  });

  it('counts a removed hidden character as a change', () => {
    const hidden: ProcessResult['removed'][number] = { key: 'hidden', value: 'U+200B', category: 'hidden', risk: 'low' };
    const d = decideTileOutcome(facts({ outcome: { result: result({ removed: [hidden] }), copied: true } }));
    expect(d.toast).toEqual({ kind: 'copied', removed: 1 });
  });

  it('row 1: stays when Untail was already in front', () => {
    const d = decideTileOutcome(facts({ wasInForeground: true, outcome: { result: result({ removed: [removedItem] }), copied: true } }));
    expect(d.row).toBe(1);
    expect(d.goBack).toBe(false);
    expect(d.toast).toEqual({ kind: 'copied', removed: 1 });
  });

  it('row 2: already clean toasts and returns, nothing else', () => {
    const d = decideTileOutcome(facts({ pre: { kind: 'already_clean', url: 'https://ex.com/a' } }));
    expect(d).toEqual({ row: 2, toast: { kind: 'noTracking' }, goBack: true, remember: { row: 2, removed: 0, expandedOnly: false } });
  });

  it('row 3: no link stays without toast', () => {
    expect(decideTileOutcome(facts({ pre: { kind: 'no_link' } }))).toEqual({ row: 3, toast: null, goBack: false, remember: null });
  });

  it('row 4: unreadable clipboard stays without toast', () => {
    expect(decideTileOutcome(facts({ read: 'unreadable', pre: null }))).toEqual({ row: 4, toast: null, goBack: false, remember: null });
  });

  it('row 5: changed but not copied stays', () => {
    const d = decideTileOutcome(facts({ outcome: { result: result({ removed: [removedItem] }), copied: false } }));
    expect(d).toEqual({ row: 5, toast: null, goBack: false, remember: null });
  });

  it('stays on partial results', () => {
    const d = decideTileOutcome(facts({ outcome: { result: result({ status: 'partial', reason: 'expand_disabled' }), copied: false } }));
    expect(d).toEqual({ row: 6, toast: null, goBack: false, remember: null });
  });

  it('row 6: failed, or a job that returned nothing, stays', () => {
    expect(decideTileOutcome(facts({ outcome: { result: result({ status: 'failed', cleanUrl: '' }), copied: false } })).row).toBe(6);
    expect(decideTileOutcome(facts({ outcome: null })).row).toBe(6);
  });

  it('row 7: an invalid request does nothing, whatever the result', () => {
    const d = decideTileOutcome(facts({ valid: false, outcome: { result: result({ removed: [removedItem] }), copied: true } }));
    expect(d).toEqual({ row: 7, toast: null, goBack: false, remember: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @linkclean/mobile test -- src/lib/tileOutcome.test.ts`
Expected: FAIL — `Failed to resolve import "./tileOutcome"`.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/lib/tileOutcome.ts
import { extractUrlDetailed } from '@linkclean/core';
import type { RuleBundle } from '@linkclean/core';
import type { CleanOutcome } from './cleaner';
import { needsCleaning } from './clipboardWatch';

// Offline check of what the clipboard holds. Unlike decideText it never skips text it has seen:
// tapping the tile is an explicit request.
export type TilePrecheck = { kind: 'no_link' } | { kind: 'already_clean'; url: string } | { kind: 'needs_cleaning' };

export function precheckTile(text: string, rules: RuleBundle): TilePrecheck {
  const found = text.trim() === '' ? null : extractUrlDetailed(text);
  if (!found) return { kind: 'no_link' };
  const dirty = needsCleaning(found.url, rules) || found.hidden.some((h) => h.removed);
  return dirty ? { kind: 'needs_cleaning' } : { kind: 'already_clean', url: found.url };
}

export type TileToast = { kind: 'copied'; removed: number } | { kind: 'expanded' } | { kind: 'noTracking' };

export interface TileFacts {
  read: 'ok' | 'unreadable';
  pre: TilePrecheck | null; // null when the clipboard could not be read
  outcome: CleanOutcome | null; // only for needs_cleaning; null when the job returned nothing
  wasInForeground: boolean; // Untail was in front when the tile was tapped
  valid: boolean; // the request is still the current one
}

export interface TileDecision {
  row: 1 | 2 | 3 | 4 | 5 | 6 | 7; // spec §3.2
  toast: TileToast | null;
  goBack: boolean;
  remember: { row: 1 | 2; removed: number; expandedOnly: boolean } | null;
}

const stay = (row: TileDecision['row']): TileDecision => ({ row, toast: null, goBack: false, remember: null });

export function decideTileOutcome(f: TileFacts): TileDecision {
  if (!f.valid) return stay(7);
  if (f.read === 'unreadable' || f.pre === null) return stay(4);
  if (f.pre.kind === 'no_link') return stay(3);
  if (f.pre.kind === 'already_clean') {
    return { row: 2, toast: { kind: 'noTracking' }, goBack: !f.wasInForeground, remember: { row: 2, removed: 0, expandedOnly: false } };
  }
  const out = f.outcome;
  if (!out || out.result.status !== 'clean') return stay(6);
  if (!out.copied) return stay(5);
  const removed = out.result.removed.length;
  return {
    row: 1,
    toast: removed > 0 ? { kind: 'copied', removed } : { kind: 'expanded' },
    goBack: !f.wasInForeground,
    remember: { row: 1, removed, expandedOnly: removed === 0 },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @linkclean/mobile test -- src/lib/tileOutcome.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
python3 scripts/check-invisible.py apps/mobile/src/lib/tileOutcome.ts apps/mobile/src/lib/tileOutcome.test.ts
git add apps/mobile/src/lib/tileOutcome.ts apps/mobile/src/lib/tileOutcome.test.ts
git commit -m "feat(mobile): decide what a quick settings tile tap does"
```

---

### Task 2: Last tile result storage (`settings.ts`)

**Files:**
- Modify: `apps/mobile/src/lib/settings.ts`
- Test: `apps/mobile/src/lib/settings.test.ts`

**Interfaces:**
- Consumes: `getKv`, `setKv`, `Db` (`src/lib/db.ts`)
- Produces:
  ```ts
  export interface LastTileResult { row: 1 | 2; removed: number; expandedOnly: boolean; at: number }
  export function loadLastTileResult(db: Db): Promise<LastTileResult | null>;
  export function saveLastTileResult(db: Db, r: LastTileResult): Promise<void>;
  export function clearLastTileResult(db: Db): Promise<void>;
  export function formatHm(at: number): string; // local time "HH:mm"
  ```

- [ ] **Step 1: Write the failing tests** — in `apps/mobile/src/lib/settings.test.ts` change the existing imports to

```ts
import { getKv, migrate, setKv } from './db';
import { DEFAULT_SETTINGS, clearLastTileResult, formatHm, loadLastTileResult, loadSettings, saveLastTileResult, saveSettings } from './settings';
```

and append (the file's `beforeEach` already gives a migrated `db`):

```ts
describe('last tile result', () => {
  it('round-trips and never stores a URL', async () => {
    expect(await loadLastTileResult(db)).toBeNull();
    await saveLastTileResult(db, { row: 1, removed: 2, expandedOnly: false, at: 1_700_000_000_000 });
    expect(await loadLastTileResult(db)).toEqual({ row: 1, removed: 2, expandedOnly: false, at: 1_700_000_000_000 });
    expect(await getKv(db, 'lastTileResult')).not.toMatch(/https?:/);
  });

  it('clears', async () => {
    await saveLastTileResult(db, { row: 2, removed: 0, expandedOnly: false, at: 1 });
    await clearLastTileResult(db);
    expect(await loadLastTileResult(db)).toBeNull();
  });

  it('ignores malformed stored values', async () => {
    await setKv(db, 'lastTileResult', '{"row":9}');
    expect(await loadLastTileResult(db)).toBeNull();
    await setKv(db, 'lastTileResult', 'not json');
    expect(await loadLastTileResult(db)).toBeNull();
  });

  it('formats local hours and minutes', () => {
    const at = new Date(2026, 9, 19, 7, 5).getTime();
    expect(formatHm(at)).toBe('07:05');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @linkclean/mobile test -- src/lib/settings.test.ts`
Expected: FAIL — `loadLastTileResult is not a function` (or not exported).

- [ ] **Step 3: Implement** — append to `apps/mobile/src/lib/settings.ts`:

```ts
// The result of the last Quick Settings tile tap, shown on the home screen so a missed toast can be
// checked later. It never contains the link itself.
export interface LastTileResult {
  row: 1 | 2; // spec §3.2: 1 = cleaned and copied, 2 = nothing to clean
  removed: number;
  expandedOnly: boolean;
  at: number;
}

const LAST_TILE_KEY = 'lastTileResult';

export async function loadLastTileResult(db: Db): Promise<LastTileResult | null> {
  const raw = await getKv(db, LAST_TILE_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LastTileResult>;
    if ((v.row !== 1 && v.row !== 2) || typeof v.removed !== 'number' || typeof v.expandedOnly !== 'boolean' || typeof v.at !== 'number') {
      return null;
    }
    return { row: v.row, removed: v.removed, expandedOnly: v.expandedOnly, at: v.at };
  } catch {
    return null;
  }
}

export async function saveLastTileResult(db: Db, r: LastTileResult): Promise<void> {
  await setKv(db, LAST_TILE_KEY, JSON.stringify({ row: r.row, removed: r.removed, expandedOnly: r.expandedOnly, at: r.at }));
}

export async function clearLastTileResult(db: Db): Promise<void> {
  await db.runAsync('DELETE FROM kv WHERE key = ?', LAST_TILE_KEY);
}

export function formatHm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @linkclean/mobile test -- src/lib/settings.test.ts`
Expected: PASS (existing tests plus 4 new).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/settings.ts apps/mobile/src/lib/settings.test.ts
git commit -m "feat(mobile): store the last tile result without the link"
```

---

### Task 3: Copy only when the link changed (`cleaner.ts`)

**Files:**
- Modify: `apps/mobile/src/lib/cleaner.ts` (`CleanDeps` and the copy condition)
- Test: `apps/mobile/src/lib/cleaner.test.ts`

**Interfaces:**
- Produces: `CleanDeps.copyIf?(result: ProcessResult): boolean` — when present, an automatic copy also requires `copyIf(result) === true`.

- [ ] **Step 1: Write the failing tests** — append inside the `describe('cleanInput', () => {` block (line 55) in `cleaner.test.ts`:

```ts
  it('does not copy when copyIf rejects the result', async () => {
    const out = await cleanInput('https://ex.com/a?utm_source=x', deps({ copyIf: () => false }));
    expect(out.copied).toBe(false);
    expect(copied).toEqual([]);
  });

  it('copies when copyIf accepts the result', async () => {
    const out = await cleanInput('https://ex.com/a?utm_source=x', deps({ copyIf: (r) => r.cleanUrl !== 'https://ex.com/a?utm_source=x' }));
    expect(out.copied).toBe(true);
    expect(copied).toEqual(['https://ex.com/a']);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @linkclean/mobile test -- src/lib/cleaner.test.ts`
Expected: FAIL — the first new test copies `https://ex.com/a` (and TypeScript may report `copyIf` unknown in `deps`).

- [ ] **Step 3: Implement** — in `apps/mobile/src/lib/cleaner.ts`, add to `CleanDeps` after `isCurrent?(): boolean;`:

```ts
  // Extra condition for the automatic copy, e.g. the tile copies only when the link actually changed.
  copyIf?(result: ProcessResult): boolean;
```

and change the copy condition to:

```ts
  if (
    result.status === 'clean' &&
    deps.settings.autoCopy &&
    (deps.isCurrent?.() ?? true) &&
    (deps.copyIf?.(result) ?? true)
  ) {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @linkclean/mobile test -- src/lib/cleaner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/cleaner.ts apps/mobile/src/lib/cleaner.test.ts
git commit -m "feat(mobile): let a caller restrict the automatic copy"
```

---

### Task 4: Tile flow orchestration (`tileFlow.ts`)

**Files:**
- Create: `apps/mobile/src/lib/tileFlow.ts`
- Test: `apps/mobile/src/lib/tileFlow.test.ts`

**Interfaces:**
- Consumes: `precheckTile`, `decideTileOutcome`, `TileDecision`, `TileToast` (Task 1); `CleanOutcome` (`cleaner.ts`)
- Produces:
  ```ts
  export interface TileFlowDeps {
    waitForFocus(timeoutMs: number): Promise<boolean>;
    readClipboard(): Promise<string>;
    sleep(ms: number): Promise<void>;
    rules(): RuleBundle;
    clean(text: string, copyIf: (r: ProcessResult) => boolean): Promise<CleanOutcome | null>;
    isValid(): boolean;
    noteSeen(text: string): void;
    showNotice(n: 'no_link' | 'unreadable' | null): void;
    toast(t: TileToast): void;
    moveToBack(): Promise<boolean>;
    remember(r: { row: 1 | 2; removed: number; expandedOnly: boolean }): Promise<void>;
  }
  export const FOCUS_TIMEOUT_MS = 1500;
  export const EMPTY_RETRY_MS = 100;
  export function runTile(wasInForeground: boolean, d: TileFlowDeps): Promise<TileDecision>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/lib/tileFlow.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProcessResult, RuleBundle } from '@linkclean/core';
import type { CleanOutcome } from './cleaner';
import { runTile } from './tileFlow';
import type { TileFlowDeps } from './tileFlow';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: { globalRules: { urlPattern: '.*', rules: ['utm_source'] } },
  expanders: {},
  knowledge: {},
};

const DIRTY = 'https://ex.com/a?utm_source=x';
const CLEAN = 'https://ex.com/a';
const removed: ProcessResult['removed'] = [{ key: 'utm_source', value: 'x', category: 'campaign', risk: 'low' }];

let log: string[];
let clips: string[];
let valid: boolean;
let cleanResult: (text: string, copyIf: (r: ProcessResult) => boolean) => Promise<CleanOutcome | null>;

const deps = (over: Partial<TileFlowDeps> = {}): TileFlowDeps => ({
  waitForFocus: async () => true,
  readClipboard: async () => clips.shift() ?? '',
  sleep: async (ms) => {
    log.push(`sleep ${ms}`);
  },
  rules: () => rules,
  clean: (text, copyIf) => cleanResult(text, copyIf),
  isValid: () => valid,
  noteSeen: (t) => log.push(`seen ${t}`),
  showNotice: (n) => log.push(`notice ${n}`),
  toast: (t) => log.push(`toast ${JSON.stringify(t)}`),
  moveToBack: async () => {
    log.push('back');
    return true;
  },
  remember: async (r) => {
    log.push(`remember ${r.row}`);
  },
  ...over,
});

beforeEach(() => {
  log = [];
  clips = [];
  valid = true;
  cleanResult = async (_text, copyIf) => {
    const result: ProcessResult = { originalUrl: DIRTY, cleanUrl: CLEAN, status: 'clean', removed, hops: [DIRTY] };
    return { result, copied: copyIf(result) };
  };
});

describe('runTile', () => {
  it('returns to the previous app after a cold start, toast first', async () => {
    clips = [DIRTY];
    const d = await runTile(false, deps());
    expect(d.row).toBe(1);
    expect(log).toEqual([`seen ${DIRTY}`, 'notice null', 'remember 1', 'toast {"kind":"copied","removed":1}', 'back']);
  });

  it('stays when Untail was already in front', async () => {
    clips = [DIRTY];
    await runTile(true, deps());
    expect(log).not.toContain('back');
    expect(log).toContain('toast {"kind":"copied","removed":1}');
  });

  it('does not clean or copy an already clean link', async () => {
    clips = [CLEAN];
    let cleaned = false;
    cleanResult = async () => {
      cleaned = true;
      return null;
    };
    const d = await runTile(false, deps());
    expect(d.row).toBe(2);
    expect(cleaned).toBe(false);
    expect(log).toEqual([`seen ${CLEAN}`, 'notice null', 'remember 2', 'toast {"kind":"noTracking"}', 'back']);
  });

  it('copies only when the link changed', async () => {
    clips = [`  ${DIRTY}  `];
    let accepted: boolean | null = null;
    cleanResult = async (_t, copyIf) => {
      const same: ProcessResult = { originalUrl: DIRTY, cleanUrl: DIRTY, status: 'clean', removed: [], hops: [DIRTY] };
      accepted = copyIf(same);
      return { result: same, copied: accepted };
    };
    const d = await runTile(false, deps());
    expect(accepted).toBe(false);
    expect(d.row).toBe(5);
  });

  it('retries once after an empty read, then reports no link', async () => {
    clips = ['', ''];
    const d = await runTile(false, deps());
    expect(d.row).toBe(3);
    expect(log).toEqual(['sleep 100', 'seen ', 'notice no_link']);
  });

  it('uses the second read when the first was empty', async () => {
    clips = ['', DIRTY];
    const d = await runTile(false, deps());
    expect(d.row).toBe(1);
  });

  it('reports unreadable when focus never comes', async () => {
    const d = await runTile(false, deps({ waitForFocus: async () => false }));
    expect(d.row).toBe(4);
    expect(log).toEqual(['notice unreadable']);
  });

  it('reports unreadable when reading throws', async () => {
    const d = await runTile(
      false,
      deps({
        readClipboard: async () => {
          throw new Error('denied');
        },
      }),
    );
    expect(d.row).toBe(4);
  });

  it('a newer request makes the older one invalid', async () => {
    clips = [DIRTY];
    cleanResult = async (_t, copyIf) => {
      valid = false; // a second tap arrived while this one was expanding
      const result: ProcessResult = { originalUrl: DIRTY, cleanUrl: CLEAN, status: 'clean', removed, hops: [DIRTY] };
      return { result, copied: copyIf(result) };
    };
    const d = await runTile(false, deps());
    expect(d.row).toBe(7);
    expect(log.some((l) => l.startsWith('toast') || l === 'back' || l.startsWith('remember'))).toBe(false);
  });

  it('does not go back when the request turns invalid right after the toast', async () => {
    clips = [DIRTY];
    const d = await runTile(
      false,
      deps({
        toast: (t) => {
          log.push(`toast ${JSON.stringify(t)}`);
          valid = false;
        },
      }),
    );
    expect(d.row).toBe(1);
    expect(log).not.toContain('back');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @linkclean/mobile test -- src/lib/tileFlow.test.ts`
Expected: FAIL — `Failed to resolve import "./tileFlow"`.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/lib/tileFlow.ts
import type { ProcessResult, RuleBundle } from '@linkclean/core';
import type { CleanOutcome } from './cleaner';
import { decideTileOutcome, precheckTile } from './tileOutcome';
import type { TileDecision, TileToast } from './tileOutcome';

export const FOCUS_TIMEOUT_MS = 1500;
export const EMPTY_RETRY_MS = 100;

export interface TileFlowDeps {
  waitForFocus(timeoutMs: number): Promise<boolean>;
  readClipboard(): Promise<string>;
  sleep(ms: number): Promise<void>;
  rules(): RuleBundle;
  // Runs the normal cleaning queue; copyIf restricts the automatic copy.
  clean(text: string, copyIf: (r: ProcessResult) => boolean): Promise<CleanOutcome | null>;
  isValid(): boolean;
  noteSeen(text: string): void; // the clipboard watch must not offer this text again
  showNotice(n: 'no_link' | 'unreadable' | null): void;
  toast(t: TileToast): void;
  moveToBack(): Promise<boolean>;
  remember(r: { row: 1 | 2; removed: number; expandedOnly: boolean }): Promise<void>;
}

// Android only lets the focused app read the clipboard, so wait for focus, then read once more if the
// first read came back empty (focus can arrive a moment after the shade closes).
async function readAfterFocus(d: TileFlowDeps): Promise<string | null> {
  const focused = await d.waitForFocus(FOCUS_TIMEOUT_MS).catch(() => false);
  if (!focused) return null;
  try {
    const first = await d.readClipboard();
    if (first !== '') return first;
    await d.sleep(EMPTY_RETRY_MS);
    return await d.readClipboard();
  } catch {
    return null;
  }
}

export async function runTile(wasInForeground: boolean, d: TileFlowDeps): Promise<TileDecision> {
  const text = await readAfterFocus(d);
  if (text !== null) d.noteSeen(text);
  const pre = text === null ? null : precheckTile(text, d.rules());
  let outcome: CleanOutcome | null = null;
  if (text !== null && pre?.kind === 'needs_cleaning') {
    const raw = text.trim();
    outcome = await d.clean(text, (r) => r.status === 'clean' && r.cleanUrl !== raw);
  }
  const decision = decideTileOutcome({ read: text === null ? 'unreadable' : 'ok', pre, outcome, wasInForeground, valid: d.isValid() });
  if (decision.row === 7) return decision;
  d.showNotice(decision.row === 3 ? 'no_link' : decision.row === 4 ? 'unreadable' : null);
  if (decision.remember) await d.remember(decision.remember).catch(() => undefined);
  // Toast first, while Untail is still on screen, so it is not queued behind system toasts.
  if (decision.toast && d.isValid()) d.toast(decision.toast);
  if (decision.goBack && d.isValid()) await d.moveToBack().catch(() => false);
  return decision;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @linkclean/mobile test -- src/lib/tileFlow.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Run the whole mobile suite and typecheck**

Run: `pnpm --filter @linkclean/mobile test && pnpm --filter @linkclean/mobile typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/tileFlow.ts apps/mobile/src/lib/tileFlow.test.ts
git commit -m "feat(mobile): run a tile request through focus, read, clean and return"
```

---

### Task 5: Native module `untail-tile` (Kotlin) and its JS wrapper

**Files (all new, under `apps/mobile/modules/untail-tile/`):**
- `expo-module.config.json`
- `index.ts`
- `android/build.gradle`
- `android/src/main/AndroidManifest.xml`
- `android/src/main/java/com/ttylab/untail/tile/TileLaunchStore.kt`
- `android/src/main/java/com/ttylab/untail/tile/ForegroundTracker.kt`
- `android/src/main/java/com/ttylab/untail/tile/UntailTilePackage.kt`
- `android/src/main/java/com/ttylab/untail/tile/CleanLinkTileService.kt`
- `android/src/main/java/com/ttylab/untail/tile/UntailTileModule.kt`
- `android/src/main/res/values/strings.xml`, `values-b+zh+Hant/strings.xml`, `values-zh-rTW/strings.xml`, `values-ja/strings.xml`
- `android/src/main/res/drawable-nodpi/ic_untail_tile.png`

**Interfaces:**
- Produces (JS, `modules/untail-tile/index.ts`):
  ```ts
  export interface TileLaunch { wasInForeground: boolean }
  export type AddTileResult = 'added' | 'already' | 'dismissed' | 'unsupported';
  export const tileSupported: boolean;
  export function consumeTileLaunch(): TileLaunch | null;
  export function addTileLaunchListener(cb: () => void): { remove(): void };
  export function waitForWindowFocus(timeoutMs: number): Promise<boolean>;
  export function moveTaskToBack(): Promise<boolean>;
  export function requestAddTile(): Promise<AddTileResult>;
  ```
- Produces (Android): service `com.ttylab.untail.tile.CleanLinkTileService`; intent extras `untail_tile_launch` (Boolean) and `untail_tile_was_foreground` (Boolean).

This task has no unit tests (Kotlin needs a device); its test is the build and the emulator check in Steps 9–11.

- [ ] **Step 1: Module config and Gradle**

```json
// apps/mobile/modules/untail-tile/expo-module.config.json
{
  "platforms": ["android"],
  "android": { "modules": ["com.ttylab.untail.tile.UntailTileModule"] }
}
```

```gradle
// apps/mobile/modules/untail-tile/android/build.gradle
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'com.ttylab.untail'
version = '0.1.0'

android {
  namespace "com.ttylab.untail.tile"
  defaultConfig {
    versionCode 1
    versionName '0.1.0'
  }
}
```

- [ ] **Step 2: Manifest**

```xml
<!-- apps/mobile/modules/untail-tile/android/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <!-- BIND_QUICK_SETTINGS_TILE lets only the system bind the tile; it is not a permission users grant. -->
    <service
      android:name="com.ttylab.untail.tile.CleanLinkTileService"
      android:exported="true"
      android:icon="@drawable/ic_untail_tile"
      android:label="@string/untail_tile_label"
      android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
      <intent-filter>
        <action android:name="android.service.quicksettings.action.QS_TILE" />
      </intent-filter>
      <meta-data android:name="android.service.quicksettings.TOGGLEABLE_TILE" android:value="false" />
    </service>
  </application>
</manifest>
```

- [ ] **Step 3: Strings** (four files; `b+zh+Hant` is required because the app's locale filter is `zh-Hant`)

```xml
<!-- values/strings.xml -->
<resources><string name="untail_tile_label">Clean link</string></resources>
```
```xml
<!-- values-b+zh+Hant/strings.xml and values-zh-rTW/strings.xml (same content) -->
<resources><string name="untail_tile_label">清理連結</string></resources>
```
```xml
<!-- values-ja/strings.xml -->
<resources><string name="untail_tile_label">リンクをクリーン</string></resources>
```

- [ ] **Step 4: Icon** — crop the gecko from the adaptive monochrome icon (1024×1024, safe zone in the middle) and scale to 96 px:

```bash
cd apps/mobile
mkdir -p modules/untail-tile/android/src/main/res/drawable-nodpi
sips -c 680 680 assets/monochrome.png --out modules/untail-tile/android/src/main/res/drawable-nodpi/ic_untail_tile.png
sips -Z 96 modules/untail-tile/android/src/main/res/drawable-nodpi/ic_untail_tile.png
sips -g pixelWidth -g pixelHeight modules/untail-tile/android/src/main/res/drawable-nodpi/ic_untail_tile.png
```
Expected: 96 × 96. Open the PNG (Read tool) and confirm the gecko is centred and not cut off; if it is, repeat with a larger crop (for example 760).

- [ ] **Step 5: `TileLaunchStore.kt` and `ForegroundTracker.kt`**

```kotlin
// TileLaunchStore.kt
package com.ttylab.untail.tile

import android.content.Intent
import java.util.concurrent.atomic.AtomicReference

data class TileLaunch(val wasInForeground: Boolean)

// Holds at most one tile request; a newer tap replaces one JS has not taken yet.
object TileLaunchStore {
  const val EXTRA_LAUNCH = "untail_tile_launch"
  const val EXTRA_WAS_FOREGROUND = "untail_tile_was_foreground"

  private val pending = AtomicReference<TileLaunch?>(null)

  @Volatile
  var listener: (() -> Unit)? = null

  fun put(launch: TileLaunch) {
    pending.set(launch)
    listener?.invoke()
  }

  fun consume(): TileLaunch? = pending.getAndSet(null)

  // Removes the tile extras, so a recreated activity does not handle the same tap again.
  // A missing foreground flag counts as "was in front", which keeps Untail open.
  fun takeFrom(intent: Intent?): TileLaunch? {
    if (intent?.getBooleanExtra(EXTRA_LAUNCH, false) != true) return null
    val launch = TileLaunch(intent.getBooleanExtra(EXTRA_WAS_FOREGROUND, true))
    intent.removeExtra(EXTRA_LAUNCH)
    intent.removeExtra(EXTRA_WAS_FOREGROUND)
    return launch
  }
}
```

```kotlin
// ForegroundTracker.kt
package com.ttylab.untail.tile

import android.app.Activity
import android.app.Application
import android.os.Bundle

// Knows whether an Untail activity is started (visible, possibly under the notification shade).
// Pulling the shade down does not stop the activity, so this tells "was in front" apart from
// "another app was in front" at the moment the tile is tapped.
object ForegroundTracker : Application.ActivityLifecycleCallbacks {
  @Volatile
  private var started = 0

  val isStarted: Boolean
    get() = started > 0

  override fun onActivityStarted(activity: Activity) {
    started += 1
  }

  override fun onActivityStopped(activity: Activity) {
    started = maxOf(0, started - 1)
  }

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
  override fun onActivityResumed(activity: Activity) = Unit
  override fun onActivityPaused(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
  override fun onActivityDestroyed(activity: Activity) = Unit
}
```

- [ ] **Step 6: `UntailTilePackage.kt`** (Expo autolinking finds classes implementing `Package`)

```kotlin
package com.ttylab.untail.tile

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class UntailTilePackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        application.registerActivityLifecycleCallbacks(ForegroundTracker)
      }
    })

  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(TileLaunchActivityListener())
}

class TileLaunchActivityListener : ReactActivityLifecycleListener {
  private var activity: WeakReference<Activity>? = null

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    this.activity = WeakReference(activity)
    TileLaunchStore.takeFrom(activity.intent)?.let(TileLaunchStore::put)
  }

  override fun onNewIntent(intent: Intent): Boolean {
    val launch = TileLaunchStore.takeFrom(intent)
    // Also clear the activity's original intent, which getIntent() keeps returning.
    activity?.get()?.intent?.let { TileLaunchStore.takeFrom(it) }
    launch?.let(TileLaunchStore::put)
    return false
  }
}
```

- [ ] **Step 7: `CleanLinkTileService.kt`**

```kotlin
package com.ttylab.untail.tile

import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log

class CleanLinkTileService : TileService() {
  override fun onStartListening() {
    // An action tile, not a switch: always shown as inactive.
    qsTile?.let {
      it.state = Tile.STATE_INACTIVE
      it.updateTile()
    }
  }

  override fun onClick() {
    try {
      // Read before launching: once Untail starts, it is in front either way.
      val wasInForeground = ForegroundTracker.isStarted
      val launch = Runnable { launchUntail(wasInForeground) }
      if (isLocked) unlockAndRun(launch) else launch.run()
    } catch (e: Exception) {
      Log.w(TAG, "tile click failed", e)
    }
  }

  private fun launchUntail(wasInForeground: Boolean) {
    try {
      val component = packageManager.getLaunchIntentForPackage(packageName)?.component ?: return
      // A plain intent to the activity (not the launcher action), so a running singleTask
      // activity receives it through onNewIntent.
      val intent = Intent()
        .setComponent(component)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(TileLaunchStore.EXTRA_LAUNCH, true)
        .putExtra(TileLaunchStore.EXTRA_WAS_FOREGROUND, wasInForeground)
      if (Build.VERSION.SDK_INT >= 34) {
        val mode = if (Build.VERSION.SDK_INT >= 36) {
          ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS
        } else {
          @Suppress("DEPRECATION")
          ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
        }
        val options = ActivityOptions.makeBasic().setPendingIntentCreatorBackgroundActivityStartMode(mode).toBundle()
        val pending = PendingIntent.getActivity(
          this,
          0,
          intent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
          options,
        )
        startActivityAndCollapse(pending)
      } else {
        @Suppress("DEPRECATION")
        startActivityAndCollapse(intent)
      }
    } catch (e: Exception) {
      Log.w(TAG, "could not open Untail from the tile", e)
    }
  }

  private companion object {
    const val TAG = "UntailTile"
  }
}
```

If the build reports `MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS` unresolved, the project's compileSdk is below 36: use `MODE_BACKGROUND_ACTIVITY_START_ALLOWED` for all API levels and record a ruling.

- [ ] **Step 8: `UntailTileModule.kt`**

```kotlin
package com.ttylab.untail.tile

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.ViewTreeObserver
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class UntailTileModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("UntailTile")
    Events("onTileLaunch")

    // The event only says "a request is waiting"; JS takes it with consumeTileLaunch(), exactly once.
    OnCreate { TileLaunchStore.listener = { sendEvent("onTileLaunch", emptyMap<String, Any>()) } }
    OnDestroy { TileLaunchStore.listener = null }

    Function("consumeTileLaunch") {
      TileLaunchStore.consume()?.let { mapOf("wasInForeground" to it.wasInForeground) }
    }

    AsyncFunction("waitForWindowFocus") { timeoutMs: Int, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      if (activity.hasWindowFocus()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val observer = activity.window.decorView.viewTreeObserver
      var done = false
      lateinit var listener: ViewTreeObserver.OnWindowFocusChangeListener
      val finish = { ok: Boolean ->
        if (!done) {
          done = true
          if (observer.isAlive) observer.removeOnWindowFocusChangeListener(listener)
          promise.resolve(ok)
        }
      }
      listener = ViewTreeObserver.OnWindowFocusChangeListener { focused -> if (focused) finish(true) }
      observer.addOnWindowFocusChangeListener(listener)
      main.postDelayed({ finish(activity.hasWindowFocus()) }, timeoutMs.toLong())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("moveTaskToBack") {
      appContext.currentActivity?.moveTaskToBack(true) ?: false
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("requestAddTile") { promise: Promise ->
      val activity = appContext.currentActivity
      if (Build.VERSION.SDK_INT < 33 || activity == null) {
        promise.resolve("unsupported")
        return@AsyncFunction
      }
      val manager = activity.getSystemService(StatusBarManager::class.java)
      if (manager == null) {
        promise.resolve("unsupported")
        return@AsyncFunction
      }
      var settled = false
      val observer = activity.window.decorView.viewTreeObserver
      lateinit var focusListener: ViewTreeObserver.OnWindowFocusChangeListener
      val settle = { result: String ->
        if (!settled) {
          settled = true
          if (observer.isAlive) observer.removeOnWindowFocusChangeListener(focusListener)
          promise.resolve(result)
        }
      }
      // Closing the system dialog with Back or a tap outside never calls back, so regaining focus
      // (after a grace period for a late callback) or a 30 s timeout ends the wait.
      var lostFocus = false
      focusListener = ViewTreeObserver.OnWindowFocusChangeListener { focused ->
        if (!focused) lostFocus = true else if (lostFocus) main.postDelayed({ settle("dismissed") }, 1000)
      }
      observer.addOnWindowFocusChangeListener(focusListener)
      main.postDelayed({ settle("dismissed") }, 30_000)
      try {
        manager.requestAddTileService(
          ComponentName(activity, CleanLinkTileService::class.java),
          activity.getString(R.string.untail_tile_label),
          Icon.createWithResource(activity, R.drawable.ic_untail_tile),
          activity.mainExecutor,
        ) { code ->
          settle(
            when (code) {
              StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "added"
              StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "already"
              StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> "dismissed"
              else -> "unsupported"
            },
          )
        }
      } catch (e: Exception) {
        settle("unsupported")
      }
    }.runOnQueue(Queues.MAIN)
  }
}
```

- [ ] **Step 9: JS wrapper**

```ts
// apps/mobile/modules/untail-tile/index.ts
import { requireOptionalNativeModule } from 'expo';

export interface TileLaunch {
  wasInForeground: boolean; // Untail was in front when the tile was tapped
}

export type AddTileResult = 'added' | 'already' | 'dismissed' | 'unsupported';

interface NativeTile {
  consumeTileLaunch(): TileLaunch | null;
  waitForWindowFocus(timeoutMs: number): Promise<boolean>;
  moveTaskToBack(): Promise<boolean>;
  requestAddTile(): Promise<AddTileResult>;
  addListener(event: 'onTileLaunch', listener: () => void): { remove(): void };
}

// Android only; on iOS every call is a no-op or reports "unsupported".
const native = requireOptionalNativeModule<NativeTile>('UntailTile');

export const tileSupported = native !== null;

export function consumeTileLaunch(): TileLaunch | null {
  try {
    return native?.consumeTileLaunch() ?? null;
  } catch {
    return null;
  }
}

export function addTileLaunchListener(listener: () => void): { remove(): void } {
  return native ? native.addListener('onTileLaunch', listener) : { remove: () => undefined };
}

export async function waitForWindowFocus(timeoutMs: number): Promise<boolean> {
  return native ? native.waitForWindowFocus(timeoutMs) : true;
}

export async function moveTaskToBack(): Promise<boolean> {
  return native ? native.moveTaskToBack() : false;
}

export async function requestAddTile(): Promise<AddTileResult> {
  if (!native) return 'unsupported';
  try {
    return await native.requestAddTile();
  } catch {
    return 'unsupported';
  }
}
```

- [ ] **Step 10: Typecheck, prebuild and release build**

```bash
pnpm --filter @linkclean/mobile typecheck
cd apps/mobile && npx expo prebuild --platform android --no-install
grep -n "untail-tile\|UntailTile" android/settings.gradle android/app/build/generated/autolinking/src/main/java/expo/modules/ExpoModulesPackageList.java 2>/dev/null | head
cd android && ./gradlew createBundleReleaseJsAndAssets --rerun assembleRelease
```
Expected: typecheck clean; the module appears in the autolinking output; `BUILD SUCCESSFUL`. (Use `createBundleReleaseJsAndAssets --rerun` — a plain `assembleRelease` can skip re-bundling JS.)

Check the merged manifest and strings:
```bash
grep -n -A6 "CleanLinkTileService" app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml
AAPT=$(ls -d ~/Library/Android/sdk/build-tools/* | tail -1)/aapt2
$AAPT dump resources app/build/outputs/apk/release/app-release.apk | grep -A6 "string/untail_tile_label"
```
Expected: the service with `BIND_QUICK_SETTINGS_TILE`, the QS_TILE action and `TOGGLEABLE_TILE=false`; label values for default, `b+zh+Hant`, `zh-rTW`, `ja` (all four survive resource shrinking).

- [ ] **Step 11: Emulator smoke test** (`Medium_Phone_API_36.1`, serial `emulator-5554`; start it with `~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_36.1 &` if not running)

```bash
export ANDROID_SERIAL=emulator-5554
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
adb shell cmd statusbar add-tile com.ttylab.untail/com.ttylab.untail.tile.CleanLinkTileService
adb shell input keyevent KEYCODE_HOME
adb shell cmd statusbar click-tile com.ttylab.untail/com.ttylab.untail.tile.CleanLinkTileService
sleep 3
adb shell dumpsys window | grep mCurrentFocus
```
Expected: `mCurrentFocus` is `com.ttylab.untail/com.ttylab.untail.MainActivity` (JS does nothing with the request yet; that is Task 6). If the click does nothing, read `adb logcat -d -s UntailTile` and fix before continuing.

- [ ] **Step 12: Commit**

```bash
git add apps/mobile/modules/untail-tile
git commit -m "feat(android): quick settings tile module"
```

---

### Task 6: Wire the tile into AppContext, layout, home and history

**Files:**
- Modify: `apps/mobile/src/state/AppContext.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/index.tsx`
- Modify: `apps/mobile/app/history.tsx`
- Modify: `apps/mobile/src/i18n/locales/zh-TW.json`, `en.json`, `ja.json`

**Interfaces:**
- Consumes: Task 1 `TileToast`; Task 2 `LastTileResult`, `loadLastTileResult`, `saveLastTileResult`, `clearLastTileResult`, `formatHm`; Task 3 `copyIf`; Task 4 `runTile`; Task 5 `consumeTileLaunch`, `addTileLaunchListener`, `waitForWindowFocus`, `moveTaskToBack`, `TileLaunch`
- Produces (added to `AppState` in `AppContext.tsx`):
  ```ts
  tileNotice: 'no_link' | 'unreadable' | null;
  lastTile: LastTileResult | null;
  clearLastTile(): Promise<void>;
  tileRequests: number; // bumped when a tile request starts
  invalidateTile(): void; // the user did something else; the running tile request must not copy, toast or return
  ```

- [ ] **Step 1: Strings** — add these keys to the three locale files (same keys in each; the existing i18n test enforces it).

`zh-TW.json`:
```json
"tile": {
  "toastCopied": "已複製乾淨連結（移除 {{count}} 項）",
  "toastExpanded": "已展開並複製連結",
  "toastNoTracking": "連結沒有追蹤碼，不用改"
}
```
in `"home"`:
```json
"tileNoLink": "剪貼簿裡沒有連結。",
"tileUnreadable": "讀不到剪貼簿。請再點一次磚，或手動貼上。",
"lastTileCopied": "上次點磚（{{time}}）：已複製乾淨連結，移除 {{count}} 項",
"lastTileExpanded": "上次點磚（{{time}}）：已展開並複製連結",
"lastTileNoTracking": "上次點磚（{{time}}）：連結沒有追蹤碼，不用改"
```

`en.json`:
```json
"tile": {
  "toastCopied": "Clean link copied ({{count}} removed)",
  "toastExpanded": "Link expanded and copied",
  "toastNoTracking": "No tracking codes in this link; nothing to change"
}
```
in `"home"`:
```json
"tileNoLink": "There is no link on the clipboard.",
"tileUnreadable": "Couldn't read the clipboard. Tap the tile again, or paste the link.",
"lastTileCopied": "Last tile tap ({{time}}): clean link copied, {{count}} removed",
"lastTileExpanded": "Last tile tap ({{time}}): link expanded and copied",
"lastTileNoTracking": "Last tile tap ({{time}}): no tracking codes, nothing to change"
```

`ja.json`:
```json
"tile": {
  "toastCopied": "クリーンなリンクをコピーしました（{{count}} 件削除）",
  "toastExpanded": "リンクを展開してコピーしました",
  "toastNoTracking": "追跡コードはありません。変更は不要です"
}
```
in `"home"`:
```json
"tileNoLink": "クリップボードにリンクがありません。",
"tileUnreadable": "クリップボードを読み取れませんでした。もう一度タイルをタップするか、手動で貼り付けてください。",
"lastTileCopied": "前回のタイル（{{time}}）：クリーンなリンクをコピー、{{count}} 件削除",
"lastTileExpanded": "前回のタイル（{{time}}）：リンクを展開してコピー",
"lastTileNoTracking": "前回のタイル（{{time}}）：追跡コードなし、変更は不要"
```

Run: `pnpm --filter @linkclean/mobile test -- src/i18n/i18n.test.ts`
Expected: PASS.

- [ ] **Step 2: AppContext imports and state** — in `apps/mobile/src/state/AppContext.tsx`:

Change the react-native import to:
```ts
import { AppState as RNAppState, Platform, ToastAndroid } from 'react-native';
```
Add imports:
```ts
import { addTileLaunchListener, consumeTileLaunch, moveTaskToBack, waitForWindowFocus } from '../../modules/untail-tile';
import type { TileLaunch } from '../../modules/untail-tile';
import type { ProcessResult } from '@linkclean/core';
import { runTile } from '../lib/tileFlow';
import type { TileToast } from '../lib/tileOutcome';
import { clearLastTileResult, loadLastTileResult, saveLastTileResult } from '../lib/settings';
import type { LastTileResult } from '../lib/settings';
```
Add to `export interface AppState` (after `dismissCleanLinkNotice(): void;`):
```ts
  tileNotice: 'no_link' | 'unreadable' | null;
  lastTile: LastTileResult | null;
  clearLastTile(): Promise<void>;
  tileRequests: number; // bumped when a tile request starts, so the layout returns to the home screen
  invalidateTile(): void;
```
Add a helper above `export function AppProvider`:
```ts
function tileToastText(t: TileToast): string {
  if (t.kind === 'copied') return i18n.t('tile.toastCopied', { count: t.removed });
  return i18n.t(t.kind === 'expanded' ? 'tile.toastExpanded' : 'tile.toastNoTracking');
}
```
Inside `AppProvider`:
- rename the input state: `const [input, setInputState] = useState('');` and replace every internal call `setInput(` inside `AppProvider` with `setInputState(` (in `enqueue` and `checkClipboard`; four places).
- add after `const [cleanClipboardLink, setCleanClipboardLink] = useState<string | null>(null);` (line 76):
```ts
  const [tileNotice, setTileNotice] = useState<'no_link' | 'unreadable' | null>(null);
  const [lastTile, setLastTile] = useState<LastTileResult | null>(null);
  const [tileRequests, setTileRequests] = useState(0);
  const tileSeq = useRef(0);
  // The id of the tile request that may still copy, toast and return; null when none.
  const activeTile = useRef<number | null>(null);
  const readyRef = useRef(false);
  const invalidateTile = useCallback(() => {
    activeTile.current = null;
  }, []);
```

- [ ] **Step 3: `enqueue` modes** — replace the `enqueue` declaration with:

```ts
  type Mode = 'manual' | 'auto' | 'tile';
  interface EnqueueOptions {
    settings?: Settings;
    copyIf?: (r: ProcessResult) => boolean;
    isValid?: () => boolean;
  }
  // Jobs run one at a time. An automatic job (from the clipboard) always copies its clean link,
  // but is dropped once it is stale; a job the user asked for always shows its result. A tile job
  // copies like an automatic one but always shows its result.
  const enqueue = useCallback(
    (text: string, mode: Mode, opts: EnqueueOptions = {}): Promise<CleanOutcome | null> => {
      setInputState(text);
      setCleanClipboardLink(null);
      setAutoCleaned(null);
      pendingJobs.current += 1;
      setPending((n) => n + 1);
      const gen = clipboardGen.current;
      const isCurrent = () => gen === clipboardGen.current && (opts.isValid?.() ?? true);
      const job = queue.current.then(async () => {
        try {
          const { rules: r, locale: l } = latest.current;
          const s = opts.settings ?? latest.current.settings;
          const out = await cleanInput(text, {
            db,
            rules: r,
            settings: mode === 'manual' ? s : { ...s, autoCopy: true },
            locale: l,
            fetch: rnFetch,
            userAgent: USER_AGENT,
            copy: writeClipboard,
            now: Date.now,
            isCurrent,
            copyIf: opts.copyIf,
          });
          if (!isCurrent()) {
            if (mode === 'auto') return null;
            // The screen may show newer clipboard content by now; put the requested link back.
            setInputState(text);
          }
          setOutcome(out);
          return out;
        } catch {
          // cleanInput handles expected failures itself; never let one job stall the queue.
          return null;
        } finally {
          pendingJobs.current -= 1;
          setPending((n) => n - 1);
        }
      });
      queue.current = job.then(() => undefined);
      return job;
    },
    [db, writeClipboard],
  );
```
Update the two existing callers:
```ts
  const submit = useCallback(
    (text: string) => {
      invalidateTile();
      setTileNotice(null);
      return enqueue(text, 'manual').then(() => undefined);
    },
    [enqueue, invalidateTile],
  );
```
and in `checkClipboard`: `const out = await enqueue(d.url, 'auto', { settings: s });`

At the very top of `checkClipboard`'s body (before `if (!s.detectClipboard) return;`) add:
```ts
      // A tile request owns the clipboard while it runs.
      if (activeTile.current !== null) return;
```

- [ ] **Step 4: `startTile`** — add after `recheckClipboard.current = () => void checkClipboard(latest.current.settings);` (line 251):

```ts
  const startTile = useCallback(
    async (launch: TileLaunch) => {
      const id = ++tileSeq.current;
      activeTile.current = id;
      const gen = clipboardGen.current;
      // Leaving the app bumps clipboardGen; a newer tap or any user action clears activeTile.
      const isValid = () => activeTile.current === id && clipboardGen.current === gen;
      setTileRequests((n) => n + 1);
      setClipboardOffer(null);
      setAutoCleaned(null);
      setCleanClipboardLink(null);
      setTileNotice(null);
      try {
        await runTile(launch.wasInForeground, {
          waitForFocus: waitForWindowFocus,
          readClipboard: () => Clipboard.getStringAsync(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          rules: () => latest.current.rules,
          clean: (text, copyIf) => enqueue(text, 'tile', { copyIf, isValid }),
          isValid,
          noteSeen: (text) => {
            if (text !== '') watch.current = noteSelfWrite(watch.current, text);
          },
          showNotice: (n) => {
            if (n !== null) {
              // Never put clipboard text without a link into the input box.
              setInputState('');
              setOutcome(null);
            }
            setTileNotice(n);
          },
          toast: (t) => ToastAndroid.show(tileToastText(t), ToastAndroid.SHORT),
          moveToBack: moveTaskToBack,
          remember: async (r) => {
            const value: LastTileResult = { ...r, at: Date.now() };
            setLastTile(value);
            await saveLastTileResult(db, value);
          },
        });
      } catch {
        // A failed tile request leaves Untail open on the home screen.
      } finally {
        if (activeTile.current === id) activeTile.current = null;
      }
    },
    [db, enqueue],
  );
```

- [ ] **Step 5: Take the request before the clipboard check** — in the startup `useEffect`:

replace
```ts
        [s, r] = await Promise.all([loadSettings(db), loadRules(db, BUNDLED)]);
```
with
```ts
        let last: LastTileResult | null;
        [s, r, last] = await Promise.all([loadSettings(db), loadRules(db, BUNDLED), loadLastTileResult(db).catch(() => null)]);
        setLastTile(last);
```
replace
```ts
      setReady(true);
      void refresh(false);
      void checkClipboard(s);
```
with
```ts
      setReady(true);
      readyRef.current = true;
      void refresh(false);
      const launch = consumeTileLaunch();
      if (launch) void startTile(launch);
      else void checkClipboard(s);
```
in the `'change'` listener replace `void checkClipboard(latest.current.settings);` with
```ts
      const launch = consumeTileLaunch();
      if (launch) void startTile(launch);
      else void checkClipboard(latest.current.settings);
```
add after the `const sub = RNAppState.addEventListener('change', (state) => {` statement (line 270) ends:
```ts
    // Untail was already in front (only the shade covered it), so no 'active' change will come.
    const tileSub = addTileLaunchListener(() => {
      if (!readyRef.current) return;
      const launch = consumeTileLaunch();
      if (launch) void startTile(launch);
    });
```
and in the cleanup add `tileSub.remove();`. Add `startTile` to that effect's dependency array: `[db, refresh, checkClipboard, startTile]`.

- [ ] **Step 6: Expose the new values** — in the `useMemo` value object:
replace `setInput,` with
```ts
      setInput(text: string) {
        invalidateTile();
        setTileNotice(null);
        setInputState(text);
      },
```
and add:
```ts
      tileNotice,
      lastTile,
      async clearLastTile() {
        setLastTile(null);
        await clearLastTileResult(db);
      },
      tileRequests,
      invalidateTile,
```
Add `tileNotice, lastTile, tileRequests, invalidateTile` to the `useMemo` dependency array. (`copy` already bumps `clipboardGen`, which invalidates a running tile request.)

- [ ] **Step 7: Layout watcher** — in `apps/mobile/app/_layout.tsx` change the expo-router import to `import { Link, router, Stack, usePathname } from 'expo-router';`, change `import { useEffect } from 'react';` to `import { useEffect, useRef } from 'react';`, and add next to `ShareWatcher`:

```tsx
// A tile request shows its result on the home screen; leaving the home screen while it runs cancels
// its toast and automatic return.
function TileWatcher() {
  const { tileRequests, invalidateTile } = useApp();
  const pathname = usePathname();
  useEffect(() => {
    if (tileRequests > 0 && router.canDismiss()) router.dismissAll();
  }, [tileRequests]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pathname !== '/') invalidateTile();
  }, [pathname, invalidateTile]);
  return null;
}
```
Render `<TileWatcher />` right next to `<ShareWatcher />`.

- [ ] **Step 8: Home screen** — in `apps/mobile/app/index.tsx` add `tileNotice, lastTile` to the `useApp()` destructuring, import `formatHm` from `'../src/lib/settings'`, and add above the `<TextInput`:

```tsx
      {tileNotice && !busy && (
        <Notice icon="alert-circle-outline" text={t(tileNotice === 'no_link' ? 'home.tileNoLink' : 'home.tileUnreadable')}>
          {null}
        </Notice>
      )}
```
and between `{(busy || !ready) && <ActivityIndicator color={c.accent} />}` (line 130) and the `ResultCard` line:
```tsx
      {lastTile && !busy && !tileNotice && (
        <Text style={{ color: c.muted, fontSize: 12 }}>
          {lastTile.row === 2
            ? t('home.lastTileNoTracking', { time: formatHm(lastTile.at) })
            : lastTile.expandedOnly
              ? t('home.lastTileExpanded', { time: formatHm(lastTile.at) })
              : t('home.lastTileCopied', { time: formatHm(lastTile.at), count: lastTile.removed })}
        </Text>
      )}
```

- [ ] **Step 9: History clear** — in `apps/mobile/app/history.tsx` change `const { db } = useApp();` to `const { db, clearLastTile } = useApp();` and the clear action to:
```tsx
<Pressable onPress={() => confirm(t('history.clearConfirm'), async () => { await clearHistory(db); await clearLastTile(); })}>
```

- [ ] **Step 10: Tests and typecheck**

Run: `pnpm --filter @linkclean/mobile test && pnpm --filter @linkclean/mobile typecheck`
Expected: all pass; no type errors.

- [ ] **Step 11: Emulator end-to-end** (rebuild as in Task 5 Step 10, install, tile already added)

Put a dirty link on the emulator clipboard without touching the Mac clipboard:
```bash
export ANDROID_SERIAL=emulator-5554
adb shell am start -a android.intent.action.VIEW -d about:blank com.android.chrome
sleep 3
adb shell input tap 540 180          # Chrome address bar; adjust from a screenshot if needed
adb shell input text 'https://example.com/a?utm_source=tile_test'
adb shell input keycombination 113 29   # Ctrl+A
adb shell input keycombination 113 31   # Ctrl+C
adb shell input keyevent KEYCODE_ESCAPE
adb shell cmd statusbar click-tile com.ttylab.untail/com.ttylab.untail.tile.CleanLinkTileService
sleep 4
adb shell dumpsys window | grep mCurrentFocus
```
Expected: focus is back on Chrome (Untail returned). Verify the clipboard by pasting into the address bar:
```bash
adb shell input tap 540 180
adb shell input keycombination 113 29
adb shell input keycombination 113 50   # Ctrl+V
adb shell uiautomator dump /sdcard/ui.xml >/dev/null && adb shell cat /sdcard/ui.xml | grep -o 'https://example.com/a[^"]*' | head -1
adb shell rm -f /sdcard/ui.xml
```
Expected: `https://example.com/a` (no `utm_source`). Tap the tile again with the same clean link: Untail opens, toasts "No tracking codes in this link; nothing to change" (or the zh-TW text), returns; the clipboard is unchanged. Open Untail: the "last tile tap" line shows the time and the no-tracking text.

- [ ] **Step 12: Commit**

```bash
python3 scripts/check-invisible.py apps/mobile/src/state/AppContext.tsx apps/mobile/app/_layout.tsx apps/mobile/app/index.tsx
git add apps/mobile/src/state/AppContext.tsx apps/mobile/app/_layout.tsx apps/mobile/app/index.tsx apps/mobile/app/history.tsx apps/mobile/src/i18n/locales
git commit -m "feat(mobile): clean the clipboard link from the quick settings tile"
```

---

### Task 7: Add-tile entry, how-to, privacy texts, version

**Files:**
- Create: `apps/mobile/src/components/useAddTile.ts`
- Modify: `apps/mobile/app/settings.tsx`
- Modify: `apps/mobile/src/components/HowTo.tsx`
- Modify: `apps/mobile/src/i18n/locales/{zh-TW,en,ja}.json`
- Modify: `docs/site/privacy.html`
- Modify: `docs/store/google-play-data-safety.md`
- Modify: `apps/mobile/app.json`

**Interfaces:**
- Consumes: Task 5 `requestAddTile`, `tileSupported`, `AddTileResult`
- Produces: `useAddTile(): { visible: boolean; canPrompt: boolean; added: boolean; request(): Promise<void> }`

- [ ] **Step 1: Strings** — in all three locale files:

zh-TW `"settings"`: `"addTile": "加入快速設定"`, `"addTileHint": "拉下通知列 → 編輯 → 把「清理連結」拖進去。"`, `"addTileAdded": "已加入快速設定"`
en `"settings"`: `"addTile": "Add to Quick Settings"`, `"addTileHint": "Pull down the notification shade → Edit → drag “Clean link” into place."`, `"addTileAdded": "Added to Quick Settings"`
ja `"settings"`: `"addTile": "クイック設定に追加"`, `"addTileHint": "通知パネルを下ろす → 編集 → 「リンクをクリーン」をドラッグして追加します。"`, `"addTileAdded": "クイック設定に追加しました"`

`"howto"` in all three: change `"title"` to `"使用方式"` / `"How to use it"` / `"使い方"`, and add
- zh-TW: `"tile": "複製連結後，拉下通知列點「清理連結」磚，回到原本的 App 直接貼上。"`
- en: `"tile": "After copying a link, pull down the notification shade and tap the “Clean link” tile, then paste in the original app."`
- ja: `"tile": "リンクをコピーしたら、通知パネルを下ろして「リンクをクリーン」タイルをタップし、元のアプリで貼り付けます。"`

Privacy, append to `"privacy"."p3"`:
- zh-TW: `點「清理連結」快速設定磚處理短網址時，也會進行這個展開。`
- en: ` This also happens when you clean a short link with the “Clean link” Quick Settings tile.`
- ja: `「リンクをクリーン」クイック設定タイルで短縮 URL を処理するときも、この展開を行います。`

append to `"privacy"."p5"`:
- zh-TW: `點「清理連結」快速設定磚時，即使「偵測剪貼簿中的連結」是關閉的，App 也會開啟並讀取剪貼簿；連結有追蹤碼或隱藏字元時會直接換成乾淨連結，是否存入歷史紀錄依設定。`
- en: ` When you tap the “Clean link” Quick Settings tile, the app opens and reads the clipboard even if “Detect links on the clipboard” is off; a link with tracking codes or hidden characters is replaced with the clean link, and saved to history only if “Keep history” is on.`
- ja: `「リンクをクリーン」クイック設定タイルをタップすると、「クリップボードのリンクを検出」がオフでもアプリが開いてクリップボードを読み取り、追跡コードや見えない文字を含むリンクはクリーンなリンクに置き換えます。履歴への保存は設定に従います。`

Run: `pnpm --filter @linkclean/mobile test -- src/i18n/i18n.test.ts` → PASS.

- [ ] **Step 2: `useAddTile.ts`**

```ts
// apps/mobile/src/components/useAddTile.ts
import { useState } from 'react';
import { Platform } from 'react-native';
import { requestAddTile, tileSupported } from '../../modules/untail-tile';

// Android 13+ can show the system "add tile" dialog; older versions only get written steps.
export function useAddTile() {
  const [added, setAdded] = useState(false);
  const visible = Platform.OS === 'android' && tileSupported;
  const canPrompt = visible && Number(Platform.Version) >= 33;
  const request = async () => {
    if (!canPrompt) return;
    const result = await requestAddTile();
    if (result === 'added' || result === 'already') setAdded(true);
  };
  return { visible, canPrompt, added, request };
}
```

- [ ] **Step 3: Settings row** — in `apps/mobile/app/settings.tsx` import `useAddTile` from `'../src/components/useAddTile'`, call `const addTile = useAddTile();` in the component, and add after the `autoClipboard` row:

```tsx
      {addTile.visible && (
        <View style={[styles.block, { backgroundColor: c.card, borderColor: c.border }]}>
          {addTile.canPrompt && (
            <Pressable disabled={addTile.added} onPress={() => void addTile.request()}>
              <Text style={{ color: c.accent, opacity: addTile.added ? 0.5 : 1 }}>
                {addTile.added ? t('settings.addTileAdded') : t('settings.addTile')}
              </Text>
            </Pressable>
          )}
          {!addTile.canPrompt && <Text style={{ color: c.text }}>{t('settings.addTile')}</Text>}
          <Text style={{ color: c.muted, fontSize: 12 }}>{t('settings.addTileHint')}</Text>
        </View>
      )}
```

- [ ] **Step 4: HowTo fourth step** — in `apps/mobile/src/components/HowTo.tsx` import `useAddTile` from `'./useAddTile'`, call `const addTile = useAddTile();`, and add after step 3:

```tsx
      {addTile.visible &&
        step(
          4,
          <>
            <Text style={{ color: c.text, lineHeight: 20 }}>{t('howto.tile')}</Text>
            {addTile.canPrompt && !addTile.added ? (
              <Pressable onPress={() => void addTile.request()} style={[styles.button, { borderColor: c.accent }]}>
                <Text style={{ color: c.accent, fontWeight: '700' }}>{t('settings.addTile')}</Text>
              </Pressable>
            ) : (
              <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>
                {addTile.added ? t('settings.addTileAdded') : t('settings.addTileHint')}
              </Text>
            )}
          </>,
        )}
```

- [ ] **Step 5: Website privacy policy** — in `docs/site/privacy.html`, append the same sentences as Step 1 to the end of the matching `<li>` (before `</li>`): the short-link expansion item `(2)` and the clipboard item, in each of the `zh`, `en` and `ja` sections (six edits). Then:

```bash
grep -c "清理連結" docs/site/privacy.html     # expect 2
grep -c "Clean link" docs/site/privacy.html    # expect 2
grep -c "リンクをクリーン" docs/site/privacy.html  # expect 2
```

- [ ] **Step 6: Data safety note** — append to `docs/store/google-play-data-safety.md`:

```markdown
## 0.1.3 — Quick Settings tile

- The "Clean link" tile reads the clipboard only after the user taps it and Untail is in front.
- Clipboard content is processed on the device and not sent anywhere, except short-link expansion,
  which is already declared (web browsing history, optional, not shared).
- No new data type or purpose: the form stays as it is.
```

- [ ] **Step 7: Version** — in `apps/mobile/app.json` set `"version": "0.1.3"` and `"versionCode": 5`. Check for other copies: `grep -rn '0\.1\.2' apps/mobile --include=*.json --include=*.ts --include=*.tsx -l | grep -v node_modules` and update any user-visible version string found (record a ruling if none).

- [ ] **Step 8: Tests, typecheck, build**

Run: `pnpm --filter @linkclean/mobile test && pnpm --filter @linkclean/mobile typecheck`, then rebuild (Task 5 Step 10).
Expected: all pass; build succeeds.

- [ ] **Step 9: Emulator check** — install the build; open Settings in Untail; tap "Add to Quick Settings" (API 36 shows the system dialog); choose Add → the row shows "Added to Quick Settings". Repeat with Back on the dialog → nothing shown, no hang (the row stays tappable). The home how-to shows step 4.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/components/useAddTile.ts apps/mobile/app/settings.tsx apps/mobile/src/components/HowTo.tsx apps/mobile/src/i18n/locales docs/site/privacy.html docs/store/google-play-data-safety.md apps/mobile/app.json
git commit -m "feat(mobile): add-tile entry, how-to step, privacy text; version 0.1.3 (5)"
```

---

### Task 8: Device verification

**Files:**
- Create: `docs/superpowers/notes/2026-10-19-qs-tile-device-tests.md`

No code. Every check runs on: emulator API 33, API 34, API 36; Xperia 5 II (Android 12), Xperia 1 V (Android 15), LG V35 (Android 10 at the time of testing), vivo V2514 (Android 16, OriginOS 6).

- [ ] **Step 1: Emulators for API 33 and 34** — ask the user before downloading (about 3 GB):

```bash
SDK=~/Library/Android/sdk
$SDK/cmdline-tools/latest/bin/sdkmanager "system-images;android-33;google_apis;arm64-v8a" "system-images;android-34;google_apis;arm64-v8a"
$SDK/cmdline-tools/latest/bin/avdmanager create avd -n Tile_API_33 -k "system-images;android-33;google_apis;arm64-v8a" -d pixel_6
$SDK/cmdline-tools/latest/bin/avdmanager create avd -n Tile_API_34 -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_6
```

- [ ] **Step 2: Install on each device**
- Emulators, Xperia 5 II, Xperia 1 V, LG V35: `adb -s <serial> install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk` (only where Untail was not installed from Play; ask the user before uninstalling anything).
- vivo (Untail installed from Play): upload the 0.1.3 AAB to the Play internal-testing track and update through Play; the user does the upload.

- [ ] **Step 3: Run the checklist on every device** and record pass/fail and observations in the notes file:

| # | Check | Expected |
|---|---|---|
| 1 | Add the tile (13+: system dialog; also close it with Back) | Added; Back does not hang the settings row |
| 2 | Cold start: force-stop Untail, copy a dirty link in another app, tap tile | Toast "已複製乾淨連結（移除 1 項）", back in the other app, clipboard clean |
| 3 | Warm start: same with Untail in recents | Same as 2 |
| 4 | Already clean link | Toast "連結沒有追蹤碼，不用改", back, clipboard unchanged, no history row |
| 5 | Plain text on clipboard | Stays on Untail home with "剪貼簿裡沒有連結。"; input box empty |
| 6 | Short link (bit.ly or a Threads share link) | Expanded, copied, back |
| 7 | Short link with "展開短網址" off | Stays, result card shows partial |
| 8 | Locked screen, tap tile | Asks to unlock, then runs |
| 9 | Untail open on home / Settings / History, pull shade, tap tile | Goes to home, shows result, does not leave Untail |
| 10 | Tap tile twice quickly on a short link | One result; at most one toast and one return |
| 11 | Leave Untail while a short link expands | No toast, no return, clipboard not overwritten |
| 12 | Return target | The app that was in front, never the launcher (acceptance gate) |
| 13 | System toasts seen | Record "pasted from clipboard" and clipboard preview behaviour |
| 14 | Tile label in zh-TW / en / ja system language | 清理連結 / Clean link / リンクをクリーン |
| 15 | Home "last tile tap" line after 2 and 4; gone after clearing history | As described |

- [ ] **Step 4: Fix and re-test** — any failure on rows 2, 3, 4, 12 is a blocker: debug with `adb logcat -s UntailTile ReactNativeJS`, fix with a failing test first where the cause is in TypeScript, re-run the affected rows on all devices.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/notes/2026-10-19-qs-tile-device-tests.md
git commit -m "docs: quick settings tile device test results"
```
