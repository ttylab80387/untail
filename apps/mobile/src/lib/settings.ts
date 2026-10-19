import { getKv, setKv } from './db';
import type { Db } from './db';

export interface Settings {
  expand: boolean;
  autoCopy: boolean;
  history: boolean;
  detectClipboard: boolean;
  autoClipboard: boolean; // clean and copy a clipboard link without asking (needs detectClipboard)
}

export const DEFAULT_SETTINGS: Settings = {
  expand: true,
  autoCopy: true,
  history: true,
  detectClipboard: true,
  autoClipboard: false,
};

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
