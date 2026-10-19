import { beforeEach, describe, expect, it } from 'vitest';
import { getKv, migrate, setKv } from './db';
import type { Db } from './db';
import { DEFAULT_SETTINGS, clearLastTileResult, formatHm, loadLastTileResult, loadSettings, saveLastTileResult, saveSettings } from './settings';
import { nodeDb } from './testing/nodeDb';

let db: Db;
beforeEach(async () => {
  db = nodeDb();
  await migrate(db);
});

describe('settings', () => {
  it('defaults to everything on except automatic clipboard cleaning', async () => {
    const want = { expand: true, autoCopy: true, history: true, detectClipboard: true, autoClipboard: false };
    expect(await loadSettings(db)).toEqual(want);
    expect(DEFAULT_SETTINGS).toEqual(want);
  });

  it('saves and loads', async () => {
    const s = { expand: false, autoCopy: true, history: false, detectClipboard: false, autoClipboard: true };
    await saveSettings(db, s);
    expect(await loadSettings(db)).toEqual(s);
  });

  it('falls back to defaults on corrupted JSON', async () => {
    await setKv(db, 'settings', '{not json');
    expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing or non-boolean fields with defaults', async () => {
    await setKv(db, 'settings', JSON.stringify({ expand: false, autoCopy: 'no' }));
    expect(await loadSettings(db)).toEqual({ ...DEFAULT_SETTINGS, expand: false });
  });
});

describe('last tile result', () => {
  it('round-trips and never stores a URL', async () => {
    expect(await loadLastTileResult(db)).toBeNull();
    await saveLastTileResult(db, { row: 1, removed: 2, expandedOnly: false, at: 1_700_000_000_000 });
    expect(await loadLastTileResult(db)).toEqual({ row: 1, removed: 2, expandedOnly: false, at: 1_700_000_000_000 });
    expect(await getKv(db, 'lastTileResult')).not.toMatch(/https?:/);
  });

  it('clears', async () => {
    await saveLastTileResult(db, { row: 2, removed: 0, expandedOnly: false, at: 1 });
    await clearLastTileResult(db);
    expect(await loadLastTileResult(db)).toBeNull();
  });

  it('ignores malformed stored values', async () => {
    await setKv(db, 'lastTileResult', '{"row":9}');
    expect(await loadLastTileResult(db)).toBeNull();
    await setKv(db, 'lastTileResult', 'not json');
    expect(await loadLastTileResult(db)).toBeNull();
  });

  it('formats local hours and minutes', () => {
    const at = new Date(2026, 9, 19, 7, 5).getTime();
    expect(formatHm(at)).toBe('07:05');
  });
});
