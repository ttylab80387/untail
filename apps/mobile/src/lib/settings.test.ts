import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, setKv } from './db';
import type { Db } from './db';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
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
