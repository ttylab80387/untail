import type { ProcessResult, RuleBundle } from '@linkclean/core';
import type { CleanOutcome } from './cleaner';
import { decideTileOutcome, linkChanged, precheckTile } from './tileOutcome';
import type { TileDecision, TileToast } from './tileOutcome';

export const FOCUS_TIMEOUT_MS = 1500;
export const EMPTY_RETRY_MS = 100;

// Tracks the one tile request that may still copy, toast and return (spec §3.1, §4.6).
export interface TileGate {
  start(): number | null; // null while a request runs: a second tap is the same request
  isValid(id: number): boolean; // may still copy, toast, return and write history
  showsResult(id: number): boolean; // its result may still replace the home screen
  busy(): boolean; // a request owns the clipboard; automatic clipboard work must wait
  leave(): void; // Untail went to the background
  cancel(): void; // the user did something else in Untail
  finish(id: number): void;
}

export function createTileGate(): TileGate {
  let seq = 0;
  let active: number | null = null;
  let left = false;
  return {
    start() {
      if (active !== null && !left) return null;
      seq += 1;
      active = seq;
      left = false;
      return active;
    },
    isValid: (id) => active === id && !left,
    showsResult: (id) => active === id,
    busy: () => active !== null,
    leave() {
      if (active !== null) left = true;
    },
    cancel() {
      active = null;
    },
    finish(id) {
      if (active === id) active = null;
    },
  };
}

export interface CleanPolicy {
  copyIf(r: ProcessResult): boolean;
  recordIf(r: ProcessResult): boolean;
}

export interface TileFlowDeps {
  waitForFocus(timeoutMs: number): Promise<boolean>;
  readClipboard(): Promise<string>;
  sleep(ms: number): Promise<void>;
  rules(): RuleBundle;
  // Runs the normal cleaning queue with the tile's copy and history conditions.
  clean(text: string, policy: CleanPolicy): Promise<CleanOutcome | null>;
  isValid(): boolean;
  noteSeen(text: string): void; // the clipboard watch must not offer this text again
  resetScreen(): void; // rows 2-4: clear the input box and any older result
  showNotice(n: 'no_link' | 'unreadable' | null): void;
  toast(t: TileToast): void;
  moveToBack(): Promise<boolean>;
  remember(r: { row: 1 | 2; removed: number; expandedOnly: boolean }): Promise<void>;
  forget(): Promise<void>; // rows 3-6: an older "last tile tap" line must not stay on screen
}

// Android only lets the focused app read the clipboard, so wait for focus, then read once more if the
// first read came back empty (focus can arrive a moment after the shade closes). Never read once the
// request is invalid: the user may have left.
async function readAfterFocus(d: TileFlowDeps): Promise<string | null> {
  const focused = await d.waitForFocus(FOCUS_TIMEOUT_MS).catch(() => false);
  if (!focused || !d.isValid()) return null;
  try {
    const first = await d.readClipboard();
    if (first !== '') return first;
    await d.sleep(EMPTY_RETRY_MS);
    if (!d.isValid()) return null;
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
  if (text !== null && pre?.kind === 'needs_cleaning' && d.isValid()) {
    outcome = await d.clean(text, {
      copyIf: (r) => r.status === 'clean' && linkChanged(r),
      // History follows the setting for rows 1, 5 and 6 only (spec §3.2).
      recordIf: (r) => d.isValid() && (r.status !== 'clean' || linkChanged(r)),
    });
  }
  const decision = decideTileOutcome({ read: text === null ? 'unreadable' : 'ok', pre, outcome, wasInForeground, valid: d.isValid() });
  if (decision.row === 7) return decision;
  if (decision.row >= 2 && decision.row <= 4) d.resetScreen();
  d.showNotice(decision.row === 3 ? 'no_link' : decision.row === 4 ? 'unreadable' : null);
  if (decision.remember) await d.remember(decision.remember).catch(() => undefined);
  else await d.forget().catch(() => undefined);
  // Toast first, while Untail is still on screen, so it is not queued behind system toasts.
  if (decision.toast && d.isValid()) d.toast(decision.toast);
  if (decision.goBack && d.isValid()) await d.moveToBack().catch(() => false);
  return decision;
}
