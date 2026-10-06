# LinkClean Plan 2: Expo Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出 iOS + Android 的 Expo App：從其他 App 分享或貼上連結 → 用 `@linkclean/core` 清理 → 顯示結果與追蹤碼說明 → 複製 / 分享 / 開啟；含本機歷史紀錄、設定、規則包更新、zh-TW / en / ja 三語介面，並能在 iOS 模擬器與 Android 模擬器上建置啟動。

**Architecture:** `apps/mobile` 是 pnpm workspace 內的 Expo SDK 57 + Expo Router App。所有可測試的邏輯放在 `src/lib/`（純 TypeScript，不 import React Native），以注入的介面取得 SQLite、fetch、剪貼簿、雜湊函式，用 Vitest 在 Node 上測（SQLite 用 Node 內建 `node:sqlite` 模擬）。`app/` 與 `src/components/` 是薄薄的 UI 層，不寫 UI 自動化測試，改以 typecheck、Metro 打包檢查、模擬器建置與實機手動檢查清單把關（spec §7）。

**Tech Stack:** Expo SDK 57、Expo Router、expo-share-intent 8、expo-sqlite、expo-clipboard、expo-localization、expo-crypto、i18next + react-i18next、Vitest、`node:sqlite`（測試用）。

**Spec:** `docs/superpowers/specs/2026-10-06-link-cleaner-design.md`

**範圍：** spec §6（App）、§5.3（App 端規則更新）、§1.4 的隱私原則、§9 中的隱私政策頁面。Plan 1 最終審查延後的「App 載入規則包要驗證」在 Task 1 + Task 4 處理。上架送審（EAS Build / Submit、商店素材、Apple / Google 帳號）不在本計畫範圍。

## Spec 偏差（本計畫決定，Task 9 同步更新 spec）

- §2「規則快取：`expo-file-system`」→ 改存 SQLite 的 `kv` 表：App 已經用 SQLite，少一個依賴與一套 API
- §6.5 歷史表多存 `reason`、`hops_json` 兩欄：從歷史點進去才能顯示完整結果卡片（spec §6.1 要求）
- §6.1「左滑刪除」→ 長按刪除；「點開 bottom sheet 看說明」→ 點擊就地展開說明：都不需要額外的手勢 / sheet 套件（**待用戶確認**；若要照 spec 原樣，另加一個 task）
- §6.1 設定頁的「隱私政策」改為 App 內建頁面，不依賴 `SITE_BASE_URL`（GitHub Pages 建好前也看得到）

## Global Constraints

- App 名稱 `LinkClean`、scheme `linkclean`、iOS bundle ID / Android package `com.linkclean.app`（暫定，上架前可改）
- 不使用任何第三方分析 / 廣告 / 崩潰回報 SDK（spec §1.4）
- `src/lib/**` 不可 import `react-native`、`expo-*` 或 React；平台能力一律從參數注入
- 規則包遠端網址由 `src/config.ts` 的 `SITE_BASE_URL` 提供；**空字串代表停用遠端更新**，App 只用內建規則包（GitHub repo 建好前就是這個狀態）
- Android 關閉系統備份（`allowBackup: false`），歷史紀錄不會進 Google Drive 備份
- 展開請求的 User-Agent：`LinkClean/<app version>`，不可用瀏覽器 UA
- 自動複製只在 `status === 'clean'` 且設定開啟時發生；`partial` 一律不自動複製（spec §6.3）
- 歷史最多 200 筆；關閉歷史時不寫入、既有紀錄保留（spec §6.5）
- 規則更新：啟動與回到前景時檢查，距上次**完成的**檢查 ≥ 24 小時才連網；`sha256` 與快取不同（或快取損毀）才下載；下載後驗證 sha256 與 `validateBundle`，任何失敗都靜默沿用現有規則（spec §5.3）
- 分享進來的內容在設定與規則載入完成後才處理，且依序一次處理一個
- 介面語言：`zh*` → zh-TW、`ja*` → ja、其他 → en（沿用 core 的 `resolveLocale`）
- 程式碼註解用英文；使用者可見文字只放在 `src/i18n/locales/*.json`
- 每個 commit 訊息結尾加：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **遠端規則包內容壞掉**（缺 `urlPattern`、expander `match` 無法編譯、`expanders` 是空的、`schemaVersion` 不支援）→ 不可採用，沿用目前規則；測試在 Task 1、Task 4。
2. **分享的時機**：冷啟動時在設定載入前就收到分享、在設定頁時收到分享、連續快速分享兩次 → 都要用使用者的設定處理、回到首頁顯示、每次分享只處理一次且結果不互相覆蓋；Task 7 的 `ShareWatcher` + 佇列處理，Task 9 用 adb 與手動清單驗證。
3. **SQLite 快取裡的規則包 JSON 損毀** → 回到內建規則包，不可當掉；測試在 Task 4。
4. **剪貼簿內容不是網址**（一般文字、空字串）→ 顯示「找不到有效網址」，不寫入歷史、不複製；測試在 Task 5。
5. **設定 JSON 損毀或缺欄位** → 用預設值補齊，不可當掉；測試在 Task 3。

---

## File Structure

```
trackurlapp/
├── .npmrc                              # node-linker=hoisted (Expo + pnpm)
├── packages/core/src/validate.ts       # validateBundle() (new)
├── docs/site/privacy.html              # privacy policy, zh-TW / en / ja
├── docs/testing/device-checklist.md    # manual device checklist
└── apps/mobile/
    ├── package.json  app.json  tsconfig.json  vitest.config.ts
    ├── scripts/sync-rules.mjs          # copy rules/dist/rules.json → assets/
    ├── assets/rules.json               # bundled rule snapshot (committed)
    ├── app/
    │   ├── _layout.tsx                 # providers + stack
    │   ├── +native-intent.ts           # route share-extension deep links to "/"
    │   ├── index.tsx                   # home: input, paste, clean, result
    │   ├── history.tsx
    │   ├── result/[id].tsx             # history entry detail
    │   ├── settings.tsx
    │   ├── privacy.tsx                 # in-app privacy policy
    │   └── licenses.tsx
    └── src/
        ├── config.ts                   # SITE_BASE_URL, user agent
        ├── lib/
        │   ├── db.ts                   # Db interface, schema, history, kv
        │   ├── settings.ts
        │   ├── rulesStore.ts           # loadRules / updateRules
        │   ├── cleaner.ts              # cleanInput()
        │   ├── rnFetch.ts              # FetchFn adapter over global fetch
        │   ├── testing/nodeDb.ts       # node:sqlite adapter (tests only)
        │   └── *.test.ts
        ├── state/AppContext.tsx        # wires lib/ to expo modules
        ├── components/ResultCard.tsx
        ├── theme.ts
        └── i18n/
            ├── index.ts
            ├── i18n.test.ts
            └── locales/{zh-TW,en,ja}.json
```

---

### Task 1: Core — fail-closed regex compile + `validateBundle`

**Files:**
- Modify: `packages/core/src/regex.ts`
- Create: `packages/core/src/validate.ts`
- Modify: `packages/core/src/index.ts`, `rules/src/build.ts`
- Test: `packages/core/test/regex.test.ts`, `packages/core/test/validate.test.ts`

**Interfaces:**
- Consumes: `RuleBundle`（types）、`compile`（regex）
- Produces:
  - `compile(src, flags?)`：`src` 不是字串時回傳 `null`（原本會變成 `new RegExp(undefined)`，對所有網址成立）
  - `validateBundle(data: unknown): string[]`（空陣列 = 可採用），由 `index.ts` 匯出

`validateBundle` 檢查 core 會讀到的**每一個欄位**，避免壞資料讓 core 在執行中 throw：
- 是物件；`schemaVersion === 1`；`version` 是字串；`providers` / `expanders` / `knowledge` 是物件
- provider：有字串 `urlPattern`；`rules` / `rawRules` / `referralMarketing` / `exceptions` / `redirections` 若存在必須是字串陣列
- expander：`match` 是字串且可編譯；`loginWall` 若存在必須是 `{ match: 可編譯字串, param: 字串 }`；`normalizeHost` 若存在必須是值皆為字串的物件；`shareId` 若存在必須是字串；`expanders` 不可為空（空的話分享連結會被誤判為 clean）
- knowledge：每筆是物件，`category` / `risk` 是合法列舉值，`desc` 是值皆為字串的物件，`owner` 若存在是字串
- provider 的 `urlPattern` 或規則 regex 編譯失敗**不算錯誤**（core 本來就會略過）

- [ ] **Step 1: 寫失敗測試**

在 `packages/core/test/regex.test.ts` 的 `describe('compile', ...)` 內加入：
```ts
  it('returns null for non-string patterns from broken remote data', () => {
    expect(compile(undefined as unknown as string)).toBeNull();
    expect(compile(42 as unknown as string)).toBeNull();
  });
```

`packages/core/test/validate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateBundle } from '../src/validate';

const valid = () => ({
  schemaVersion: 1,
  version: '2026.10.06.0000',
  providers: { globalRules: { urlPattern: '.*', rules: ['utm_source'] } },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/' } },
  knowledge: {},
});

describe('validateBundle', () => {
  it('accepts a well-formed bundle', () => {
    expect(validateBundle(valid())).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(validateBundle(null)).toEqual(['bundle is not an object']);
    expect(validateBundle([])).toEqual(['bundle is not an object']);
  });

  it('rejects unsupported schema versions and missing sections', () => {
    expect(validateBundle({ ...valid(), schemaVersion: 2 })).toEqual(['unsupported schemaVersion 2']);
    expect(validateBundle({ ...valid(), knowledge: undefined })).toEqual(['knowledge must be an object']);
  });

  it('rejects providers without a urlPattern', () => {
    const b = valid();
    (b.providers as Record<string, unknown>).broken = { rules: ['id'] };
    expect(validateBundle(b)).toEqual(['providers.broken: missing urlPattern']);
  });

  it('tolerates provider patterns that fail to compile', () => {
    const b = valid();
    (b.providers as Record<string, unknown>).odd = { urlPattern: '(' };
    expect(validateBundle(b)).toEqual([]);
  });

  it('rejects expanders whose match cannot compile', () => {
    expect(validateBundle({ ...valid(), expanders: { x: { match: '(' } } })).toEqual(['expanders.x: invalid match']);
  });

  it('rejects an empty expander set', () => {
    expect(validateBundle({ ...valid(), expanders: {} })).toEqual(['expanders is empty']);
  });

  it('rejects provider rule fields that are not string arrays', () => {
    const b = valid();
    (b.providers as Record<string, unknown>).bad = { urlPattern: '.*', exceptions: 42, rules: ['ok', 1] };
    expect(validateBundle(b)).toEqual(['providers.bad.rules: must be a string array', 'providers.bad.exceptions: must be a string array']);
  });

  it('rejects malformed optional expander fields', () => {
    const b = { ...valid(), expanders: { x: { match: '^https://x/', loginWall: { match: '(' }, normalizeHost: { a: 1 }, shareId: 5 } } };
    expect(validateBundle(b)).toEqual(['expanders.x.loginWall: invalid', 'expanders.x.normalizeHost: invalid', 'expanders.x.shareId: invalid']);
  });

  it('rejects malformed knowledge entries', () => {
    const b = {
      ...valid(),
      knowledge: {
        ok: { category: 'campaign', risk: 'low', desc: { en: 'x' } },
        nodesc: { category: 'campaign', risk: 'low' },
        badcat: { category: 'nope', risk: 'low', desc: {} },
      },
    };
    expect(validateBundle(b)).toEqual(['knowledge.nodesc: invalid entry', 'knowledge.badcat: invalid entry']);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm --filter @linkclean/core exec vitest run regex validate`
Expected: `validate.test.ts` FAIL（找不到 `../src/validate`）；regex 新測試 FAIL（`compile(undefined)` 回傳 RegExp）

- [ ] **Step 3: 實作**

`packages/core/src/regex.ts` 的 `compile` 開頭加入型別防護：
```ts
// Rules come from remote data; a bad pattern must never crash the app.
export function compile(src: string, flags = 'i'): RegExp | null {
  // Remote data may omit a pattern; new RegExp(undefined) would match everything.
  if (typeof src !== 'string') return null;
  const key = `${flags}\u0000${src}`;
```
（其餘不變）

