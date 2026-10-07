import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RuleBundle } from '@linkclean/core';
import { getKv, migrate, setKv } from './db';
import type { Db } from './db';
import { CHECK_INTERVAL_MS, loadRules, updateRules } from './rulesStore';
import type { UpdateDeps } from './rulesStore';
import { nodeDb } from './testing/nodeDb';

const BASE = 'https://example.github.io/linkclean/';
const shaSync = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const sha = async (t: string) => shaSync(t);
const NOW = CHECK_INTERVAL_MS * 10;

const bundle = (version: string): RuleBundle => ({
  schemaVersion: 1,
  version,
  providers: { globalRules: { urlPattern: '.*', rules: ['utm_source'] } },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/' } },
  knowledge: {},
});
const BUNDLED = bundle('bundled');

function site(rules: unknown, meta?: Record<string, unknown>, opts: { rulesFails?: boolean } = {}) {
  const text = typeof rules === 'string' ? rules : JSON.stringify(rules);
  const m = meta ?? { schemaVersion: 1, version: 'remote', sha256: shaSync(text) };
  const calls: string[] = [];
  const fetchText = async (url: string) => {
    calls.push(url);
    if (url === `${BASE}rules.meta.json`) return JSON.stringify(m);
    if (url === `${BASE}rules.json` && !opts.rulesFails) return text;
    throw new Error(`fetch failed: ${url}`);
  };
  return { fetchText, calls, sha256: String(m.sha256) };
}

let db: Db;
beforeEach(async () => {
  db = nodeDb();
  await migrate(db);
});

const deps = (fetchText: UpdateDeps['fetchText'], now = NOW, over: Partial<UpdateDeps> = {}): UpdateDeps => ({
  db,
  baseUrl: BASE,
  fetchText,
  sha256: sha,
  now,
  ...over,
});

describe('loadRules', () => {
  it('uses the bundled rules when nothing is cached', async () => {
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
  });

  it('falls back to bundled rules when the cache is corrupted or invalid', async () => {
    await setKv(db, 'rules.cache', '{broken');
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
    const bad = JSON.stringify({ ...bundle('x'), expanders: {} });
    await setKv(db, 'rules.cache', JSON.stringify({ sha256: shaSync(bad), text: bad }));
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
  });
});

describe('updateRules', () => {
  it('is disabled without a base URL', async () => {
    expect(await updateRules(deps(site(bundle('r')).fetchText, NOW, { baseUrl: '' }))).toBe('disabled');
  });

  it('downloads, verifies and caches a new bundle', async () => {
    expect(await updateRules(deps(site(bundle('remote')).fetchText))).toBe('updated');
    expect((await loadRules(db, BUNDLED)).version).toBe('remote');
  });

  it('throttles completed checks for 24 hours unless forced', async () => {
    const s = site(bundle('remote'));
    await updateRules(deps(s.fetchText));
    s.calls.length = 0;
    expect(await updateRules(deps(s.fetchText, NOW + CHECK_INTERVAL_MS - 1))).toBe('throttled');
    expect(s.calls).toEqual([]);
    expect(await updateRules(deps(s.fetchText, NOW + 1), { force: true })).toBe('up-to-date');
  });

  it('skips the download when the cached bundle matches', async () => {
    const s = site(bundle('remote'));
    await updateRules(deps(s.fetchText));
    s.calls.length = 0;
    expect(await updateRules(deps(s.fetchText), { force: true })).toBe('up-to-date');
    expect(s.calls).toEqual([`${BASE}rules.meta.json`]);
  });

  it('repairs a corrupted cache even when its stored hash matches', async () => {
    const s = site(bundle('remote'));
    await updateRules(deps(s.fetchText));
    await setKv(db, 'rules.cache', JSON.stringify({ sha256: s.sha256, text: '{broken' }));
    expect(await updateRules(deps(s.fetchText), { force: true })).toBe('updated');
    expect((await loadRules(db, BUNDLED)).version).toBe('remote');
  });

  it('rejects a bundle whose hash does not match', async () => {
    const s = site(bundle('remote'), { schemaVersion: 1, version: 'remote', sha256: 'deadbeef' });
    expect(await updateRules(deps(s.fetchText))).toBe('failed');
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
  });

  it('rejects a structurally invalid bundle', async () => {
    expect(await updateRules(deps(site({ ...bundle('remote'), expanders: {} }).fetchText))).toBe('failed');
    expect(await loadRules(db, BUNDLED)).toBe(BUNDLED);
  });

  it('rejects unsupported meta schema versions', async () => {
    const s = site(bundle('remote'), { schemaVersion: 2, version: 'remote', sha256: 'x' });
    expect(await updateRules(deps(s.fetchText))).toBe('failed');
  });

  it('does not throttle after a failed check', async () => {
    expect(await updateRules(deps(site(bundle('remote'), undefined, { rulesFails: true }).fetchText))).toBe('failed');
    expect(await getKv(db, 'rules.checkedAt')).toBeNull();
    expect(await updateRules(deps(site(bundle('remote')).fetchText))).toBe('updated');
  });

  it('reports storage errors as failed instead of throwing', async () => {
    const broken: Db = {
      ...db,
      getFirstAsync: async () => {
        throw new Error('disk I/O error');
      },
    };
    expect(await updateRules(deps(site(bundle('remote')).fetchText, NOW, { db: broken }))).toBe('failed');
    expect(await loadRules(broken, BUNDLED)).toBe(BUNDLED);
  });
});
