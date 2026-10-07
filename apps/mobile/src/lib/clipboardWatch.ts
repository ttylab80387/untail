import { cleanUrl, extractUrl, findExpander, unwrapUrl } from '@linkclean/core';
import type { RuleBundle } from '@linkclean/core';
import type { CleanOutcome } from './cleaner';

// Decides whether to offer cleaning a link found on the clipboard.
// State lives in memory only; nothing about the clipboard is ever persisted.
export interface WatchState {
  lastSeenText: string | null; // last clipboard text we offered or wrote ourselves
  selfWrote: boolean; // iOS: the app wrote the clipboard since the last check
}

export function initialWatchState(): WatchState {
  return { lastSeenText: null, selfWrote: false };
}

export function noteSelfWrite(_s: WatchState, text: string): WatchState {
  return { lastSeenText: text, selfWrote: true };
}

// Offline check: is there anything to clean? Tracking params, a redirect wrapper or a share link.
export function needsCleaning(url: string, rules: RuleBundle): boolean {
  return (
    unwrapUrl(url, rules.providers).url !== url ||
    findExpander(url, rules.expanders) !== undefined ||
    cleanUrl(url, rules.providers).removed.length > 0
  );
}

// For clipboard text the app can read (Android always; iOS in automatic mode), skip text it has
// already seen and links that are already clean (such as one the app copied in an earlier session).
export function decideText(text: string, s: WatchState, rules: RuleBundle): { url: string | null; next: WatchState } {
  const found = text && text !== s.lastSeenText ? extractUrl(text) : null;
  const url = found && needsCleaning(found, rules) ? found : null;
  return { url, next: { lastSeenText: text || s.lastSeenText, selfWrote: false } };
}

// iOS only reveals whether a URL is present (reading it would prompt), so the best it can do
// is skip the check right after the app copied its own clean link.
export function decideIos(hasUrl: boolean, s: WatchState): { offer: boolean; next: WatchState } {
  return { offer: hasUrl && !s.selfWrote, next: { ...s, selfWrote: false } };
}

// After an automatic clean, the original clipboard text can be restored only if something else replaced it.
export function undoTarget(originalText: string, outcome: CleanOutcome): string | null {
  return outcome.copied && outcome.result.cleanUrl !== originalText ? originalText : null;
}
