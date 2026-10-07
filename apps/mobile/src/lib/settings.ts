import { getKv, setKv } from './db';
import type { Db } from './db';

export interface Settings {
  expand: boolean;
  autoCopy: boolean;
  history: boolean;
  detectClipboard: boolean;
}

export const DEFAULT_SETTINGS: Settings = { expand: true, autoCopy: true, history: true, detectClipboard: true };

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
