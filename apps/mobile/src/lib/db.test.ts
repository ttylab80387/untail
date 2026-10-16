import { beforeEach, describe, expect, it } from 'vitest';
import type { ProcessResult } from '@linkclean/core';
import { addHistory, clearHistory, deleteHistory, getHistory, getKv, HISTORY_LIMIT, listHistory, migrate, setKv } from './db';
import type { Db } from './db';
import { nodeDb } from './testing/nodeDb';

const result = (n: number, extra: Partial<ProcessResult> = {}): ProcessResult => ({
  originalUrl: `https://ex.com/${n}?utm_source=x`,
  cleanUrl: `https://ex.com/${n}`,
  status: 'clean',
  removed: [{ key: 'utm_source', value: 'x', category: 'campaign', risk: 'low', desc: 'utm' }],
  hops: [`https://ex.com/${n}?utm_source=x`],
  ...extra,
});

let db: Db;
beforeEach(async () => {
  db = nodeDb();
  await migrate(db);
});

describe('migrate', () => {
  it('can run twice', async () => {
    await expect(migrate(db)).resolves.toBeUndefined();
  });
});

describe('history', () => {
  it('lists newest first and round-trips the full result', async () => {
    await addHistory(db, result(1), 1000);
    await addHistory(db, result(2, { status: 'partial', reason: 'network', hops: ['a', 'b'] }), 2000);
    const list = await listHistory(db);
    expect(list.map((e) => e.result.cleanUrl)).toEqual(['https://ex.com/2', 'https://ex.com/1']);
    expect(list[0]).toMatchObject({ createdAt: 2000, result: { status: 'partial', reason: 'network', hops: ['a', 'b'] } });
    // Stored fields round-trip; destination is derived from them on read.
    expect(list[1]!.result).toEqual({ ...result(1), destination: expect.objectContaining({ complete: true }) });
  });

  it(`keeps only the newest ${HISTORY_LIMIT} entries`, async () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) await addHistory(db, result(i), i);
    const list = await listHistory(db);
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list.at(-1)!.result.cleanUrl).toBe('https://ex.com/5');
  });

  it('gets, deletes and clears entries', async () => {
    await addHistory(db, result(1), 1);
    await addHistory(db, result(2), 2);
    const [newest] = await listHistory(db);
    expect((await getHistory(db, newest!.id))!.result.cleanUrl).toBe('https://ex.com/2');
    await deleteHistory(db, newest!.id);
    expect(await getHistory(db, newest!.id)).toBeNull();
    await clearHistory(db);
    expect(await listHistory(db)).toEqual([]);
  });
});

describe('kv', () => {
  it('returns null for missing keys and overwrites existing ones', async () => {
    expect(await getKv(db, 'a')).toBeNull();
    await setKv(db, 'a', '1');
    await setKv(db, 'a', '2');
    expect(await getKv(db, 'a')).toBe('2');
  });
});

describe('history rows carry derived link-safety fields', () => {
  it('derives the destination reached so far and the kept hidden characters', async () => {
    const post = 'https://www.threads.com/@a/post/B';
    await addHistory(
      db,
      result(3, { originalUrl: 'https://www.threads.com/share/X\u200D/', cleanUrl: 'https://www.threads.com/share/X\u200D/', status: 'partial', reason: 'network', hops: ['https://www.threads.com/share/X\u200D/', post] }),
      3000,
    );
    const [entry] = await listHistory(db);
    expect(entry!.result.destination).toMatchObject({ complete: false, site: { domain: 'threads.com' } });
    expect(entry!.result.hiddenKept?.map((h) => h.code)).toEqual(['U+200D']);
  });
  it('judges kept hidden characters on the clean link, not on the short link', async () => {
    await addHistory(db, result(5, { originalUrl: 'https://bit.ly/TEST', cleanUrl: 'https://example.com/a\u200Db', hops: ['https://bit.ly/TEST', 'https://example.com/a\u200Db'] }), 5000);
    const [entry] = await listHistory(db);
    expect(entry!.result.hiddenKept?.map((h) => h.code)).toEqual(['U+200D']);
  });
  it('gives rows written before these fields existed the same derived fields', async () => {
    await addHistory(db, result(4), 4000);
    const [entry] = await listHistory(db);
    expect(entry!.result.destination).toMatchObject({ complete: true, site: { domain: 'ex.com' } });
    expect(entry!.result.hiddenKept).toBeUndefined();
  });
});