`packages/core/src/validate.ts`:
```ts
import { compile } from './regex';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isStrMap = (v: unknown) => isObj(v) && Object.values(v).every((x) => typeof x === 'string');
const isPattern = (v: unknown) => typeof v === 'string' && compile(v) !== null;

const RULE_FIELDS = ['rules', 'rawRules', 'referralMarketing', 'exceptions', 'redirections'] as const;
const CATEGORIES = ['sharer_id', 'ad_click', 'affiliate', 'campaign', 'session', 'unknown'];
const RISKS = ['high', 'medium', 'low'];

// Validates a bundle obtained at runtime: every field core reads must have the type core expects.
// Any error means: keep the previous bundle.
export function validateBundle(data: unknown): string[] {
  if (!isObj(data)) return ['bundle is not an object'];
  const errors: string[] = [];
  if (data.schemaVersion !== 1) errors.push(`unsupported schemaVersion ${String(data.schemaVersion)}`);
  if (typeof data.version !== 'string') errors.push('version must be a string');
  for (const field of ['providers', 'expanders', 'knowledge'] as const) {
    if (!isObj(data[field])) errors.push(`${field} must be an object`);
  }
  if (errors.length) return errors;

  for (const [name, p] of Object.entries(data.providers as Record<string, unknown>)) {
    if (!isObj(p) || typeof p.urlPattern !== 'string') {
      errors.push(`providers.${name}: missing urlPattern`);
      continue;
    }
    for (const f of RULE_FIELDS) {
      if (p[f] !== undefined && !isStrArr(p[f])) errors.push(`providers.${name}.${f}: must be a string array`);
    }
  }

  const expanders = Object.entries(data.expanders as Record<string, unknown>);
  if (expanders.length === 0) errors.push('expanders is empty');
  for (const [name, e] of expanders) {
    if (!isObj(e) || !isPattern(e.match)) {
      errors.push(`expanders.${name}: invalid match`);
      continue;
    }
    const wall = e.loginWall;
    if (wall !== undefined && !(isObj(wall) && isPattern(wall.match) && typeof wall.param === 'string')) {
      errors.push(`expanders.${name}.loginWall: invalid`);
    }
    if (e.normalizeHost !== undefined && !isStrMap(e.normalizeHost)) errors.push(`expanders.${name}.normalizeHost: invalid`);
    if (e.shareId !== undefined && typeof e.shareId !== 'string') errors.push(`expanders.${name}.shareId: invalid`);
  }

  for (const [key, k] of Object.entries(data.knowledge as Record<string, unknown>)) {
    const ok =
      isObj(k) &&
      CATEGORIES.includes(k.category as string) &&
      RISKS.includes(k.risk as string) &&
      isStrMap(k.desc) &&
      (k.owner === undefined || typeof k.owner === 'string');
    if (!ok) errors.push(`knowledge.${key}: invalid entry`);
  }
  return errors;
}
```

`packages/core/src/index.ts` 最後加一行：
```ts
export { validateBundle } from './validate';
```

`rules/src/build.ts`：import 加上 `validateBundle`，並在 `const bundle = buildBundle(...)` 之後立刻驗證：
```ts
import { validateBundle } from '@linkclean/core';
```
```ts
  const bundleErrors = validateBundle(bundle);
  if (bundleErrors.length) throw new Error(`built bundle is invalid:\n${bundleErrors.join('\n')}`);
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm test && pnpm typecheck && pnpm build:rules && pnpm test:regression`
Expected: 全部 PASS；`built rules ...` 正常輸出

- [ ] **Step 5: Commit**

```bash
git add packages/core rules/src/build.ts
git commit -m "feat(core): fail closed on non-string patterns and add validateBundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scaffold the Expo app in the workspace

**Files:**
- Create: `.npmrc`
- Modify: `.gitignore`, `package.json`（root scripts）
- Create: `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/tsconfig.json`, `apps/mobile/vitest.config.ts`
- Create: `apps/mobile/scripts/sync-rules.mjs`, `apps/mobile/assets/rules.json`（產生）
- Create: `apps/mobile/src/config.ts`, `apps/mobile/app/_layout.tsx`（暫時版）, `apps/mobile/app/index.tsx`（暫時版）

**Interfaces:**
- Consumes: `@linkclean/core`（workspace）、`rules/dist/rules.json`（Plan 1 的建置產物）
- Produces:
  - `SITE_BASE_URL: string`（`''` = 停用遠端更新；之後填 `https://<user>.github.io/<repo>/`，結尾要有 `/`）
  - `USER_AGENT: string`（`LinkClean/<app.json version>`）
  - `pnpm --filter @linkclean/mobile sync-rules`、`test`、`typecheck`、`bundle-check`
  - `assets/rules.json`：內建規則包快照

這個 task 只有設定與暫時畫面，驗證方式是 typecheck + Metro 打包能成功解析 workspace 的 `@linkclean/core`（沒有可寫的單元測試）。

- [ ] **Step 1: workspace 設定**

`.npmrc`（Expo 的 Metro 在 pnpm 預設的 isolated 安裝下容易解析失敗；hoisted 是 Expo 文件建議的 pnpm 設定）:
```
node-linker=hoisted
```

`.gitignore` 追加：
```
apps/mobile/ios/
apps/mobile/android/
apps/mobile/.expo/
apps/mobile/.expo-export-check/
apps/mobile/expo-env.d.ts
```

root `package.json` 的 `scripts` 加入：
```json
    "mobile": "pnpm --filter @linkclean/mobile"
```

- [ ] **Step 2: 建立 App 套件與依賴**

`apps/mobile/package.json`:
```json
{
  "name": "@linkclean/mobile",
  "version": "0.1.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "ios": "expo run:ios",
    "android": "expo run:android",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit -p .",
    "sync-rules": "node scripts/sync-rules.mjs",
    "bundle-check": "expo export --platform ios --platform android --output-dir .expo-export-check"
  },
  "dependencies": {
    "@linkclean/core": "workspace:*"
  }
}
```

Run（`expo install` 會依 SDK 57 選相容版本）:
```bash
cd apps/mobile
pnpm add expo@~57.0.26
pnpm exec expo install react react-native expo-router expo-share-intent expo-sqlite expo-clipboard expo-localization expo-crypto expo-constants expo-linking expo-status-bar react-native-safe-area-context react-native-screens i18next react-i18next
pnpm exec expo install typescript @types/react -- --save-dev
pnpm add -D vitest @types/node
cd ../..
pnpm install
pnpm test
```
Expected: 安裝成功；Plan 1 的測試在 hoisted 安裝下仍全部通過（core、rules；mobile 還沒有測試，`--passWithNoTests` 讓它不失敗）

- [ ] **Step 3: App 設定檔**

`apps/mobile/app.json`:
```json
{
  "expo": {
    "name": "LinkClean",
    "slug": "linkclean",
    "scheme": "linkclean",
    "version": "0.1.0",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "ios": {
      "bundleIdentifier": "com.linkclean.app",
      "supportsTablet": true
    },
    "android": {
      "package": "com.linkclean.app",
      "allowBackup": false
    },
    "plugins": [
      "expo-router",
      ["expo-localization", { "supportedLocales": ["zh-Hant", "en", "ja"] }],
      [
        "expo-share-intent",
        {
          "iosActivationRules": {
            "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
            "NSExtensionActivationSupportsWebPageWithMaxCount": 1,
            "NSExtensionActivationSupportsText": true
          },
          "androidIntentFilters": ["text/*"]
        }
      ]
    ]
  }
}
```

`apps/mobile/tsconfig.json`:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
  "exclude": ["node_modules", ".expo-export-check"]
}
```

`apps/mobile/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
```

`apps/mobile/scripts/sync-rules.mjs`:
```js
// Copies the built rule bundle into the app as the offline fallback snapshot.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../../rules/dist/rules.json', import.meta.url));
const destDir = fileURLToPath(new URL('../assets/', import.meta.url));
if (!existsSync(src)) {
  console.error('rules/dist/rules.json missing: run `pnpm build:rules` first');
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, `${destDir}rules.json`);
console.log(`bundled rules updated from ${src}`);
```

`apps/mobile/src/config.ts`:
```ts
import Constants from 'expo-constants';

// Base URL of the GitHub Pages site that hosts rules.json, rules.meta.json and privacy.html.
// Must end with "/". Empty string disables remote rule updates (bundled rules only).
export const SITE_BASE_URL = '';

export const USER_AGENT = `LinkClean/${Constants.expoConfig?.version ?? '0'}`;
```

暫時的 `apps/mobile/app/_layout.tsx`（Task 7 會整個取代）:
```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack />;
}
```

暫時的 `apps/mobile/app/index.tsx`（Task 7 會整個取代；這裡 import core 是為了驗證 Metro 能解析 workspace 套件）:
```tsx
import { DEFAULT_USER_AGENT } from '@linkclean/core';
import { Text, View } from 'react-native';

export default function Home() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>LinkClean ({DEFAULT_USER_AGENT})</Text>
    </View>
  );
}
```

- [ ] **Step 4: 驗證**

Run:
```bash
pnpm build:rules
pnpm mobile sync-rules
pnpm mobile typecheck
pnpm mobile bundle-check
```
Expected:
- `bundled rules updated from ...`，`apps/mobile/assets/rules.json` 存在
- typecheck 無錯誤
- `expo export` 成功輸出 iOS 與 Android bundle（代表 Metro 能解析 `@linkclean/core` 的 TypeScript 原始碼）

若 `expo export` 回報找不到 `@linkclean/core` 或無法轉譯其 `.ts`：在 `apps/mobile/metro.config.js` 用 `expo/metro-config` 的 `getDefaultConfig(__dirname)`，把 `watchFolders` 設為 workspace 根目錄，記錄 Ruling 後再跑一次。

- [ ] **Step 5: Commit**

```bash
git add .npmrc .gitignore package.json pnpm-lock.yaml apps/mobile
git commit -m "feat(mobile): scaffold Expo SDK 57 app in the workspace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Storage — SQLite schema, history, settings

**Files:**
- Create: `apps/mobile/src/lib/db.ts`, `apps/mobile/src/lib/settings.ts`, `apps/mobile/src/lib/testing/nodeDb.ts`
- Test: `apps/mobile/src/lib/db.test.ts`, `apps/mobile/src/lib/settings.test.ts`

**Interfaces:**
- Consumes: `ProcessResult`, `Status`, `Reason`（`@linkclean/core`）
- Produces:
  - `type SqlParam = string | number | null`
  - `interface Db { execAsync(sql): Promise<void>; runAsync(sql, ...params: SqlParam[]): Promise<unknown>; getAllAsync<T>(sql, ...params): Promise<T[]>; getFirstAsync<T>(sql, ...params): Promise<T | null> }`（expo-sqlite `SQLiteDatabase` 的子集）
  - `HISTORY_LIMIT = 200`
  - `migrate(db: Db): Promise<void>`（可重複執行）
  - `interface HistoryEntry { id: number; createdAt: number; result: ProcessResult }`
  - `addHistory(db, result: ProcessResult, now: number): Promise<void>`（寫入後只留最新 200 筆）
  - `listHistory(db): Promise<HistoryEntry[]>`（新到舊）
  - `getHistory(db, id: number): Promise<HistoryEntry | null>`
  - `deleteHistory(db, id: number): Promise<void>`、`clearHistory(db): Promise<void>`
  - `getKv(db, key): Promise<string | null>`、`setKv(db, key, value: string): Promise<void>`
  - `interface Settings { expand: boolean; autoCopy: boolean; history: boolean }`
  - `DEFAULT_SETTINGS: Settings`（全部 `true`）
  - `loadSettings(db): Promise<Settings>`、`saveSettings(db, s: Settings): Promise<void>`
  - `nodeDb(): Db`（測試用，`node:sqlite` 記憶體資料庫）

- [ ] **Step 1: 寫測試輔助與失敗測試**

`apps/mobile/src/lib/testing/nodeDb.ts`:
```ts
// Test-only Db backed by Node's built-in SQLite, mirroring the expo-sqlite async API.
import { DatabaseSync } from 'node:sqlite';
import type { Db, SqlParam } from '../db';

export function nodeDb(): Db {
  const d = new DatabaseSync(':memory:');
  return {
    async execAsync(sql: string) {
      d.exec(sql);
    },
    async runAsync(sql: string, ...params: SqlParam[]) {
      return d.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, ...params: SqlParam[]) {
      return d.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: SqlParam[]) {
      return (d.prepare(sql).get(...params) as T | undefined) ?? null;
    },
  };
}
```

`apps/mobile/src/lib/db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProcessResult } from '@linkclean/core';
import { addHistory, clearHistory, deleteHistory, getHistory, getKv, HISTORY_LIMIT, listHistory, migrate, setKv } from './db';
import type { Db } from './db';
import { nodeDb } from './testing/nodeDb';

const result = (n: number, extra: Partial<ProcessResult> = {}): ProcessResult => ({
  originalUrl: `https://ex.com/${n}?utm_source=x`,
  cleanUrl: `https://ex.com/${n}`,
  status: 'clean',
  removed: [{ key: 'utm_source', value: 'x', category: 'campaign', risk: 'low', desc: 'utm' }],
  hops: [`https://ex.com/${n}?utm_source=x`],
  ...extra,
});

