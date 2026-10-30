# Rules Update Failures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rules update failures mostly fix themselves, Settings says why one happened, and the user can send a diagnostic email themselves when it does not recover.

**Architecture:** Part 1 (main): the rules workflow reuses the published files when the content is unchanged, so the hash stops changing daily; the site privacy page gains a "from 0.1.3" sentence. Part 2 (branch off `feat/qs-tile` after merging main): `rulesStore` classifies failures, schedules retries and keeps a local status record; `loadRules` prefers the newer of built-in and downloaded; Settings shows source, last success, failure reason and a report button; the app's built-in rules become a byte copy of a published release.

**Tech Stack:** pnpm monorepo, TypeScript, vitest, tsx, Expo / React Native, react-i18next, GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-10-30-rules-update-failures-design.md`

## Global Constraints

- Nothing leaves the phone unless the user taps Send in their own mail app. No telemetry, no new network endpoints besides `SITE_BASE_URL`.
- Failures show only in Settings: no toast, no dialog, no banner elsewhere.
- Rules version format is `YYYY.MM.DD.HHMM` (`makeVersion` in `rules/src/bundle.ts`); a version not matching `^\d{4}\.\d{2}\.\d{2}\.\d{4}$` counts as older than any valid one.
- Mismatch retry: 15 minutes (`MISMATCH_RETRY_MS = 15 * 60 * 1000`). Fetch timeout: 15 seconds. Report button: same reason 3+ times in a row, or reason `unsupported` / `invalid`.
- Every user-facing string exists in `en.json`, `zh-TW.json`, `ja.json`. Privacy text changes land in both `docs/site/privacy.html` (zh-Hant, en, ja sections) and app `privacy.p6`.
- After editing any file with Write/Edit, run `python3 scripts/check-invisible.py <files>` on the touched source/JSON/HTML files.
- Switching branches needs `pnpm install --frozen-lockfile`.
- Never push without the user's explicit OK. Before pushing rules-affecting changes to main: codex + agy review, and validate `rules/dist/rules.json` with the 0.1.1 cores (c490600, acbcefa) as in the 2026-10-30 check.

## Review Focus

1. A captive-portal Wi-Fi returns an HTML page with HTTP 200 for `rules.meta.json` → classified `network`, check time not recorded (test in Task 3).
2. The downloaded cache holds a malformed version string while the built-in one is valid → built-in wins (test in Task 4).
3. Reason changes between failures (network, then mismatch) → the in-a-row count restarts at 1 (test in Task 3).
4. The workflow's live download returns a meta whose sha256 does not match the live rules.json (CDN mid-flip) → treated as unavailable, the fresh build is published (test in Task 1).
5. A request hangs forever → after 15 s it rejects and the outcome is `failed-network` (test in Task 5).

---

## Part 1 — main

### Task 1: Reuse published rules when content is unchanged

**Files:**
- Create: `rules/src/published.ts`, `rules/src/reuse.ts`
- Modify: `rules/package.json` (script `reuse`), `.github/workflows/rules.yml`
- Test: `rules/test/unit/published.test.ts`

**Interfaces:**
- Produces (Task 8 reuses `fetchPublished`):
  - `fetchPublished(baseUrl: string, fetchText: (url: string) => Promise<string>): Promise<{ rulesText: string; metaText: string; bundle: RuleBundle }>` — downloads `rules.meta.json` and `rules.json`, throws unless meta is JSON with `schemaVersion === 1`, string `sha256` equal to sha256(rulesText), and `validateBundle(JSON.parse(rulesText))` is empty.
  - `sameContent(a: RuleBundle, b: RuleBundle): boolean` — deep-equal after removing `version` from both (compare `JSON.stringify` of the version-less objects; key order is deterministic because both come from `buildBundle` / its published output).
- `reuse.ts` CLI: `tsx src/reuse.ts --base <url> [--dist <dir>]` (dist defaults to `here('../dist')`, resolved from `import.meta.url` like `build.ts`, i.e. `rules/dist`). Reads `dist/rules.json`; on `fetchPublished` success with `sameContent` true, overwrites `dist/rules.json` and `dist/rules.meta.json` with the downloaded texts byte-for-byte and logs `reused published rules <version>`; otherwise logs `publishing new rules <version>` (include the error message when the fetch failed) and leaves dist alone. Never exits non-zero because of the live site.

- [ ] **Step 1: Write failing tests** in `published.test.ts` using a fake `fetchText` map (no network):
  - `fetchPublished returns texts and bundle when hash and bundle are valid`
  - `fetchPublished throws on HTML meta` (meta text `<html>`)
  - `fetchPublished throws when sha256 does not match rules text` (Review Focus 4)
  - `fetchPublished throws when the bundle fails validateBundle`
  - `sameContent ignores version` → `true` for two bundles differing only in `version`
  - `sameContent detects a changed rule` → `false` when one provider's `rules` array differs
- [ ] **Step 2:** `pnpm --filter @linkclean/rules test` → FAIL (module not found)
- [ ] **Step 3:** Implement `published.ts` (use `sha256` from `./bundle`, `validateBundle` from `@linkclean/core`) and `reuse.ts` (Node `fetch`; non-2xx throws).
- [ ] **Step 4:** `pnpm --filter @linkclean/rules test && pnpm typecheck` → PASS
- [ ] **Step 5:** Manual check: `pnpm build:rules && pnpm --filter @linkclean/rules reuse --base https://ttylab80387.github.io/untail/` → logs either line; if "reused", `shasum -a 256 rules/dist/rules.json` equals the live meta's sha256.
- [ ] **Step 6:** Workflow: in `build`, after `pnpm test:regression` and before the `mkdir -p site` copy, add
  ```yaml
      # Keep the published version and hash when the content did not change (avoids CDN meta/rules mismatches).
      - run: pnpm --filter @linkclean/rules reuse --base https://ttylab80387.github.io/untail/
  ```
