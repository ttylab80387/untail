// apps/mobile/src/lib/tileOutcome.ts
import { extractUrlDetailed } from '@linkclean/core';
import type { ProcessResult, RuleBundle } from '@linkclean/core';
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

// originalUrl is the extracted link, so surrounding text never counts as a change.
export function linkChanged(r: ProcessResult): boolean {
  return r.removed.length > 0 || r.cleanUrl !== r.originalUrl;
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

const alreadyClean = (f: TileFacts): TileDecision => ({
  row: 2,
  toast: { kind: 'noTracking' },
  goBack: !f.wasInForeground,
  remember: { row: 2, removed: 0, expandedOnly: false },
});

export function decideTileOutcome(f: TileFacts): TileDecision {
  if (!f.valid) return stay(7);
  if (f.read === 'unreadable' || f.pre === null) return stay(4);
  if (f.pre.kind === 'no_link') return stay(3);
  if (f.pre.kind === 'already_clean') return alreadyClean(f);
  const out = f.outcome;
  if (!out || out.result.status !== 'clean') return stay(6);
  if (!linkChanged(out.result)) return alreadyClean(f);
  if (!out.copied) return stay(5);
  const removed = out.result.removed.length;
  return {
    row: 1,
    toast: removed > 0 ? { kind: 'copied', removed } : { kind: 'expanded' },
    goBack: !f.wasInForeground,
    remember: { row: 1, removed, expandedOnly: removed === 0 },
  };
}
