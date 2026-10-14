import { Platform } from 'react-native';

export interface Colors {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  onAccent: string; // text on an accent-filled button
  ok: string;
  warn: string;
  danger: string;
}

// "Night utility" look. The app is dark only for now; a light palette could come back later (e.g. as a Pro option).
const dark: Colors = {
  bg: '#0d1714',
  card: '#14211d',
  text: '#e6efe9',
  muted: '#7f9c92',
  border: '#2b5a4e',
  accent: '#5eead4',
  onAccent: '#0d1714',
  ok: '#5eead4',
  warn: '#fb923c',
  danger: '#f87171',
};

export function useColors(): Colors {
  return dark;
}

// System monospace font for URLs, parameter names and the input box.
export const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