- [ ] **Step 7:** Commit `feat(rules): reuse published rules when the content is unchanged`.

### Task 2: Site privacy page (from 0.1.3)

**Files:** Modify `docs/site/privacy.html` (sections `#zh`, `#en`, `#ja`, the "Reporting a problem" item).

- [ ] **Step 0:** The network item "(1) automatically at most once a day, or when you tap…" (lines ~24/37/50) stays true for 0.1.1/0.1.2 but not for 0.1.3. Append to it in each section (exact English; zh-Hant/ja same meaning):
  > From version 0.1.3, if a download fails, the app tries again the next time you open it, or after about 15 minutes if the downloaded rules were incomplete.
- [ ] **Step 1:** Append to the reporting item in each section (exact English; zh-Hant/ja carry the same meaning):
  > From version 0.1.3, if updating the cleaning rules keeps failing, Settings offers "Report update problem". It opens the same kind of email in your own mail app with the failure reason and time, the app and rules versions, and your phone's system name and version (for example Android 16); nothing is sent unless you tap Send. The app keeps the result of its latest rules update only on your phone, to show it in Settings and in that email.
- [ ] **Step 2:** `python3 scripts/check-invisible.py docs/site/privacy.html` → clean; open the file in a browser and check all three sections render.
- [ ] **Step 3:** Commit `docs(site): describe the 0.1.3 rules update report in the privacy policy`.

**Stop after Part 1:** run codex + agy review on Part 1, validate dist with the 0.1.1 cores, then ask the user before pushing main.

## Part 2 — app (branch `feat/rules-update-status`)

### Task 3 setup + rulesStore failure reasons, retry, status record

**Setup (once):** `git checkout feat/qs-tile && git merge main` (expect a clean merge; main adds Bilibili fixes, Part 1 and the spec), `pnpm install --frozen-lockfile`, `git checkout -b feat/rules-update-status`, `pnpm test` green.

**Files:**
- Modify: `apps/mobile/src/lib/rulesStore.ts`
- Test: `apps/mobile/src/lib/rulesStore.test.ts`

**Interfaces — Produces:**
- `export type FailReason = 'network' | 'mismatch' | 'unsupported' | 'invalid'`
- `export type UpdateOutcome = 'disabled' | 'throttled' | 'up-to-date' | 'updated' | \`failed-${FailReason}\``
- `export const MISMATCH_RETRY_MS = 15 * 60 * 1000`
- `export function compareVersions(a: string, b: string): number` (see Task 4 for the contract; tests live in Task 4)
- `export interface UpdateStatus { lastSuccessAt: number | null; failure: { reason: FailReason; at: number; count: number } | null }`
- `export async function readStatus(db: Db): Promise<UpdateStatus>` — kv key `rules.status`; missing or unparsable → `{ lastSuccessAt: null, failure: null }`
- `export function shouldOfferReport(s: UpdateStatus): boolean` — `failure` present and (`count >= 3` or reason is `unsupported`/`invalid`)

- `UpdateDeps` gains `bundledVersion: string` (AppContext passes `BUNDLED.version`).