let db: Db;
beforeEach(async () => {
  db = nodeDb();
  await migrate(db);
});

describe('migrate', () => {
  it('can run twice', async () => {
    await expect(migrate(db)).resolves.toBeUndefined();
  });
});

describe('history', () => {
  it('lists newest first and round-trips the full result', async () => {
    await addHistory(db, result(1), 1000);
    await addHistory(db, result(2, { status: 'partial', reason: 'network', hops: ['a', 'b'] }), 2000);
    const list = await listHistory(db);
    expect(list.map((e) => e.result.cleanUrl)).toEqual(['https://ex.com/2', 'https://ex.com/1']);
    expect(list[0]).toMatchObject({ createdAt: 2000, result: { status: 'partial', reason: 'network', hops: ['a', 'b'] } });
    expect(list[1]!.result).toEqual(result(1));
  });

  it(`keeps only the newest ${HISTORY_LIMIT} entries`, async () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) await addHistory(db, result(i), i);
    const list = await listHistory(db);
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list.at(-1)!.result.cleanUrl).toBe('https://ex.com/5');
  });

  it('gets, deletes and clears entries', async () => {
    await addHistory(db, result(1), 1);
    await addHistory(db, result(2), 2);
    const [newest] = await listHistory(db);
    expect((await getHistory(db, newest!.id))!.result.cleanUrl).toBe('https://ex.com/2');
    await deleteHistory(db, newest!.id);
    expect(await getHistory(db, newest!.id)).toBeNull();
    await clearHistory(db);
    expect(await listHistory(db)).toEqual([]);
  });
});

describe('kv', () => {
  it('returns null for missing keys and overwrites existing ones', async () => {
    expect(await getKv(db, 'a')).toBeNull();
    await setKv(db, 'a', '1');
    await setKv(db, 'a', '2');
    expect(await getKv(db, 'a')).toBe('2');
  });
});
```

`apps/mobile/src/lib/settings.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, setKv } from './db';
import type { Db } from './db';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { nodeDb } from './testing/nodeDb';

let db: Db;
beforeEach(async () => {
  db = nodeDb();
  await migrate(db);
});

