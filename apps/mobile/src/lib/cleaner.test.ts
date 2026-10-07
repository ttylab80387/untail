import { beforeEach, describe, expect, it } from 'vitest';
import type { FetchFn, RuleBundle } from '@linkclean/core';
import { cleanInput } from './cleaner';
import type { CleanDeps } from './cleaner';
import { listHistory, migrate } from './db';
import type { Db } from './db';
import { DEFAULT_SETTINGS } from './settings';
import { nodeDb } from './testing/nodeDb';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: {
    globalRules: { urlPattern: '.*', rules: ['utm_source'] },
    threads: { urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?threads\\.com(?:[/:?#]|$)', rules: ['xmt'] },
  },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/', shareId: '/share/([^/?#]+)' } },
  knowledge: {},
};

const SHARE = 'https://www.threads.com/share/BAAtest0001/';
const POST = 'https://www.threads.com/@a/post/B?xmt=1';

let db: Db;
let copied: string[];
let fetchCalls: string[];
const fetch: FetchFn = async (url) => {
  fetchCalls.push(url);
  return { url: POST, status: 200 };
};

const deps = (over: Partial<CleanDeps> = {}): CleanDeps => ({
  db,
  rules,
  settings: { ...DEFAULT_SETTINGS },
  locale: 'en',
  fetch,
  userAgent: 'LinkClean/test',
  copy: async (t) => {
    copied.push(t);
  },
  now: () => 1234,
  ...over,
});

beforeEach(async () => {
  db = nodeDb();
  await migrate(db);
  copied = [];
  fetchCalls = [];
});

describe('cleanInput', () => {
  it('copies and records a clean result', async () => {
    const out = await cleanInput('https://ex.com/a?utm_source=x', deps());
    expect(out).toMatchObject({ copied: true, result: { status: 'clean', cleanUrl: 'https://ex.com/a' } });
    expect(copied).toEqual(['https://ex.com/a']);
    expect((await listHistory(db)).map((e) => e.createdAt)).toEqual([1234]);
  });

  it('records but never auto-copies a partial result', async () => {
    const out = await cleanInput(SHARE, deps({ settings: { ...DEFAULT_SETTINGS, expand: false } }));
    expect(out).toMatchObject({ copied: false, result: { status: 'partial', reason: 'expand_disabled' } });
    expect(copied).toEqual([]);
    expect(fetchCalls).toEqual([]);
    expect(await listHistory(db)).toHaveLength(1);
  });

  it('expands share links with the injected fetch', async () => {
    const out = await cleanInput(SHARE, deps());
    expect(out.result).toMatchObject({ status: 'clean', cleanUrl: 'https://www.threads.com/@a/post/B' });
    expect(fetchCalls).toEqual([SHARE]);
  });

  it('ignores input without a URL', async () => {
    const out = await cleanInput('just some text', deps());
    expect(out).toMatchObject({ copied: false, result: { status: 'failed', reason: 'invalid_input' } });
    expect(await listHistory(db)).toEqual([]);
    expect(copied).toEqual([]);
  });

  it('still returns the result when history or clipboard writes fail', async () => {
    const broken: Db = {
      ...db,
      runAsync: async () => {
        throw new Error('disk full');
      },
    };
    const out = await cleanInput('https://ex.com/a?utm_source=x', deps({
      db: broken,
      copy: async () => {
        throw new Error('clipboard denied');
      },
    }));
    expect(out).toMatchObject({ copied: false, result: { status: 'clean', cleanUrl: 'https://ex.com/a' } });
  });

  it('respects the history and auto-copy switches', async () => {
    const out = await cleanInput('https://ex.com/a?utm_source=x', deps({ settings: { expand: true, autoCopy: false, history: false } }));
    expect(out.copied).toBe(false);
    expect(copied).toEqual([]);
    expect(await listHistory(db)).toEqual([]);
  });
});