Classification inside `updateRules` (replaces the single `failed`; use separate try blocks per step, not one outer catch), checked in this order:
1. meta fetch throws, or meta text is not JSON → `network`. **Set `rules.checkedAt` to `0`** so the next open/foreground retries even if an earlier check today succeeded.
2. meta is not a non-null object, or `typeof sha256 !== 'string'`, or `typeof schemaVersion !== 'number'` → `invalid` (record 24 h).
3. `schemaVersion !== 1` → `unsupported` (record 24 h).
4. Built-in shortcut: if `meta.version === bundledVersion` and the cache is absent or not newer than the built-in (`compareVersions`, Task 4) → `up-to-date` without downloading `rules.json`.
5. Existing cache-hash shortcut → `up-to-date` (as today).
6. rules fetch throws → `network` (checkedAt `0`).
7. sha256(rules text) ≠ meta.sha256 → `mismatch`: set `rules.checkedAt` to `now - CHECK_INTERVAL_MS + MISMATCH_RETRY_MS` (next unforced check 15 min later).
8. rules text not JSON → `invalid`; `validateBundle` errors → `unsupported` (record 24 h).
9. Store cache → `updated`.

Status: `updated` / `up-to-date` set `lastSuccessAt = now`, `failure = null`. Each failure keeps `lastSuccessAt`; same reason as stored → `count + 1`, else `count = 1`; `at = now`. `disabled` / `throttled` leave status untouched.

Note: step 4 depends on `compareVersions` from Task 4; implement Task 4's `compareVersions` first inside this task (Task 4 then only changes `loadRules`).

- [ ] **Step 1: Write failing tests** (extend existing file; reuse its `site()` / `deps()` helpers):
  - `classifies a thrown fetch as failed-network and does not record the check` → a second unforced call at `NOW + 1` fetches again
  - `a network failure after an earlier success today still retries on the next open` → success at `NOW`, forced network failure at `NOW + 3600000`, unforced call at `NOW + 3600001` fetches (not `throttled`)
  - `classifies an HTML meta page as failed-network` (Review Focus 1)
  - `classifies meta null, {} and a meta without sha256 as failed-invalid, not unsupported`
  - `returns up-to-date without downloading rules.json when meta.version equals the built-in version and nothing newer is cached` (assert `calls` has only the meta URL)
  - `a failure keeps the earlier lastSuccessAt`
  - `classifies a hash mismatch as failed-mismatch and retries after 15 minutes` → unforced call at `NOW + MISMATCH_RETRY_MS - 1` returns `throttled`, at `NOW + MISMATCH_RETRY_MS` fetches
  - `classifies schemaVersion 2 and an invalid bundle as failed-unsupported` (two cases)
  - `classifies non-JSON rules as failed-invalid`
  - `records lastSuccessAt and clears the failure on up-to-date and updated`
  - `counts the same reason in a row and restarts the count when the reason changes` (Review Focus 3)
  - `throttled leaves the status unchanged`
  - `readStatus returns empty status for a corrupted record`
  - `shouldOfferReport` table: network×2 → false, network×3 → true, unsupported×1 → true, invalid×1 → true, null → false
  - Update existing tests that expected `'failed'`.
- [ ] **Step 2:** `pnpm --filter @linkclean/mobile test -- rulesStore` → FAIL
- [ ] **Step 3:** Implement in `rulesStore.ts`.
- [ ] **Step 4:** same command → PASS; `pnpm typecheck` will fail in `settings.tsx`/`AppContext.tsx` until Task 6 — fix only the type errors there minimally now (map any `failed-*` to the existing display; `catch` sets `'failed-network'`) so the suite and typecheck stay green.
- [ ] **Step 5:** Commit `feat(mobile): classify rules update failures, retry mismatches after 15 minutes, keep a local status`.

### Task 4: loadRules prefers the newer of built-in and downloaded

**Files:** Modify `apps/mobile/src/lib/rulesStore.ts`, `apps/mobile/src/state/AppContext.tsx` (call sites); Test `rulesStore.test.ts`.

**Interfaces — Produces:**
- `export type RulesSource = 'downloaded' | 'built-in'`
- `export function compareVersions(a: string, b: string): number` — negative/0/positive; invalid format sorts before any valid; two invalid → 0 (written in Task 3)
- `loadRules(db: Db, bundled: RuleBundle): Promise<{ rules: RuleBundle; source: RulesSource }>` — downloaded only when the cache is valid and `compareVersions(cached.version, bundled.version) > 0` (equal version = same published release, so report it as built-in)