describe('settings', () => {
  it('defaults to everything on', async () => {
    expect(await loadSettings(db)).toEqual({ expand: true, autoCopy: true, history: true });
    expect(DEFAULT_SETTINGS).toEqual({ expand: true, autoCopy: true, history: true });
  });

  it('saves and loads', async () => {
    await saveSettings(db, { expand: false, autoCopy: true, history: false });
    expect(await loadSettings(db)).toEqual({ expand: false, autoCopy: true, history: false });
  });

  it('falls back to defaults on corrupted JSON', async () => {
    await setKv(db, 'settings', '{not json');
    expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing or non-boolean fields with defaults', async () => {
    await setKv(db, 'settings', JSON.stringify({ expand: false, autoCopy: 'no' }));
    expect(await loadSettings(db)).toEqual({ expand: false, autoCopy: true, history: true });
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm mobile test`
Expected: FAIL（找不到 `./db`、`./settings`）

- [ ] **Step 3: 實作**

`apps/mobile/src/lib/db.ts`:
```ts
import type { AnalyzedParam, ProcessResult, Reason, Status } from '@linkclean/core';

export type SqlParam = string | number | null;

// Async subset of expo-sqlite's SQLiteDatabase, so this module stays testable on node:sqlite.
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlParam[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SqlParam[]): Promise<T | null>;
}

export const HISTORY_LIMIT = 200;

export interface HistoryEntry {
  id: number;
  createdAt: number;
  result: ProcessResult;
}

interface HistoryRow {
  id: number;
  created_at: number;
  original_url: string;
  clean_url: string;
  status: string;
  reason: string | null;
  removed_json: string;
  hops_json: string;
}

export async function migrate(db: Db): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      original_url TEXT NOT NULL,
      clean_url TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      removed_json TEXT NOT NULL,
      hops_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
}

function toEntry(row: HistoryRow): HistoryEntry {
  const result: ProcessResult = {
    originalUrl: row.original_url,
    cleanUrl: row.clean_url,
    status: row.status as Status,
    removed: JSON.parse(row.removed_json) as AnalyzedParam[],
    hops: JSON.parse(row.hops_json) as string[],
  };
  if (row.reason) result.reason = row.reason as Reason;
  return { id: row.id, createdAt: row.created_at, result };
}

export async function addHistory(db: Db, result: ProcessResult, now: number): Promise<void> {
  await db.runAsync(
    'INSERT INTO history (created_at, original_url, clean_url, status, reason, removed_json, hops_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    now,
    result.originalUrl,
    result.cleanUrl,
    result.status,
    result.reason ?? null,
    JSON.stringify(result.removed),
    JSON.stringify(result.hops),
  );
  await db.runAsync('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)', HISTORY_LIMIT);
}

export async function listHistory(db: Db): Promise<HistoryEntry[]> {
  const rows = await db.getAllAsync<HistoryRow>('SELECT * FROM history ORDER BY id DESC');
  return rows.map(toEntry);
}

export async function getHistory(db: Db, id: number): Promise<HistoryEntry | null> {
  const row = await db.getFirstAsync<HistoryRow>('SELECT * FROM history WHERE id = ?', id);
  return row ? toEntry(row) : null;
}

export async function deleteHistory(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM history WHERE id = ?', id);
}

export async function clearHistory(db: Db): Promise<void> {
  await db.runAsync('DELETE FROM history');
}

export async function getKv(db: Db, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setKv(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
```

`apps/mobile/src/lib/settings.ts`:
```ts
import { getKv, setKv } from './db';
import type { Db } from './db';

export interface Settings {
  expand: boolean;
  autoCopy: boolean;
  history: boolean;
}

export const DEFAULT_SETTINGS: Settings = { expand: true, autoCopy: true, history: true };

const KEY = 'settings';

export async function loadSettings(db: Db): Promise<Settings> {
  const raw = await getKv(db, KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const out = { ...DEFAULT_SETTINGS };
  if (typeof parsed === 'object' && parsed !== null) {
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

export async function saveSettings(db: Db, s: Settings): Promise<void> {
  await setKv(db, KEY, JSON.stringify(s));
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm mobile test && pnpm mobile typecheck`
Expected: db、settings 測試全部 PASS；typecheck 無錯誤

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib
git commit -m "feat(mobile): add SQLite history, key-value store and settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rule bundle loading and remote update

**Files:**
- Create: `apps/mobile/src/lib/rulesStore.ts`
- Test: `apps/mobile/src/lib/rulesStore.test.ts`

**Interfaces:**
- Consumes: `validateBundle`, `RuleBundle`（core）；`Db`, `getKv`, `setKv`（Task 3）
- Produces:
  - `CHECK_INTERVAL_MS = 86_400_000`
  - `interface UpdateDeps { db: Db; baseUrl: string; fetchText(url: string): Promise<string>; sha256(text: string): Promise<string>; now: number }`
  - `type UpdateOutcome = 'disabled' | 'throttled' | 'up-to-date' | 'updated' | 'failed'`
  - `loadRules(db: Db, bundled: RuleBundle): Promise<RuleBundle>`（快取有效就用快取，否則內建；永不 throw）
  - `updateRules(deps: UpdateDeps, opts?: { force?: boolean }): Promise<UpdateOutcome>`（永不 throw）

快取格式：kv 的 `rules.cache` 存一筆 `{"sha256": "...", "text": "<rules.json 原文>"}`。**規則與雜湊寫在同一筆**，不會出現一半更新的狀態。

行為（spec §5.3）：
1. `baseUrl` 空字串 → `disabled`
2. 非 `force` 且距上次**完成的檢查**（結果是 `up-to-date` 或 `updated`）不到 24 小時 → `throttled`。失敗不記錄時間，下次啟動 / 回到前景會再試（Ruling：失敗的代價只是一個很小的 meta 請求，不該因一次網路錯誤停更 24 小時）
3. 取 `<baseUrl>rules.meta.json`；`schemaVersion !== 1` 或沒有 `sha256` → `failed`
4. 快取存在、內容通過 `validateBundle`、快取的 sha256 等於 meta，**且重新計算快取原文的雜湊也相符** → 記錄檢查時間，`up-to-date`。任何一項不符就當作沒有快取，重新下載（快取損毀能自我修復）
5. 取 `<baseUrl>rules.json`；雜湊不符、JSON 無效、`validateBundle` 有錯 → `failed`，快取不變
6. 成功 → 一次寫入快取 → 記錄檢查時間 → `updated`
7. 任何例外（含 SQLite 讀寫失敗）→ `failed`

- [ ] **Step 1: 寫失敗測試**

`apps/mobile/src/lib/rulesStore.test.ts`:
```ts
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RuleBundle } from '@linkclean/core';
import { getKv, migrate, setKv } from './db';
import type { Db } from './db';
import { CHECK_INTERVAL_MS, loadRules, updateRules } from './rulesStore';
import type { UpdateDeps } from './rulesStore';
import { nodeDb } from './testing/nodeDb';

const BASE = 'https://example.github.io/linkclean/';
const shaSync = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const sha = async (t: string) => shaSync(t);
const NOW = CHECK_INTERVAL_MS * 10;

const bundle = (version: string): RuleBundle => ({
  schemaVersion: 1,
  version,
  providers: { globalRules: { urlPattern: '.*', rules: ['utm_source'] } },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/' } },
  knowledge: {},
});
const BUNDLED = bundle('bundled');

function site(rules: unknown, meta?: Record<string, unknown>, opts: { rulesFails?: boolean } = {}) {
  const text = typeof rules === 'string' ? rules : JSON.stringify(rules);
  const m = meta ?? { schemaVersion: 1, version: 'remote', sha256: shaSync(text) };
  const calls: string[] = [];
  const fetchText = async (url: string) => {
    calls.push(url);
    if (url === `${BASE}rules.meta.json`) return JSON.stringify(m);
    if (url === `${BASE}rules.json` && !opts.rulesFails) return text;
    throw new Error(`fetch failed: ${url}`);
  };
  return { fetchText, calls, sha256: String(m.sha256) };
}

let db: Db;
beforeEach(async () => {
  db = nodeDb();
  await migrate(db);
});

const deps = (fetchText: UpdateDeps['fetchText'], now = NOW, over: Partial<UpdateDeps> = {}): UpdateDeps => ({
  db,
  baseUrl: BASE,
  fetchText,
  sha256: sha,
  now,
  ...over,
});

describe('loadRules', () => {
  it('uses the bundled rules when nothing is cached', async () => {
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
  });

  it('falls back to bundled rules when the cache is corrupted or invalid', async () => {
    await setKv(db, 'rules.cache', '{broken');
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
    const bad = JSON.stringify({ ...bundle('x'), expanders: {} });
    await setKv(db, 'rules.cache', JSON.stringify({ sha256: shaSync(bad), text: bad }));
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
  });
});

describe('updateRules', () => {
  it('is disabled without a base URL', async () => {
    expect(await updateRules(deps(site(bundle('r')).fetchText, NOW, { baseUrl: '' }))).toBe('disabled');
  });

  it('downloads, verifies and caches a new bundle', async () => {
    expect(await updateRules(deps(site(bundle('remote')).fetchText))).toBe('updated');
    expect((await loadRules(db, BUNDLED)).version).toBe('remote');
  });

  it('throttles completed checks for 24 hours unless forced', async () => {
    const s = site(bundle('remote'));
    await updateRules(deps(s.fetchText));
    s.calls.length = 0;
    expect(await updateRules(deps(s.fetchText, NOW + CHECK_INTERVAL_MS - 1))).toBe('throttled');
    expect(s.calls).toEqual([]);
    expect(await updateRules(deps(s.fetchText, NOW + 1), { force: true })).toBe('up-to-date');
  });

  it('skips the download when the cached bundle matches', async () => {
    const s = site(bundle('remote'));
    await updateRules(deps(s.fetchText));
    s.calls.length = 0;
    expect(await updateRules(deps(s.fetchText), { force: true })).toBe('up-to-date');
    expect(s.calls).toEqual([`${BASE}rules.meta.json`]);
  });

  it('repairs a corrupted cache even when its stored hash matches', async () => {
    const s = site(bundle('remote'));
    await updateRules(deps(s.fetchText));
    await setKv(db, 'rules.cache', JSON.stringify({ sha256: s.sha256, text: '{broken' }));
    expect(await updateRules(deps(s.fetchText), { force: true })).toBe('updated');
    expect((await loadRules(db, BUNDLED)).version).toBe('remote');
  });

  it('rejects a bundle whose hash does not match', async () => {
    const s = site(bundle('remote'), { schemaVersion: 1, version: 'remote', sha256: 'deadbeef' });
    expect(await updateRules(deps(s.fetchText))).toBe('failed');
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
  });

  it('rejects a structurally invalid bundle', async () => {
    expect(await updateRules(deps(site({ ...bundle('remote'), expanders: {} }).fetchText))).toBe('failed');
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
  });

  it('rejects unsupported meta schema versions', async () => {
    const s = site(bundle('remote'), { schemaVersion: 2, version: 'remote', sha256: 'x' });
    expect(await updateRules(deps(s.fetchText))).toBe('failed');
  });

  it('does not throttle after a failed check', async () => {
    expect(await updateRules(deps(site(bundle('remote'), undefined, { rulesFails: true }).fetchText))).toBe('failed');
    expect(await getKv(db, 'rules.checkedAt')).toBeNull();
    expect(await updateRules(deps(site(bundle('remote')).fetchText))).toBe('updated');
  });

  it('reports storage errors as failed instead of throwing', async () => {
    const broken: Db = {
      ...db,
      getFirstAsync: async () => {
        throw new Error('disk I/O error');
      },
    };
    expect(await updateRules(deps(site(bundle('remote')).fetchText, NOW, { db: broken }))).toBe('failed');
    expect(await loadRules(broken, BUNDLED)).toBe(BUNDLED);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm mobile exec vitest run rulesStore`
Expected: FAIL（找不到 `./rulesStore`）

- [ ] **Step 3: 實作**

`apps/mobile/src/lib/rulesStore.ts`:
```ts
import { validateBundle } from '@linkclean/core';
import type { RuleBundle } from '@linkclean/core';
import { getKv, setKv } from './db';
import type { Db } from './db';

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Bundle text and its hash live in one record so they can never diverge.
const K_CACHE = 'rules.cache';
const K_CHECKED = 'rules.checkedAt';

export interface UpdateDeps {
  db: Db;
  baseUrl: string; // "" disables remote updates
  fetchText(url: string): Promise<string>;
  sha256(text: string): Promise<string>;
  now: number;
}

export type UpdateOutcome = 'disabled' | 'throttled' | 'up-to-date' | 'updated' | 'failed';

interface Cached {
  sha256: string;
  text: string;
  bundle: RuleBundle;
}

async function readCache(db: Db): Promise<Cached | null> {
  const raw = await getKv(db, K_CACHE);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as { sha256?: unknown; text?: unknown };
    if (typeof rec.sha256 !== 'string' || typeof rec.text !== 'string') return null;
    const data: unknown = JSON.parse(rec.text);
    return validateBundle(data).length ? null : { sha256: rec.sha256, text: rec.text, bundle: data as RuleBundle };
  } catch {
    return null;
  }
}

export async function loadRules(db: Db, bundled: RuleBundle): Promise<RuleBundle> {
  try {
    return (await readCache(db))?.bundle ?? bundled;
  } catch {
    return bundled;
  }
}

export async function updateRules(deps: UpdateDeps, opts: { force?: boolean } = {}): Promise<UpdateOutcome> {
  const { db, baseUrl, now } = deps;
  if (!baseUrl) return 'disabled';
  try {
    const last = Number((await getKv(db, K_CHECKED)) ?? 0);
    if (!opts.force && now - last < CHECK_INTERVAL_MS) return 'throttled';

    const meta = JSON.parse(await deps.fetchText(`${baseUrl}rules.meta.json`)) as Record<string, unknown>;
    if (meta.schemaVersion !== 1 || typeof meta.sha256 !== 'string') return 'failed';

    const cached = await readCache(db);
    if (cached && cached.sha256 === meta.sha256 && (await deps.sha256(cached.text)) === meta.sha256) {
      await setKv(db, K_CHECKED, String(now));
      return 'up-to-date';
    }

    const text = await deps.fetchText(`${baseUrl}rules.json`);
    if ((await deps.sha256(text)) !== meta.sha256) return 'failed';
    if (validateBundle(JSON.parse(text)).length) return 'failed';

    await setKv(db, K_CACHE, JSON.stringify({ sha256: meta.sha256, text }));
    await setKv(db, K_CHECKED, String(now));
    return 'updated';
  } catch {
    return 'failed';
  }
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm mobile test && pnpm mobile typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib
git commit -m "feat(mobile): load cached rule bundle and update it from the site

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cleaning service and fetch adapter

**Files:**
- Create: `apps/mobile/src/lib/cleaner.ts`, `apps/mobile/src/lib/rnFetch.ts`
- Test: `apps/mobile/src/lib/cleaner.test.ts`, `apps/mobile/src/lib/rnFetch.test.ts`

**Interfaces:**
- Consumes: `processUrl`, `FetchFn`, `ProcessResult`, `RuleBundle`（core）；`Db`, `addHistory`（Task 3）；`Settings`（Task 3）
- Produces:
  - `interface CleanDeps { db: Db; rules: RuleBundle; settings: Settings; locale: string; fetch: FetchFn; userAgent: string; copy(text: string): Promise<unknown>; now(): number }`
  - `interface CleanOutcome { result: ProcessResult; copied: boolean }`
  - `cleanInput(input: string, deps: CleanDeps): Promise<CleanOutcome>`
  - `rnFetch: FetchFn`（包裝 global `fetch`，`redirect: 'follow'`）

行為：
- `failed`（沒有網址）→ 不寫歷史、不複製
- 其他結果 → 歷史開啟時寫入
- 只有 `clean` 且 `autoCopy` 開啟才複製；`copied` 只在複製真的成功時為 `true`
- 寫歷史或複製失敗都不影響回傳的清理結果
- `settings.expand` 直接傳給 `processUrl` 的 `expand`

- [ ] **Step 1: 寫失敗測試**

`apps/mobile/src/lib/cleaner.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { FetchFn, RuleBundle } from '@linkclean/core';
import { cleanInput } from './cleaner';
import type { CleanDeps } from './cleaner';
import { listHistory, migrate } from './db';
import type { Db } from './db';
import { DEFAULT_SETTINGS } from './settings';
import { nodeDb } from './testing/nodeDb';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: {
    globalRules: { urlPattern: '.*', rules: ['utm_source'] },
    threads: { urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?threads\\.com(?:[/:?#]|$)', rules: ['xmt'] },
  },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/', shareId: '/share/([^/?#]+)' } },
  knowledge: {},
};

const SHARE = 'https://www.threads.com/share/BAAtest0001/';
const POST = 'https://www.threads.com/@a/post/B?xmt=1';

let db: Db;
let copied: string[];
let fetchCalls: string[];
const fetch: FetchFn = async (url) => {
  fetchCalls.push(url);
  return { url: POST, status: 200 };
};

const deps = (over: Partial<CleanDeps> = {}): CleanDeps => ({
  db,
  rules,
  settings: { ...DEFAULT_SETTINGS },
  locale: 'en',
  fetch,
  userAgent: 'LinkClean/test',
  copy: async (t) => {
    copied.push(t);
  },
  now: () => 1234,
  ...over,
});

beforeEach(async () => {
  db = nodeDb();
  await migrate(db);
  copied = [];
  fetchCalls = [];
});

describe('cleanInput', () => {
  it('copies and records a clean result', async () => {
    const out = await cleanInput('https://ex.com/a?utm_source=x', deps());
    expect(out).toMatchObject({ copied: true, result: { status: 'clean', cleanUrl: 'https://ex.com/a' } });
    expect(copied).toEqual(['https://ex.com/a']);
    expect((await listHistory(db)).map((e) => e.createdAt)).toEqual([1234]);
  });

  it('records but never auto-copies a partial result', async () => {
    const out = await cleanInput(SHARE, deps({ settings: { ...DEFAULT_SETTINGS, expand: false } }));
    expect(out).toMatchObject({ copied: false, result: { status: 'partial', reason: 'expand_disabled' } });
    expect(copied).toEqual([]);
    expect(fetchCalls).toEqual([]);
    expect(await listHistory(db)).toHaveLength(1);
  });

  it('expands share links with the injected fetch', async () => {
    const out = await cleanInput(SHARE, deps());
    expect(out.result).toMatchObject({ status: 'clean', cleanUrl: 'https://www.threads.com/@a/post/B' });
    expect(fetchCalls).toEqual([SHARE]);
  });

  it('ignores input without a URL', async () => {
    const out = await cleanInput('just some text', deps());
    expect(out).toMatchObject({ copied: false, result: { status: 'failed', reason: 'invalid_input' } });
    expect(await listHistory(db)).toEqual([]);
    expect(copied).toEqual([]);
  });

  it('still returns the result when history or clipboard writes fail', async () => {
    const broken: Db = {
      ...db,
      runAsync: async () => {
        throw new Error('disk full');
      },
    };
    const out = await cleanInput('https://ex.com/a?utm_source=x', deps({
      db: broken,
      copy: async () => {
        throw new Error('clipboard denied');
      },
    }));
    expect(out).toMatchObject({ copied: false, result: { status: 'clean', cleanUrl: 'https://ex.com/a' } });
  });

  it('respects the history and auto-copy switches', async () => {
    const out = await cleanInput('https://ex.com/a?utm_source=x', deps({ settings: { expand: true, autoCopy: false, history: false } }));
    expect(out.copied).toBe(false);
    expect(copied).toEqual([]);
    expect(await listHistory(db)).toEqual([]);
  });
});
```

`apps/mobile/src/lib/rnFetch.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rnFetch } from './rnFetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rnFetch', () => {
  it('forwards method, headers and signal, follows redirects, and reports the final URL', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: unknown) => {
      seen.push([url, init]);
      return { url: 'https://final.example/', status: 200 };
    });
    const signal = new AbortController().signal;
    const r = await rnFetch('https://bit.ly/x', { method: 'HEAD', headers: { 'User-Agent': 'LinkClean/test' }, signal });
    expect(r).toEqual({ url: 'https://final.example/', status: 200 });
    expect(seen).toEqual([['https://bit.ly/x', { method: 'HEAD', headers: { 'User-Agent': 'LinkClean/test' }, signal, redirect: 'follow' }]]);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm mobile exec vitest run cleaner rnFetch`
Expected: FAIL（找不到 `./cleaner`、`./rnFetch`）

- [ ] **Step 3: 實作**

`apps/mobile/src/lib/rnFetch.ts`:
```ts
import type { FetchFn } from '@linkclean/core';

// The platform fetch follows redirects itself; we only need the final URL and status.
export const rnFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, signal: init.signal, redirect: 'follow' });
  return { url: res.url, status: res.status };
};
```

`apps/mobile/src/lib/cleaner.ts`:
```ts
import { processUrl } from '@linkclean/core';
import type { FetchFn, ProcessResult, RuleBundle } from '@linkclean/core';
import { addHistory } from './db';
import type { Db } from './db';
import type { Settings } from './settings';

export interface CleanDeps {
  db: Db;
  rules: RuleBundle;
  settings: Settings;
  locale: string;
  fetch: FetchFn;
  userAgent: string;
  copy(text: string): Promise<unknown>;
  now(): number;
}

export interface CleanOutcome {
  result: ProcessResult;
  copied: boolean;
}

export async function cleanInput(input: string, deps: CleanDeps): Promise<CleanOutcome> {
  const result = await processUrl(input, deps.rules, {
    expand: deps.settings.expand,
    locale: deps.locale,
    fetch: deps.fetch,
    userAgent: deps.userAgent,
  });
  if (result.status === 'failed') return { result, copied: false };

  // Side effects are best-effort: a storage or clipboard failure must never hide the cleaned result.
  if (deps.settings.history) {
    try {
      await addHistory(deps.db, result, deps.now());
    } catch {
      // history is optional
    }
  }
  let copied = false;
  // Only a fully clean URL is copied automatically (spec §6.3).
  if (result.status === 'clean' && deps.settings.autoCopy) {
    try {
      await deps.copy(result.cleanUrl);
      copied = true;
    } catch {
      copied = false;
    }
  }
  return { result, copied };
}
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm mobile test && pnpm mobile typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib
git commit -m "feat(mobile): add cleaning service and fetch adapter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Localization (zh-TW / en / ja)

**Files:**
- Create: `apps/mobile/src/i18n/locales/zh-TW.json`, `en.json`, `ja.json`
- Create: `apps/mobile/src/i18n/index.ts`
- Test: `apps/mobile/src/i18n/i18n.test.ts`

**Interfaces:**
- Consumes: `resolveLocale`（core）；`expo-localization` 的 `getLocales()`
- Produces:
  - `locale: 'zh-TW' | 'en' | 'ja'`（App 啟動時決定一次）
  - 已初始化的 i18next（`useTranslation()` 可用）
  - 翻譯 key：見下方 JSON；`result.reason.<Reason>`、`category.<Category>`、`risk.<Risk>`、`settings.update.<UpdateOutcome>` 對應 core / Task 4 的列舉值

- [ ] **Step 1: 寫失敗測試**

`apps/mobile/src/i18n/i18n.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./locales/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

const locales = { 'zh-TW': flatten(load('zh-TW')), en: flatten(load('en')), ja: flatten(load('ja')) };

describe('locale files', () => {
  it('share the same keys', () => {
    const keys = Object.keys(locales.en).sort();
    expect(Object.keys(locales['zh-TW']).sort()).toEqual(keys);
    expect(Object.keys(locales.ja).sort()).toEqual(keys);
  });

  it('have no empty strings', () => {
    for (const [name, table] of Object.entries(locales)) {
      for (const [k, v] of Object.entries(table)) expect(typeof v === 'string' && v.length > 0, `${name}:${k}`).toBe(true);
    }
  });

  it('cover every enum value the UI renders', () => {
    const required = [
      ...['expand_disabled', 'expand_timeout', 'unresolved', 'network', 'invalid_input'].map((r) => `result.reason.${r}`),
      ...['sharer_id', 'ad_click', 'affiliate', 'campaign', 'session', 'unknown'].map((c) => `category.${c}`),
      ...['high', 'medium', 'low'].map((r) => `risk.${r}`),
      ...['disabled', 'throttled', 'up-to-date', 'updated', 'failed'].map((o) => `settings.update.${o}`),
    ];
    for (const key of required) expect(locales.en, key).toHaveProperty([key]);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `pnpm mobile exec vitest run i18n`
Expected: FAIL（找不到 `locales/*.json`）

- [ ] **Step 3: 實作**

`apps/mobile/src/i18n/locales/zh-TW.json`:
```json
{
  "app": { "title": "LinkClean" },
  "home": {
    "placeholder": "貼上或輸入連結，也可以從其他 App 分享進來",
    "paste": "貼上",
    "clean": "清理",
    "cleaning": "清理中…"
  },
  "result": {
    "title": "清理結果",
    "status": { "clean": "已清理", "partial": "可能未完全清理", "failed": "找不到有效網址" },
    "reason": {
      "expand_disabled": "已關閉短網址展開，這個分享連結仍可能帶有分享者資訊。",
      "expand_timeout": "展開短網址逾時，網址中仍可能含有分享者資訊。",
      "unresolved": "無法完全展開這個分享連結，網址中仍可能含有分享者資訊。",
      "network": "連線失敗，無法展開短網址，網址中仍可能含有分享者資訊。",
      "invalid_input": "請貼上以 http:// 或 https:// 開頭的連結。"
    },
    "copy": "複製",
    "copied": "已複製乾淨連結",
    "share": "分享",
    "open": "開啟",
    "removedCount": "已移除的追蹤碼：{{count}}",
    "noneRemoved": "沒有發現追蹤碼",
    "owner": "來自：{{owner}}",
    "noDesc": "這個參數的用途未知。",
    "hops": "跳轉紀錄"
  },
  "risk": { "high": "高風險", "medium": "中風險", "low": "低風險" },
  "category": {
    "sharer_id": "分享者識別",
    "ad_click": "廣告點擊追蹤",
    "affiliate": "聯盟行銷",
    "campaign": "行銷活動",
    "session": "工作階段",
    "unknown": "未知"
  },
  "history": {
    "title": "歷史紀錄",
    "empty": "還沒有紀錄",
    "clearAll": "全部清除",
    "clearConfirm": "要刪除所有歷史紀錄嗎？",
    "deleteConfirm": "要刪除這筆紀錄嗎？",
    "delete": "刪除",
    "cancel": "取消"
  },
  "settings": {
    "title": "設定",
    "expand": "展開短網址",
    "expandHint": "連到短網址服務取得原始網址。關閉後分享連結可能無法完全清理。",
    "autoCopy": "自動複製乾淨連結",
    "history": "保存歷史紀錄",
    "rulesVersion": "規則版本：{{version}}",
    "updateNow": "立即更新規則",
    "update": {
      "disabled": "尚未設定規則更新來源，目前使用內建規則。",
      "throttled": "最近已檢查過。",
      "up-to-date": "規則已是最新版本。",
      "updated": "規則已更新。",
      "failed": "更新失敗，繼續使用目前的規則。"
    },
    "privacy": "隱私政策",
    "licenses": "開源授權"
  },
  "licenses": {
    "title": "開源授權",
    "clearurls": "追蹤參數規則來自 ClearURLs 專案（gitlab.com/ClearURLs/rules），以 GNU LGPL-3.0 授權。"
  },
  "privacy": {"title": "隱私政策", "p1": "LinkClean 不收集任何資料。沒有帳號、沒有伺服器，也沒有使用任何第三方分析、廣告或崩潰回報工具。", "p2": "規則更新：App 每天最多自動連到規則網站一次，或在你按下「立即更新規則」時連線，下載追蹤參數規則。", "p3": "短網址展開：當你清理的是白名單內的短網址或分享連結（例如 Facebook、Threads、bit.ly），App 會從你的手機直接連到該服務取得原始網址。先送出 HEAD 請求，服務不支援時才改用 GET（此時會下載頁面內容，但不解析也不執行）。之後的跳轉由該服務決定。可在設定中關閉。", "p4": "歷史紀錄只存在 App 的本機儲存空間，App 不會傳送到任何伺服器。Android 已關閉系統備份；iOS 上它可能和其他 App 資料一樣，被包含在你自己的 iCloud 或電腦備份中。歷史可以關閉，也可以隨時清除。", "p5": "剪貼簿只在你按下「貼上」或「複製」，或開啟「自動複製乾淨連結」時使用。"},
  "nav": { "history": "歷史", "settings": "設定" }
}
```

`apps/mobile/src/i18n/locales/en.json`:
```json
{
  "app": { "title": "LinkClean" },
  "home": {
    "placeholder": "Paste or type a link, or share one from another app",
    "paste": "Paste",
    "clean": "Clean",
    "cleaning": "Cleaning…"
  },
  "result": {
    "title": "Result",
    "status": { "clean": "Cleaned", "partial": "May not be fully cleaned", "failed": "No valid link found" },
    "reason": {
      "expand_disabled": "Short-link expansion is off, so this share link may still identify who shared it.",
      "expand_timeout": "Expanding the short link timed out; the link may still identify who shared it.",
      "unresolved": "This share link could not be fully expanded; it may still identify who shared it.",
      "network": "Network error while expanding the short link; it may still identify who shared it.",
      "invalid_input": "Paste a link that starts with http:// or https://."
    },
    "copy": "Copy",
    "copied": "Clean link copied",
    "share": "Share",
    "open": "Open",
    "removedCount": "Tracking codes removed: {{count}}",
    "noneRemoved": "No tracking codes found",
    "owner": "From: {{owner}}",
    "noDesc": "The purpose of this parameter is unknown.",
    "hops": "Redirects"
  },
  "risk": { "high": "High risk", "medium": "Medium risk", "low": "Low risk" },
  "category": {
    "sharer_id": "Sharer identity",
    "ad_click": "Ad click tracking",
    "affiliate": "Affiliate",
    "campaign": "Campaign",
    "session": "Session",
    "unknown": "Unknown"
  },
  "history": {
    "title": "History",
    "empty": "No history yet",
    "clearAll": "Clear all",
    "clearConfirm": "Delete all history?",
    "deleteConfirm": "Delete this entry?",
    "delete": "Delete",
    "cancel": "Cancel"
  },
  "settings": {
    "title": "Settings",
    "expand": "Expand short links",
    "expandHint": "Contacts the short-link service to find the original URL. When off, share links may not be fully cleaned.",
    "autoCopy": "Copy clean links automatically",
    "history": "Keep history",
    "rulesVersion": "Rules version: {{version}}",
    "updateNow": "Update rules now",
    "update": {
      "disabled": "No update source configured; using built-in rules.",
      "throttled": "Checked recently.",
      "up-to-date": "Rules are up to date.",
      "updated": "Rules updated.",
      "failed": "Update failed; keeping the current rules."
    },
    "privacy": "Privacy policy",
    "licenses": "Open-source licenses"
  },
  "licenses": {
    "title": "Open-source licenses",
    "clearurls": "Tracking-parameter rules come from the ClearURLs project (gitlab.com/ClearURLs/rules), licensed under the GNU LGPL-3.0."
  },
  "privacy": {"title": "Privacy policy", "p1": "LinkClean collects no data. It has no accounts and no servers, and uses no third-party analytics, advertising or crash-reporting tools.", "p2": "Rule updates: the app contacts the rules website automatically at most once a day, or when you tap \"Update rules now\", to download tracking-parameter rules.", "p3": "Short-link expansion: when a link you clean is an allow-listed short or share link (for example Facebook, Threads, bit.ly), the app contacts that service directly from your phone to find the original URL. It sends a HEAD request first and falls back to GET only if the service does not support HEAD (page content is then downloaded but never parsed or executed). Further redirects are chosen by that service. You can turn this off in Settings.", "p4": "History is kept only in the app's local storage and is never sent to any server by the app. Android system backup is disabled; on iOS it may be included, like other app data, in your own iCloud or computer backups. History can be turned off and cleared at any time.", "p5": "The clipboard is used only when you tap Paste or Copy, or when automatic copying of clean links is on."},
  "nav": { "history": "History", "settings": "Settings" }
}
```

`apps/mobile/src/i18n/locales/ja.json`:
```json
{
  "app": { "title": "LinkClean" },
  "home": {
    "placeholder": "リンクを貼り付けるか入力してください。他のアプリから共有することもできます",
    "paste": "貼り付け",
    "clean": "クリーン",
    "cleaning": "処理中…"
  },
  "result": {
    "title": "結果",
    "status": { "clean": "クリーン済み", "partial": "完全には除去できていない可能性があります", "failed": "有効なリンクが見つかりません" },
    "reason": {
      "expand_disabled": "短縮URLの展開がオフのため、この共有リンクには共有者の情報が残っている可能性があります。",
      "expand_timeout": "短縮URLの展開がタイムアウトしました。共有者の情報が残っている可能性があります。",
      "unresolved": "この共有リンクを完全には展開できませんでした。共有者の情報が残っている可能性があります。",
      "network": "通信エラーで短縮URLを展開できませんでした。共有者の情報が残っている可能性があります。",
      "invalid_input": "http:// または https:// で始まるリンクを貼り付けてください。"
    },
    "copy": "コピー",
    "copied": "クリーンなリンクをコピーしました",
    "share": "共有",
    "open": "開く",
    "removedCount": "除去したトラッキングコード：{{count}}",
    "noneRemoved": "トラッキングコードは見つかりませんでした",
    "owner": "提供元：{{owner}}",
    "noDesc": "このパラメータの用途は不明です。",
    "hops": "リダイレクト履歴"
  },
  "risk": { "high": "高リスク", "medium": "中リスク", "low": "低リスク" },
  "category": {
    "sharer_id": "共有者の識別",
    "ad_click": "広告クリック計測",
    "affiliate": "アフィリエイト",
    "campaign": "キャンペーン",
    "session": "セッション",
    "unknown": "不明"
  },
  "history": {
    "title": "履歴",
    "empty": "履歴はまだありません",
    "clearAll": "すべて削除",
    "clearConfirm": "すべての履歴を削除しますか？",
    "deleteConfirm": "この履歴を削除しますか？",
    "delete": "削除",
    "cancel": "キャンセル"
  },
  "settings": {
    "title": "設定",
    "expand": "短縮URLを展開",
    "expandHint": "短縮URLサービスに接続して元のURLを取得します。オフにすると共有リンクを完全にはクリーンにできない場合があります。",
    "autoCopy": "クリーンなリンクを自動でコピー",
    "history": "履歴を保存",
    "rulesVersion": "ルールのバージョン：{{version}}",
    "updateNow": "今すぐルールを更新",
    "update": {
      "disabled": "更新元が設定されていないため、内蔵ルールを使用しています。",
      "throttled": "最近確認済みです。",
      "up-to-date": "ルールは最新です。",
      "updated": "ルールを更新しました。",
      "failed": "更新に失敗しました。現在のルールを引き続き使用します。"
    },
    "privacy": "プライバシーポリシー",
    "licenses": "オープンソースライセンス"
  },
  "licenses": {
    "title": "オープンソースライセンス",
    "clearurls": "トラッキングパラメータのルールは ClearURLs プロジェクト（gitlab.com/ClearURLs/rules）のもので、GNU LGPL-3.0 でライセンスされています。"
  },
  "privacy": {"title": "プライバシーポリシー", "p1": "LinkClean はデータを一切収集しません。アカウントもサーバーもなく、第三者の分析・広告・クラッシュレポートツールも使用していません。", "p2": "ルールの更新：アプリは 1 日に最大 1 回自動で、または「今すぐルールを更新」をタップしたときに、ルールのウェブサイトへ接続してトラッキングパラメータのルールをダウンロードします。", "p3": "短縮 URL の展開：クリーンにするリンクが許可リストにある短縮 URL・共有リンク（Facebook、Threads、bit.ly など）の場合、元の URL を取得するために端末からそのサービスへ直接接続します。まず HEAD リクエストを送り、対応していない場合のみ GET を使います（その場合ページの内容をダウンロードしますが、解析や実行はしません）。その後のリダイレクト先はそのサービスが決めます。設定でオフにできます。", "p4": "履歴はアプリのローカルストレージにのみ保存され、アプリがサーバーへ送信することはありません。Android のシステムバックアップは無効にしています。iOS では他のアプリデータと同様に、ご自身の iCloud やコンピュータのバックアップに含まれる場合があります。履歴はオフにでき、いつでも削除できます。", "p5": "クリップボードは「貼り付け」や「コピー」をタップしたとき、または「クリーンなリンクを自動でコピー」がオンのときだけ使用します。"},
  "nav": { "history": "履歴", "settings": "設定" }
}
```

`apps/mobile/src/i18n/index.ts`:
```ts
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resolveLocale } from '@linkclean/core';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhTW from './locales/zh-TW.json';

export const locale = resolveLocale(getLocales()[0]?.languageTag ?? 'en');

void i18n.use(initReactI18next).init({
  resources: { 'zh-TW': { translation: zhTW }, en: { translation: en }, ja: { translation: ja } },
  lng: locale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
```

- [ ] **Step 4: 確認測試通過**

Run: `pnpm mobile test && pnpm mobile typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/i18n
git commit -m "feat(mobile): add zh-TW, en and ja translations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: App state and screens

**Files:**
- Create: `apps/mobile/src/theme.ts`, `apps/mobile/src/state/AppContext.tsx`, `apps/mobile/src/components/ResultCard.tsx`
- Create: `apps/mobile/app/+native-intent.ts`, `apps/mobile/app/history.tsx`, `apps/mobile/app/result/[id].tsx`, `apps/mobile/app/settings.tsx`, `apps/mobile/app/privacy.tsx`, `apps/mobile/app/licenses.tsx`
- Replace: `apps/mobile/app/_layout.tsx`, `apps/mobile/app/index.tsx`

**Interfaces:**
- Consumes: Task 2 的 `SITE_BASE_URL` / `USER_AGENT`；Task 3 的 db / settings；Task 4 的 `loadRules` / `updateRules` / `UpdateOutcome`；Task 5 的 `cleanInput` / `rnFetch` / `CleanOutcome`；Task 6 的 i18n
- Produces:
  - `useApp(): AppState`
  - `AppState = { ready: boolean; db: Db; rules: RuleBundle; settings: Settings; locale: Locale; input: string; setInput(text: string): void; outcome: CleanOutcome | null; busy: boolean; submit(text: string): Promise<void>; setSettings(s: Settings): Promise<void>; refreshRules(): Promise<UpdateOutcome> }`
  - `<ResultCard result={ProcessResult} copied={boolean} />`
  - `useColors(): Colors`

設計重點（對應審核意見）：
- **等載入完成**：設定與快取規則載入前 `ready = false`；分享進來的內容與「清理」按鈕都等 `ready` 才處理，冷啟動時不會用預設設定清理
- **一次一個**：`submit()` 把清理排進佇列依序執行，每次執行都讀最新的規則 / 設定 / 語言；連續分享不會互相覆蓋結果或剪貼簿
- **最上層接收分享**：`ShareWatcher` 在 layout 裡，不管目前在哪個畫面都會處理分享，並回到首頁顯示結果；先 `resetShareIntent()` 再處理，同一個分享只處理一次
- **回到前景**：監聽 `AppState`，回到前景時做一次（受 24 小時節流的）規則檢查；同時間只會有一個更新在跑
- **語言即時更新**：用 `useLocales()`，系統語言改變時 i18next 與後續清理的說明語言一起更新
- `SQLiteProvider` 的 `onInit` 用模組層級的固定函式，避免主題切換時重新開啟資料庫

UI 層沒有單元測試（spec §7）；驗證方式是 typecheck、`bundle-check`，以及 Task 9 的模擬器建置、adb 分享測試與手動檢查清單。

**已知限制（不在本計畫處理）：** 歷史紀錄存的是建立當時語言的說明文字；之後切換系統語言，舊紀錄的說明不會跟著換。

- [ ] **Step 1: 主題與 App 狀態**

`apps/mobile/src/theme.ts`:
```ts
import { useColorScheme } from 'react-native';

export interface Colors {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  ok: string;
  warn: string;
  danger: string;
}

const light: Colors = {
  bg: '#f6f7f9',
  card: '#ffffff',
  text: '#16181d',
  muted: '#5d6470',
  border: '#d9dde3',
  accent: '#2563eb',
  ok: '#15803d',
  warn: '#b45309',
  danger: '#b91c1c',
};

const dark: Colors = {
  bg: '#0f1115',
  card: '#181b21',
  text: '#eceef2',
  muted: '#9aa1ad',
  border: '#2b3038',
  accent: '#60a5fa',
  ok: '#4ade80',
  warn: '#fbbf24',
  danger: '#f87171',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
```

`apps/mobile/src/state/AppContext.tsx`:
```tsx
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { useLocales } from 'expo-localization';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';
import { resolveLocale } from '@linkclean/core';
import type { Locale, RuleBundle } from '@linkclean/core';
import bundledJson from '../../assets/rules.json';
import { SITE_BASE_URL, USER_AGENT } from '../config';
import i18n from '../i18n';
import { cleanInput } from '../lib/cleaner';
import type { CleanOutcome } from '../lib/cleaner';
import type { Db } from '../lib/db';
import { loadRules, updateRules } from '../lib/rulesStore';
import type { UpdateOutcome } from '../lib/rulesStore';
import { rnFetch } from '../lib/rnFetch';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/settings';
import type { Settings } from '../lib/settings';

const BUNDLED = bundledJson as unknown as RuleBundle;

export interface AppState {
  ready: boolean;
  db: Db;
  rules: RuleBundle;
  settings: Settings;
  locale: Locale;
  input: string;
  setInput(text: string): void;
  outcome: CleanOutcome | null;
  busy: boolean;
  submit(text: string): Promise<void>;
  setSettings(s: Settings): Promise<void>;
  refreshRules(): Promise<UpdateOutcome>;
}

const Ctx = createContext<AppState | null>(null);

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sha256 = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);

export function AppProvider({ children }: { children: ReactNode }) {
  // expo-sqlite's SQLiteDatabase implements the Db subset used by src/lib.
  const db = useSQLiteContext() as unknown as Db;
  const locale = resolveLocale(useLocales()[0]?.languageTag ?? 'en');
  const [ready, setReady] = useState(false);
  const [rules, setRules] = useState<RuleBundle>(BUNDLED);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [input, setInput] = useState('');
  const [outcome, setOutcome] = useState<CleanOutcome | null>(null);
  const [pending, setPending] = useState(0);

  // Queued work reads these at run time, so it never uses stale rules, settings or locale.
  const latest = useRef({ rules, settings, locale });
  latest.current = { rules, settings, locale };
  const queue = useRef<Promise<void>>(Promise.resolve());
  const refreshing = useRef<Promise<UpdateOutcome> | null>(null);

  useEffect(() => {
    void i18n.changeLanguage(locale);
  }, [locale]);

  const refresh = useCallback(
    (force: boolean): Promise<UpdateOutcome> => {
      // One update at a time: startup, foreground and manual checks can overlap.
      if (!refreshing.current) {
        refreshing.current = (async () => {
          try {
            const result = await updateRules({ db, baseUrl: SITE_BASE_URL, fetchText, sha256, now: Date.now() }, { force });
            if (result === 'updated') setRules(await loadRules(db, BUNDLED));
            return result;
          } finally {
            refreshing.current = null;
          }
        })();
      }
      return refreshing.current;
    },
    [db],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      let s = DEFAULT_SETTINGS;
      let r = BUNDLED;
      try {
        [s, r] = await Promise.all([loadSettings(db), loadRules(db, BUNDLED)]);
      } catch {
        // Unreadable storage: keep defaults rather than blocking the app.
      }
      if (!alive) return;
      setSettingsState(s);
      setRules(r);
      setReady(true);
      void refresh(false);
    })();
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(false);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [db, refresh]);

  const submit = useCallback(
    (text: string): Promise<void> => {
      setInput(text);
      setPending((n) => n + 1);
      const job = queue.current.then(async () => {
        try {
          const { rules: r, settings: s, locale: l } = latest.current;
          setOutcome(
            await cleanInput(text, {
              db,
              rules: r,
              settings: s,
              locale: l,
              fetch: rnFetch,
              userAgent: USER_AGENT,
              copy: Clipboard.setStringAsync,
              now: Date.now,
            }),
          );
        } catch {
          // cleanInput handles expected failures itself; never let one job stall the queue.
        } finally {
          setPending((n) => n - 1);
        }
      });
      queue.current = job;
      return job;
    },
    [db],
  );

  const value = useMemo<AppState>(
    () => ({
      ready,
      db,
      rules,
      settings,
      locale,
      input,
      setInput,
      outcome,
      busy: pending > 0,
      submit,
      async setSettings(s) {
        setSettingsState(s);
        await saveSettings(db, s);
      },
      refreshRules: () => refresh(true),
    }),
    [ready, db, rules, settings, locale, input, outcome, pending, submit, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
```

- [ ] **Step 2: 結果卡片**

`apps/mobile/src/components/ResultCard.tsx`:
```tsx
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import type { AnalyzedParam, ProcessResult } from '@linkclean/core';
import { useColors } from '../theme';
import type { Colors } from '../theme';

function riskColor(c: Colors, risk: AnalyzedParam['risk']): string {
  return risk === 'high' ? c.danger : risk === 'medium' ? c.warn : c.muted;
}

function ParamRow({ p }: { p: AnalyzedParam }) {
  const { t } = useTranslation();
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen(!open)} style={[styles.param, { borderColor: c.border }]}>
      <View style={styles.paramHead}>
        <Text style={[styles.paramKey, { color: c.text }]}>{p.key}</Text>
        <Text style={[styles.badge, { color: riskColor(c, p.risk), borderColor: riskColor(c, p.risk) }]}>{t(`risk.${p.risk}`)}</Text>
      </View>
      <Text style={{ color: c.muted }}>
        {t(`category.${p.category}`)}
        {p.owner ? ` · ${t('result.owner', { owner: p.owner })}` : ''}
      </Text>
      {open && (
        <View style={styles.paramBody}>
          <Text style={{ color: c.text }}>{p.desc ?? t('result.noDesc')}</Text>
          <Text selectable style={[styles.mono, { color: c.muted }]}>{`${p.key}=${p.value}`}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function ResultCard({ result, copied }: { result: ProcessResult; copied: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const [showHops, setShowHops] = useState(false);
  const statusColor = result.status === 'clean' ? c.ok : result.status === 'partial' ? c.warn : c.danger;

  if (result.status === 'failed') {
    return (
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.status, { color: statusColor }]}>{t('result.status.failed')}</Text>
        <Text style={{ color: c.muted }}>{t('result.reason.invalid_input')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.status, { color: statusColor }]}>{t(`result.status.${result.status}`)}</Text>
      {result.reason && <Text style={{ color: c.warn }}>{t(`result.reason.${result.reason}`)}</Text>}
      <Text selectable style={[styles.url, { color: c.text }]}>{result.cleanUrl}</Text>
      {copied && <Text style={{ color: c.ok }}>{t('result.copied')}</Text>}

      <View style={styles.actions}>
        <Pressable onPress={() => void Clipboard.setStringAsync(result.cleanUrl)} style={[styles.button, { backgroundColor: c.accent }]}>
          <Text style={styles.buttonText}>{t('result.copy')}</Text>
        </Pressable>
        <Pressable onPress={() => void Share.share({ message: result.cleanUrl })} style={[styles.button, { backgroundColor: c.accent }]}>
          <Text style={styles.buttonText}>{t('result.share')}</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(result.cleanUrl)} style={[styles.button, { backgroundColor: c.accent }]}>
          <Text style={styles.buttonText}>{t('result.open')}</Text>
        </Pressable>
      </View>

      <Text style={[styles.section, { color: c.text }]}>
        {result.removed.length ? t('result.removedCount', { count: result.removed.length }) : t('result.noneRemoved')}
      </Text>
      {result.removed.map((p, i) => (
        <ParamRow key={`${p.key}-${i}`} p={p} />
      ))}

      {result.hops.length > 1 && (
        <Pressable onPress={() => setShowHops(!showHops)}>
          <Text style={[styles.section, { color: c.accent }]}>{t('result.hops')}</Text>
          {showHops &&
            result.hops.map((h, i) => (
              <Text key={`${i}-${h}`} selectable style={[styles.mono, { color: c.muted }]}>
                {`${i + 1}. ${h}`}
              </Text>
            ))}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  status: { fontSize: 18, fontWeight: '700' },
  url: { fontSize: 15 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  section: { marginTop: 8, fontWeight: '600' },
  param: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 4 },
  paramHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paramKey: { fontWeight: '600', fontFamily: 'Courier' },
  paramBody: { gap: 4, marginTop: 4 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, fontSize: 12 },
  mono: { fontFamily: 'Courier', fontSize: 12 },
});
```

- [ ] **Step 3: 版面、分享接收與首頁**

`apps/mobile/app/+native-intent.ts`（iOS 分享擴充功能開啟 App 時的 deep link 一律導到首頁）:
```ts
import { getShareExtensionKey } from 'expo-share-intent';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return path.includes(`dataUrl=${getShareExtensionKey()}`) ? '/' : path;
  } catch {
    return '/';
  }
}
```

`apps/mobile/app/_layout.tsx`:
```tsx
import '../src/i18n';
import { Link, router, Stack } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { SQLiteProvider } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { migrate } from '../src/lib/db';
import type { Db } from '../src/lib/db';
import { AppProvider, useApp } from '../src/state/AppContext';
import { useColors } from '../src/theme';

// Stable reference: a new onInit on every render would make SQLiteProvider reopen the database.
const initDb = (db: SQLiteDatabase) => migrate(db as unknown as Db);

// Consumes shares on any screen, exactly once, after settings and rules have loaded.
function ShareWatcher() {
  const { isReady, hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { ready, submit } = useApp();
  useEffect(() => {
    if (!isReady || !ready || !hasShareIntent) return;
    const text = shareIntent.text ?? shareIntent.webUrl ?? '';
    resetShareIntent();
    if (!text) return;
    if (router.canDismiss()) router.dismissAll();
    void submit(text);
  }, [isReady, ready, hasShareIntent, shareIntent, resetShareIntent, submit]);
  return null;
}

function HeaderLinks() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Text style={{ color: c.accent }}>
      <Link href="/history">{t('nav.history')}</Link>
      {'   '}
      <Link href="/settings">{t('nav.settings')}</Link>
    </Text>
  );
}

export default function RootLayout() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <ShareIntentProvider>
      <SQLiteProvider databaseName="linkclean.db" onInit={initDb}>
        <AppProvider>
          <ShareWatcher />
          <Stack screenOptions={{ contentStyle: { backgroundColor: c.bg }, headerStyle: { backgroundColor: c.card }, headerTintColor: c.text }}>
            <Stack.Screen name="index" options={{ title: t('app.title'), headerRight: () => <HeaderLinks /> }} />
            <Stack.Screen name="history" options={{ title: t('history.title') }} />
            <Stack.Screen name="result/[id]" options={{ title: t('result.title') }} />
            <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
            <Stack.Screen name="privacy" options={{ title: t('privacy.title') }} />
            <Stack.Screen name="licenses" options={{ title: t('licenses.title') }} />
          </Stack>
        </AppProvider>
      </SQLiteProvider>
    </ShareIntentProvider>
  );
}
```

`apps/mobile/app/index.tsx`:
```tsx
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ResultCard } from '../src/components/ResultCard';
import { useApp } from '../src/state/AppContext';
import { useColors } from '../src/theme';

export default function Home() {
  const { t } = useTranslation();
  const c = useColors();
  const { ready, input, setInput, busy, outcome, submit } = useApp();
  const canClean = ready && !busy && input.trim().length > 0;

  const pasteFallback = async () => setInput(await Clipboard.getStringAsync());

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder={t('home.placeholder')}
        placeholderTextColor={c.muted}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
      />
      <View style={styles.row}>
        {Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable ? (
          <Clipboard.ClipboardPasteButton
            onPress={(data) => {
              if (data.type === 'text') setInput(data.text);
            }}
            acceptedContentTypes={['plain-text', 'url']}
            displayMode="iconAndLabel"
            style={styles.pasteButton}
          />
        ) : (
          <Pressable onPress={() => void pasteFallback()} style={[styles.button, { borderColor: c.accent, borderWidth: 1 }]}>
            <Text style={{ color: c.accent, fontWeight: '600' }}>{t('home.paste')}</Text>
          </Pressable>
        )}
        <Pressable
          disabled={!canClean}
          onPress={() => void submit(input)}
          style={[styles.button, { backgroundColor: c.accent, opacity: canClean ? 1 : 0.5 }]}
        >
          <Text style={styles.buttonText}>{busy ? t('home.cleaning') : t('home.clean')}</Text>
        </Pressable>
      </View>
      {(busy || !ready) && <ActivityIndicator />}
      {outcome && !busy && <ResultCard result={outcome.result} copied={outcome.copied} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  button: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  pasteButton: { width: 120, height: 40 },
});
```

- [ ] **Step 4: 歷史、詳細、設定、隱私、授權**

`apps/mobile/app/history.tsx`:
```tsx
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, StyleSheet, Text } from 'react-native';
import { clearHistory, deleteHistory, listHistory } from '../src/lib/db';
import type { HistoryEntry } from '../src/lib/db';
import { useApp } from '../src/state/AppContext';
import { useColors } from '../src/theme';

export default function History() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { db } = useApp();
  const [items, setItems] = useState<HistoryEntry[]>([]);

  const reload = useCallback(() => {
    void listHistory(db).then(setItems, () => setItems([]));
  }, [db]);
  useFocusEffect(reload);

  const confirm = (message: string, action: () => Promise<void>) =>
    Alert.alert(message, undefined, [
      { text: t('history.cancel'), style: 'cancel' },
      { text: t('history.delete'), style: 'destructive', onPress: () => void action().finally(reload) },
    ]);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            items.length ? (
              <Pressable onPress={() => confirm(t('history.clearConfirm'), () => clearHistory(db))}>
                <Text style={{ color: c.danger }}>{t('history.clearAll')}</Text>
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        data={items}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={{ color: c.muted, textAlign: 'center' }}>{t('history.empty')}</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/result/${item.id}`)}
            onLongPress={() => confirm(t('history.deleteConfirm'), () => deleteHistory(db, item.id))}
            style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <Text style={{ color: c.muted, fontSize: 12 }}>{new Date(item.createdAt).toLocaleString(i18n.language)}</Text>
            <Text numberOfLines={2} style={{ color: c.text }}>
              {item.result.cleanUrl}
            </Text>
            <Text style={{ color: item.result.status === 'clean' ? c.ok : c.warn, fontSize: 12 }}>
              {t(`result.status.${item.result.status}`)} · {t('result.removedCount', { count: item.result.removed.length })}
            </Text>
          </Pressable>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  row: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
});
```

`apps/mobile/app/result/[id].tsx`:
```tsx
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { ResultCard } from '../../src/components/ResultCard';
import { getHistory } from '../../src/lib/db';
import type { HistoryEntry } from '../../src/lib/db';
import { useApp } from '../../src/state/AppContext';

export default function HistoryResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db } = useApp();
  const [entry, setEntry] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    void getHistory(db, Number(id)).then(setEntry, () => setEntry(null));
  }, [db, id]);

  return (
    <ScrollView contentContainerStyle={styles.container}>{entry && <ResultCard result={entry.result} copied={false} />}</ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 16 } });
```

`apps/mobile/app/settings.tsx`:
```tsx
import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { UpdateOutcome } from '../src/lib/rulesStore';
import type { Settings } from '../src/lib/settings';
import { useApp } from '../src/state/AppContext';
import { useColors } from '../src/theme';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const { settings, setSettings, rules, refreshRules } = useApp();
  const [updating, setUpdating] = useState(false);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);

  const toggle = (key: keyof Settings) => (value: boolean) => void setSettings({ ...settings, [key]: value });

  const update = async () => {
    setUpdating(true);
    try {
      setOutcome(await refreshRules());
    } catch {
      setOutcome('failed');
    } finally {
      setUpdating(false);
    }
  };

  const row = (key: keyof Settings, label: string, hint?: string) => (
    <View style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.rowText}>
        <Text style={{ color: c.text }}>{label}</Text>
        {hint && <Text style={{ color: c.muted, fontSize: 12 }}>{hint}</Text>}
      </View>
      <Switch value={settings[key]} onValueChange={toggle(key)} />
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {row('expand', t('settings.expand'), t('settings.expandHint'))}
      {row('autoCopy', t('settings.autoCopy'))}
      {row('history', t('settings.history'))}

      <View style={[styles.block, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={{ color: c.text }}>{t('settings.rulesVersion', { version: rules.version })}</Text>
        <Pressable disabled={updating} onPress={() => void update()}>
          <Text style={{ color: c.accent, opacity: updating ? 0.5 : 1 }}>{t('settings.updateNow')}</Text>
        </Pressable>
        {outcome && <Text style={{ color: c.muted }}>{t(`settings.update.${outcome}`)}</Text>}
      </View>

      <Link href="/privacy" style={[styles.link, { color: c.accent }]}>
        {t('settings.privacy')}
      </Link>
      <Link href="/licenses" style={[styles.link, { color: c.accent }]}>
        {t('settings.licenses')}
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 12, gap: 12 },
  rowText: { flex: 1, gap: 2 },
  block: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 },
  link: { paddingVertical: 8 },
});
```

`apps/mobile/app/privacy.tsx`（App 內建隱私政策，不依賴 `SITE_BASE_URL`；內容與 `docs/site/privacy.html` 一致）:
```tsx
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useColors } from '../src/theme';

const PARAGRAPHS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;

export default function Privacy() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {PARAGRAPHS.map((p) => (
        <Text key={p} style={{ color: c.text, lineHeight: 22 }}>
          {t(`privacy.${p}`)}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 16, gap: 14 } });
```

`apps/mobile/app/licenses.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useColors } from '../src/theme';

export default function Licenses() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={{ color: c.text }}>{t('licenses.clearurls')}</Text>
      <Pressable onPress={() => void Linking.openURL('https://www.gnu.org/licenses/lgpl-3.0.html')}>
        <Text style={{ color: c.accent }}>GNU LGPL-3.0</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 16, gap: 12 } });
```

- [ ] **Step 5: 驗證**

Run:
```bash
pnpm mobile typecheck
pnpm mobile test
pnpm mobile bundle-check
```
Expected: typecheck 無錯誤；測試全部 PASS；iOS 與 Android bundle 都輸出成功。

typecheck 若因 expo 套件型別與本計畫的寫法不符而失敗（例如 `router.dismissAll`、`redirectSystemPath` 的參數型別），以安裝版本的 `.d.ts` 為準修正，並記錄 Ruling。

- [ ] **Step 6: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): add home, result, history, settings, privacy and licenses screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Privacy policy page

**Files:**
- Create: `docs/site/privacy.html`
- Modify: `.github/workflows/rules.yml`（把 `docs/site/` 一起發佈）

**Interfaces:**
- Consumes: Plan 1 的 Pages workflow
- Produces: `<SITE_BASE_URL>privacy.html`（商店上架需要的公開隱私政策網址；內容與 App 內建的隱私政策頁一致）

隱私政策內容依 spec §1.4、§4.3、§6.4、§9：不收集資料；只連到規則更新網址與白名單短網址服務（含 405 時改用 GET 的說明）；歷史只存本機、可關閉可清除；沒有第三方 SDK。

- [ ] **Step 1: 寫頁面**

`docs/site/privacy.html`:
```html
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LinkClean Privacy Policy</title>
<style>
  :root { --bg: #ffffff; --fg: #16181d; --muted: #5d6470; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1115; --fg: #eceef2; --muted: #9aa1ad; } }
  body { background: var(--bg); color: var(--fg); font: 16px/1.6 -apple-system, system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 1.5rem; } h2 { margin-top: 2.5rem; font-size: 1.2rem; }
  .muted { color: var(--muted); }
</style>
</head>
<body>
<h1>LinkClean Privacy Policy</h1>
<p class="muted">Last updated: 2026-10-06 · <a href="#zh">繁體中文</a> · <a href="#en">English</a> · <a href="#ja">日本語</a></p>

<section id="zh" lang="zh-Hant">
<h2>繁體中文</h2>
<ul>
<li><strong>不收集任何資料。</strong>LinkClean 沒有帳號、沒有伺服器，也沒有使用任何第三方分析、廣告或崩潰回報工具。</li>
<li><strong>網路連線只有兩種：</strong>
  (1) 每天最多自動一次，或在你按下「立即更新規則」時，從本網站下載追蹤參數規則；
  (2) 你清理的連結若是白名單內的短網址或分享連結（例如 Facebook、Threads、bit.ly），App 會從你的手機直接連到該服務以取得原始網址。App 先送出 HEAD 請求；只有服務不支援時才改用 GET，此時會下載頁面內容，但不會解析或執行。之後的跳轉由該服務決定，等同你自己打開連結會經過的網址。你可以在設定中關閉短網址展開。</li>
<li><strong>歷史紀錄只存在 App 的本機儲存空間</strong>，App 不會傳送到任何伺服器。Android 已關閉系統備份；iOS 上它可能和其他 App 資料一樣，被包含在你自己的 iCloud 或電腦備份中。歷史可以在設定中關閉，也可以隨時清除。</li>
<li>剪貼簿只在你按下「貼上」或「複製」，或開啟「自動複製乾淨連結」時使用。</li>
</ul>
</section>

<section id="en" lang="en">
<h2>English</h2>
<ul>
<li><strong>No data is collected.</strong> LinkClean has no accounts and no servers, and uses no third-party analytics, advertising or crash-reporting tools.</li>
<li><strong>The app makes only two kinds of network requests:</strong>
  (1) automatically at most once a day, or when you tap "Update rules now", it downloads tracking-parameter rules from this website;
  (2) when a link you clean is an allow-listed short or share link (for example Facebook, Threads, bit.ly), the app contacts that service directly from your phone to find the original URL. It sends a HEAD request first and falls back to GET only if the service does not support HEAD; in that case page content is downloaded but never parsed or executed. Any further redirects are chosen by that service, the same ones you would pass through by opening the link yourself. You can turn short-link expansion off in Settings.</li>
<li><strong>History is kept only in the app's local storage</strong> and is never sent to any server by the app. Android system backup is disabled; on iOS it may be included, like other app data, in your own iCloud or computer backups. History can be turned off in Settings and cleared at any time.</li>
<li>The clipboard is used only when you tap Paste or Copy, or when automatic copying of clean links is on.</li>
</ul>
</section>

<section id="ja" lang="ja">
<h2>日本語</h2>
<ul>
<li><strong>データは一切収集しません。</strong>LinkClean にはアカウントもサーバーもなく、第三者の分析・広告・クラッシュレポートツールも使用していません。</li>
<li><strong>通信は次の 2 種類だけです：</strong>
  (1) 1 日に最大 1 回自動で、または「今すぐルールを更新」をタップしたときに、このウェブサイトからトラッキングパラメータのルールをダウンロードします。
  (2) クリーンにするリンクが許可リストにある短縮 URL・共有リンク（Facebook、Threads、bit.ly など）の場合、元の URL を取得するために端末からそのサービスへ直接接続します。まず HEAD リクエストを送り、サービスが対応していない場合のみ GET を使います。その場合ページの内容をダウンロードしますが、解析や実行はしません。その後のリダイレクト先はそのサービスが決めるもので、ご自身でリンクを開いた場合と同じです。短縮 URL の展開は設定でオフにできます。</li>
<li><strong>履歴はアプリのローカルストレージにのみ保存され、</strong>アプリがサーバーへ送信することはありません。Android のシステムバックアップは無効にしています。iOS では他のアプリデータと同様に、ご自身の iCloud やコンピュータのバックアップに含まれる場合があります。設定でオフにでき、いつでも削除できます。</li>
<li>クリップボードは「貼り付け」や「コピー」をタップしたとき、または「クリーンなリンクを自動でコピー」がオンのときだけ使用します。</li>
</ul>
</section>
</body>
</html>
```

- [ ] **Step 2: 發佈到 Pages**

`.github/workflows/rules.yml` 的 build job，把
```yaml
      - run: mkdir -p site && cp rules/dist/rules.json rules/dist/rules.meta.json site/
```
改成
```yaml
      - run: mkdir -p site && cp rules/dist/rules.json rules/dist/rules.meta.json docs/site/* site/
```
並在 `on.push.paths` 加入 `'docs/site/**'`。

- [ ] **Step 3: 驗證**

Run:
```bash
ruby -ryaml -e 'YAML.load_file(".github/workflows/rules.yml"); puts "ok"'
python3 -c "import html.parser,sys; html.parser.HTMLParser().feed(open('docs/site/privacy.html').read()); print('parsed')"
grep -c '<section id=' docs/site/privacy.html
```
Expected: `ok`、`parsed`、`3`

- [ ] **Step 4: Commit**

```bash
git add docs/site .github/workflows/rules.yml
git commit -m "docs(site): add trilingual privacy policy and publish it with the rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Native builds, smoke test, device checklist, spec sync

**Files:**
- Create: `docs/testing/device-checklist.md`
- Modify: `docs/superpowers/specs/2026-10-06-link-cleaner-design.md`（本計畫開頭列出的 4 項偏差）
- Modify: `README.md`（加入 App 指令）

**Interfaces:**
- Consumes: Task 1–8 的全部成果
- Produces: 可在 iOS 模擬器與 Android 模擬器啟動的 App；用戶可照著做的實機檢查清單

- [ ] **Step 1: 建置並在模擬器啟動**

Run（第一次建置需要較長時間；輸出寫入檔案再看結尾）:
```bash
cd apps/mobile
pnpm exec expo prebuild --clean > /tmp/linkclean-prebuild.log 2>&1; tail -5 /tmp/linkclean-prebuild.log
pnpm exec expo run:ios --device "iPhone 16 Pro" > /tmp/linkclean-ios.log 2>&1; tail -15 /tmp/linkclean-ios.log
xcrun simctl io booted screenshot /tmp/linkclean-ios.png
```
Expected:
- prebuild 產生 `ios/`、`android/`，log 裡有 `[expo-share-intent] add ios share extension`
- iOS 建置成功並在模擬器開啟 App；截圖顯示首頁（輸入框、貼上、清理）

Run:
```bash
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_36.1 -no-snapshot-save > /tmp/linkclean-emu.log 2>&1 &
~/Library/Android/sdk/platform-tools/adb wait-for-device
pnpm exec expo run:android > /tmp/linkclean-android.log 2>&1; tail -15 /tmp/linkclean-android.log
~/Library/Android/sdk/platform-tools/adb exec-out screencap -p > /tmp/linkclean-android.png
```
Expected: Android 建置成功、App 啟動；截圖顯示首頁

用 Read 工具查看兩張截圖，確認首頁有正確顯示（以系統語言呈現）。

Android 分享流程可直接用 adb 驗證（不需手動操作）:
```bash
~/Library/Android/sdk/platform-tools/adb shell am start -a android.intent.action.SEND -t text/plain \
  --es android.intent.extra.TEXT "'看這個 https://example.com/a?utm_source=x&id=1'" -n com.linkclean.app/.MainActivity
sleep 3
~/Library/Android/sdk/platform-tools/adb exec-out screencap -p > /tmp/linkclean-android-share.png
```
Expected: 截圖顯示結果卡片：`https://example.com/a?id=1`、「已清理」（或系統語言對應文字）、移除 1 個追蹤碼。

若任何建置失敗：用 superpowers:systematic-debugging 找原因；屬於計畫寫法與實際 SDK 不符的，修正後記錄 Ruling。

- [ ] **Step 2: 寫實機檢查清單**

`docs/testing/device-checklist.md`:
```markdown
# LinkClean device checklist

Run on a real iPhone and a real Android phone, on mobile data (not Wi-Fi) at least once.
Use links from a test account; never paste real personal share links into issues or commits.

## Share in
- [ ] iOS: Safari → Share → LinkClean opens and shows the cleaned result
- [ ] iOS: Threads app → Share → Copy link is NOT needed; Share → LinkClean works directly
- [ ] Android: Chrome → Share → LinkClean opens and shows the cleaned result
- [ ] Android: Facebook app → Share → LinkClean (FB share link expands to the post URL)
- [ ] Sharing the same link twice in a row creates exactly two history entries (no duplicates per share)
- [ ] Sharing while the app is already open replaces the current result
- [ ] Sharing while the Settings screen is open returns to Home and shows the result
- [ ] Cold start via share with history turned off adds no history entry (settings are applied before processing)
- [ ] Sharing two links quickly shows the second result last; the clipboard holds the second clean link

## Paste
- [ ] iOS: the system Paste button pastes without the "Allow Paste" prompt
- [ ] Android: Paste fills the input from the clipboard
- [ ] Pasting plain text without a link shows "No valid link found" and adds no history entry

## Result
- [ ] Clean result: green status, clean URL selectable, auto-copied (toast text shown) when the setting is on
- [ ] FB / Threads share link: status is clean and the list shows share-id as high risk
- [ ] Turn off "Expand short links" → a Threads share link shows the warning and is NOT auto-copied
- [ ] Airplane mode → a share link shows the network warning and is NOT auto-copied
- [ ] Tapping a removed parameter expands its explanation
- [ ] Copy / Share / Open buttons work
- [ ] Redirects section lists the hops for an expanded link

## History
- [ ] Entries are newest first; tapping one opens the full result
- [ ] Long-press → delete removes one entry; Clear all empties the list
- [ ] Turning history off stops new entries; existing entries remain

## Settings & rules
- [ ] Rules version is shown
- [ ] "Update rules now" shows a message (disabled until SITE_BASE_URL is set)
- [ ] Licenses page shows the ClearURLs LGPL-3.0 notice
- [ ] Privacy policy opens the in-app page in the current language
- [ ] Leaving the app in the background for over 24 hours, then reopening it, triggers a rule check (once SITE_BASE_URL is set)

## Languages
- [ ] Device language Traditional Chinese / English / Japanese → UI and parameter explanations follow
- [ ] iOS: Settings → LinkClean → Language can switch the app language
- [ ] Android 13+: Settings → Apps → LinkClean → Language can switch the app language
- [ ] Changing the system language while the app is running updates the UI
```

- [ ] **Step 3: 同步 spec 與 README**

spec 修改（逐字替換）：
- §2 表格 `| 規則快取 | \`expo-file-system\` |` → `| 規則快取 | \`expo-sqlite\`（\`kv\` 表） |`
- §6.1 表格「歷史」一列的「左滑刪除」→「長按刪除」；「結果卡片」一列的「點開 bottom sheet 看說明」→「點擊就地展開說明」
- §6.1 表格「設定」一列的「隱私政策」→「隱私政策（App 內建頁面）」
- §2 表格「多語系」一列 → `expo-localization`（含 `supportedLocales` 設定，產生 iOS / Android 單一 App 語言設定）+ `i18next`
- §6.5 歷史表 SQL 在 `status TEXT NOT NULL,` 之後加入 `reason TEXT,`，在 `removed_json TEXT NOT NULL` 之後加入 `, hops_json TEXT NOT NULL`

`README.md` 的 Commands 區塊後加入：
````markdown
## Mobile app

```bash
pnpm build:rules && pnpm mobile sync-rules   # refresh the bundled rule snapshot
pnpm mobile test                             # logic tests (Vitest, node:sqlite)
pnpm mobile typecheck
pnpm mobile ios                              # build and run on the iOS simulator
pnpm mobile android                          # build and run on the Android emulator
```

Set `SITE_BASE_URL` in `apps/mobile/src/config.ts` once the GitHub Pages site exists.
Manual checks before a release: `docs/testing/device-checklist.md`.
````

- [ ] **Step 4: 全套驗證**

Run:
```bash
pnpm test && pnpm typecheck && pnpm test:regression && pnpm mobile test && pnpm mobile typecheck && pnpm mobile bundle-check
```
Expected: 全部成功

- [ ] **Step 5: Commit**

```bash
git add docs README.md
git commit -m "docs: add device checklist, sync spec with app decisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 交給用戶處理（執行者不可自行操作）**

1. 用實機照 `docs/testing/device-checklist.md` 檢查一次（iOS 實機需要用自己的 Apple ID 簽署）
2. GitHub Pages 建好後，把網址填進 `apps/mobile/src/config.ts` 的 `SITE_BASE_URL`
3. 上架前決定正式的 App 名稱與 bundle ID（目前暫定 `com.linkclean.app`）
