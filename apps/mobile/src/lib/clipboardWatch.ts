import { cleanUrl, extractUrl, findExpander, unwrapUrl } from '@linkclean/core';
import type { RuleBundle } from '@linkclean/core';
import type { CleanOutcome } from './cleaner';

// Decides whether to offer cleaning a link found on the clipboard.
// State lives in memory only; nothing about the clipboard is ever persisted.
export interface WatchState {
  lastSeenText: string | null; // last clipboard text we offered or wrote ourselves
  lastChangeCount: number | null; // iOS: UIPasteboard.changeCount when we last looked or wrote
}

export function initialWatchState(): WatchState {
  return { lastSeenText: null, lastChangeCount: null };
}

// changeCount is the iOS pasteboard count right after the app's own write (null on Android).
export function noteSelfWrite(s: WatchState, text: string, changeCount: number | null = null): WatchState {
  return { lastSeenText: text, lastChangeCount: changeCount ?? s.lastChangeCount };
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
// `fresh` means the clipboard changed since the last check, so notices about the old content are stale.
// `clean` is a new link with nothing to clean, so the screen can show it and the user can tell the check ran.
export function decideText(
  text: string,
  s: WatchState,
  rules: RuleBundle,
): { url: string | null; fresh: boolean; clean: string | null; next: WatchState } {
  const fresh = text !== '' && text !== s.lastSeenText;
  const found = fresh ? extractUrl(text) : null;
  const url = found && needsCleaning(found, rules) ? found : null;
  return { url, fresh, clean: url === null ? found : null, next: { ...s, lastSeenText: text || s.lastSeenText } };
}

// iOS reading the text would prompt, so only the link check and the change count are used.
// An unchanged count means nothing new (including the app's own copy), so nothing is offered or read.
export function decideIos(
  clip: { hasUrl: boolean; changeCount: number },
  s: WatchState,
): { fresh: boolean; offer: boolean; next: WatchState } {
  const fresh = clip.changeCount !== s.lastChangeCount;
  return { fresh, offer: fresh && clip.hasUrl, next: { ...s, lastChangeCount: clip.changeCount } };
}

// After an automatic clean, the original clipboard text can be restored only if something else replaced it.
export function undoTarget(originalText: string, outcome: CleanOutcome): string | null {
  return outcome.copied && outcome.result.cleanUrl !== originalText ? originalText : null;
}