- [ ] **Step 1: Failing tests:** `uses downloaded rules only when newer than built-in`; `uses built-in rules when the cache has the same version`; `uses built-in rules when they are newer than the cache`; `uses built-in rules when the cached version is malformed` (Review Focus 2); `compareVersions` table (`2026.10.29.1010` vs `2026.10.22.1441` > 0, equal → 0, `bad` vs valid < 0). Update existing `loadRules` tests to the new return shape (test bundles use valid versions, e.g. `2026.01.01.0000` for bundled).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement; update `AppContext` to keep `rulesSource` state from `loadRules`. **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `fix(mobile): use built-in rules when they are newer than the downloaded copy`.

### Task 5: Fetch timeout

**Files:** Create `apps/mobile/src/lib/fetchText.ts`; Modify `AppContext.tsx` (replace local `fetchText`); Test `apps/mobile/src/lib/fetchText.test.ts`.

**Interfaces — Produces:** `export const FETCH_TIMEOUT_MS = 15_000`; `export function makeFetchText(fetchImpl: typeof fetch, timeoutMs = FETCH_TIMEOUT_MS): (url: string) => Promise<string>` — non-2xx throws `HTTP <status>`; aborts via `AbortController` after `timeoutMs`; clears the timer when done.

- [ ] **Step 1: Failing tests** (vitest fake timers): `returns the body on 200`; `throws on 404`; `rejects after the timeout when the request hangs` (fake fetch that never resolves until its signal aborts; advance 15 000 ms) (Review Focus 5).
- [ ] **Step 2–4:** fail → implement → `pnpm test && pnpm typecheck` pass.
- [ ] **Step 5:** Commit `fix(mobile): time out rules downloads after 15 seconds`.

### Task 6: Settings status, report button, strings

**Files:**
- Modify: `apps/mobile/src/lib/report.ts`, `apps/mobile/src/lib/report.test.ts` (create if absent), `apps/mobile/src/state/AppContext.tsx`, `apps/mobile/app/settings.tsx`, `apps/mobile/src/components/useReport.ts`, `apps/mobile/src/i18n/locales/{en,zh-TW,ja}.json`

**Interfaces:**
- Consumes: `UpdateStatus`, `readStatus`, `shouldOfferReport`, `RulesSource`, `UpdateOutcome` (Tasks 3–4).
- Produces:
  - `export interface RulesReportInput { to: string; subject: string; note: string; reason: FailReason; failedAt: number; count: number; lastSuccessAt: number | null; appVersion: string; rulesVersion: string; rulesSource: RulesSource; builtInVersion: string; system: string }`
  - `export function rulesReportMailto(r: RulesReportInput): string` — body lines, in order: `note`, blank, `Rules update: <reason>`, `Last failure: <ISO UTC>`, `Failures in a row: <count>`, `Last success: <ISO UTC | never>`, `App <appVersion> / Rules <rulesVersion> (<rulesSource>) / Built-in <builtInVersion>`, `<system>`
  - `AppState` gains `rulesSource: RulesSource`, `rulesStatus: UpdateStatus`; `refresh` re-reads status after every run (startup, foreground, manual)
  - `useRulesReport(): () => void` in `useReport.ts` (same mail-open/fallback as `useReport`)
  - `export function systemLabel(os: string, version: string | number, androidRelease?: string): string` in `report.ts` — Android uses `androidRelease` (from `Platform.constants.Release`; `Platform.Version` is the API level, e.g. 36), iOS uses `version`; output `Android 16` / `iOS 26.1`
  - `export function settingsLines(status: UpdateStatus, manual: UpdateOutcome | null): { failure: FailReason | null; manualKey: UpdateOutcome | null }` in `rulesStore.ts` — `failure` comes only from `status.failure`; `manualKey` is `manual` only when it is not a `failed-*` outcome and `status.failure` is null (so a stale manual result never contradicts the stored state)

