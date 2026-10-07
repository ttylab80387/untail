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
  it('defaults to everything on', async () => {
    expect(await loadSettings(db)).toEqual({ expand: true, autoCopy: true, history: true });
    expect(DEFAULT_SETTINGS).toEqual({ expand: true, autoCopy: true, history: true });
  });

  it('saves and loads', async () => {
    await saveSettings(db, { expand: false, autoCopy: true, history: false });
    expect(await loadSettings(db)).toEqual({ expand: false, autoCopy: true, history: false });
  });

  it('falls back to defaults on corrupted JSON', async () => {
    await setKv(db, 'settings', '{not json');
    expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing or non-boolean fields with defaults', async () => {
    await setKv(db, 'settings', JSON.stringify({ expand: false, autoCopy: 'no' }));
    expect(await loadSettings(db)).toEqual({ expand: false, autoCopy: true, history: true });
  });
});
