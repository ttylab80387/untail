import { extractUrl } from '@linkclean/core';

// Decides whether to offer cleaning a link found on the clipboard.
// State lives in memory only; nothing about the clipboard is ever persisted.
export interface WatchState {
  lastSeenText: string | null; // Android: last clipboard text we offered or wrote ourselves
  selfWrote: boolean; // iOS: the app wrote the clipboard since the last check
}

export function initialWatchState(): WatchState {
  return { lastSeenText: null, selfWrote: false };
}

export function noteSelfWrite(_s: WatchState, text: string): WatchState {
  return { lastSeenText: text, selfWrote: true };
}

// Android can read the text in the foreground, so it can skip text it has already seen.
export function decideAndroid(text: string, s: WatchState): { url: string | null; next: WatchState } {
  const url = text && text !== s.lastSeenText ? extractUrl(text) : null;
  return { url, next: { lastSeenText: text || s.lastSeenText, selfWrote: false } };
}

// iOS only reveals whether a URL is present (reading it would prompt), so the best it can do
// is skip the check right after the app copied its own clean link.
export function decideIos(hasUrl: boolean, s: WatchState): { offer: boolean; next: WatchState } {
  return { offer: hasUrl && !s.selfWrote, next: { ...s, selfWrote: false } };
}