- [ ] **Step 1: Failing tests** `rulesReportMailto lists the diagnostic lines in order` (assert decoded body equals the exact joined lines for a fixed input, `lastSuccessAt: null` → `never`); `systemLabel` (`android, 36, '16'` → `Android 16`; `ios, '26.1'` → `iOS 26.1`); `settingsLines` (manual `failed-network` + status cleared → both null; manual `up-to-date` + stored failure → failure only; manual `updated` + no failure → manualKey `updated`).
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5:** Settings block (below "Update rules now"): version line `settings.rulesVersion` + source suffix; `settings.lastSuccess` when `lastSuccessAt`; failure and manual lines from `settingsLines(rulesStatus, outcome)`; `settings.reportUpdate` link when `shouldOfferReport`. Remove the `catch { setOutcome('failed') }` path (refreshRules records failures itself).
- [ ] **Step 6: Strings.** Replace `settings.update.failed` with four keys; add the rest. en (zh-TW and ja below):
  - `failed-network`: "Can't reach the rules site right now. Untail will try again next time you open it."
  - `failed-mismatch`: "The downloaded rules were incomplete. Untail will try again in a few minutes."
  - `failed-unsupported`: "This version of Untail can't read the new rules. Please update the app."
  - `failed-invalid`: "The rules site sent unexpected data. Untail will try again tomorrow."
  - `sourceDownloaded`: "(downloaded)", `sourceBuiltIn`: "(built in)", `lastSuccess`: "Last updated: {{time}}", `reportUpdate`: "Report update problem", `report.updateSubject`: "Untail rules update problem"
  - zh-TW: 目前連不上規則網站，下次打開 Untail 會再試。／下載到的規則不完整，幾分鐘後會自動再試。／這個版本的 Untail 讀不懂新規則，請更新 App。／規則網站回傳的資料有問題，明天會再試。／（已下載）／（App 內建）／上次成功更新：{{time}}／回報更新問題／Untail 規則更新問題
  - ja: 現在ルールのサイトに接続できません。次に開いたときに再試行します。／ダウンロードしたルールが不完全でした。数分後に自動で再試行します。／このバージョンの Untail は新しいルールを読み込めません。アプリを更新してください。／ルールのサイトから想定外のデータが返されました。明日再試行します。／（ダウンロード済み）／（アプリ内蔵）／最終更新：{{time}}／更新の問題を報告／Untail ルール更新の問題
  - `{{time}}` = `new Date(lastSuccessAt).toLocaleString(locale)`
- [ ] **Step 7:** `pnpm test && pnpm typecheck` → PASS; `python3 scripts/check-invisible.py` on the three JSON files and changed TS/TSX.
- [ ] **Step 8:** Commit `feat(mobile): show why a rules update failed and let the user report it`.

### Task 7: In-app privacy text

**Files:** `apps/mobile/src/i18n/locales/{en,zh-TW,ja}.json` keys `privacy.p2` and `privacy.p6`.

- [ ] **Step 1:** Append to `p2` and `p6` the same content as Task 2 Steps 0 and 1, without "From version 0.1.3" (the app text ships with 0.1.3).
- [ ] **Step 2:** `pnpm test` (locale key-parity test, if present) and `check-invisible` → clean. Commit `docs(mobile): privacy text for the rules update report`.

### Task 8: Built-in rules = published release

**Files:**
- Create: `rules/src/sync-app.ts`
- Modify: `rules/package.json` (script `sync-app`), `apps/mobile/package.json` (`"sync-rules": "pnpm --filter @linkclean/rules sync-app"`), delete `apps/mobile/scripts/sync-rules.mjs`
- Test: `rules/test/unit/published.test.ts` (extend)

**Interfaces:** Consumes `fetchPublished` (Task 1). Produces `export async function syncApp(baseUrl: string, outFile: string, fetchText: (url: string) => Promise<string>): Promise<string>` — writes `rulesText` byte-for-byte to `outFile` only after `fetchPublished` succeeds; returns the version; on error throws and leaves `outFile` untouched. CLI default `outFile` = `here('../../apps/mobile/assets/rules.json')` (resolved from `import.meta.url`), base = `https://ttylab80387.github.io/untail/`.

- [ ] **Step 1: Failing tests:** `syncApp writes the published text byte-for-byte` (temp dir); `syncApp leaves the existing file untouched when the hash mismatches`.
- [ ] **Step 2–4:** fail → implement → `pnpm test && pnpm typecheck` pass.
- [ ] **Step 5:** Run `pnpm mobile sync-rules`; check `head -c 60 apps/mobile/assets/rules.json` shows the live version and `shasum -a 256` equals the live meta sha256. Add a one-line comment at the top of `sync-app.ts`: release order = push rules to main → wait for Pages → `pnpm mobile sync-rules` → commit → build.
- [ ] **Step 6:** Commit `build(mobile): bundle the published rules release instead of a local build`.

### Task 9: Device check

- [ ] Build and install the release APK on the Xperia 5 II (and vivo if connected); follow spec §4 device steps: airplane mode → `failed-network` line; back online + foreground → line clears and "Last updated" shows; force three network failures → "Report update problem" opens the mail app with the listed lines, nothing sent; a phone whose cache is older than the new built-in shows "(built in)".
- [ ] Record results; no commit unless a fix is needed (then TDD it in the owning task's file).

**Stop after Part 2:** whole-branch review, then ask the user before merging into `feat/qs-tile`.
