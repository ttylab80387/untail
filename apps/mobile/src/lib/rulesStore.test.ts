import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RuleBundle } from '@linkclean/core';
import { getKv, migrate, setKv } from './db';
import type { Db } from './db';
import {
  CHECK_INTERVAL_MS,
  MISMATCH_RETRY_MS,
  compareVersions,
  loadRules,
  readStatus,
  settingsLines,
  shouldOfferReport,
  updateRules,
} from './rulesStore';
import type { UpdateDeps, UpdateStatus } from './rulesStore';
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
const BUNDLED = bundle('2026.01.01.0000');
const REMOTE = '2026.10.29.1010';

function site(rules: unknown, meta?: Record<string, unknown>, opts: { rulesFails?: boolean } = {}) {
  const text = typeof rules === 'string' ? rules : JSON.stringify(rules);
  const m = meta ?? { schemaVersion: 1, version: REMOTE, sha256: shaSync(text) };
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
  bundledVersion: BUNDLED.version,
  ...over,
});

describe('loadRules', () => {
  const cache = (version: string) => {
    const text = JSON.stringify(bundle(version));
    return setKv(db, 'rules.cache', JSON.stringify({ sha256: shaSync(text), text }));
  };

  it('uses downloaded rules only when newer than built-in', async () => {
    await cache(REMOTE);
    expect(await loadRules(db, BUNDLED)).toEqual({ rules: bundle(REMOTE), source: 'downloaded' });
  });

  it('uses built-in rules when the cache has the same version', async () => {
    await cache(BUNDLED.version);
    expect(await loadRules(db, BUNDLED)).toEqual({ rules: BUNDLED, source: 'built-in' });
  });

  it('uses built-in rules when they are newer than the cache', async () => {
    await cache('2025.12.31.2359');
    expect(await loadRules(db, BUNDLED)).toEqual({ rules: BUNDLED, source: 'built-in' });
  });

  it('uses built-in rules when the cached version is malformed', async () => {
    await cache('remote');
    expect((await loadRules(db, BUNDLED)).source).toBe('built-in');
  });

  it('uses the bundled rules when nothing is cached', async () => {
    expect((await loadRules(db, BUNDLED)).rules).toBe(BUNDLED);
  });

  it('falls back to bundled rules when the cache is corrupted or invalid', async () => {
    await setKv(db, 'rules.cache', '{broken');
    expect((await loadRules(db, BUNDLED)).rules).toBe(BUNDLED);
    const bad = JSON.stringify({ ...bundle('x'), expanders: {} });
    await setKv(db, 'rules.cache', JSON.stringify({ sha256: shaSync(bad), text: bad }));
    expect((await loadRules(db, BUNDLED)).rules).toBe(BUNDLED);
  });
});

describe('updateRules', () => {
  it('is disabled without a base URL', async () => {
    expect(await updateRules(deps(site(bundle('r')).fetchText, NOW, { baseUrl: '' }))).toBe('disabled');
  });

  it('downloads, verifies and caches a new bundle', async () => {
    expect(await updateRules(deps(site(bundle(REMOTE)).fetchText))).toBe('updated');
    expect((await loadRules(db, BUNDLED)).rules.version).toBe(REMOTE);
  });

  it('throttles completed checks for 24 hours unless forced', async () => {
    const s = site(bundle(REMOTE));
    await updateRules(deps(s.fetchText));
    s.calls.length = 0;
    expect(await updateRules(deps(s.fetchText, NOW + CHECK_INTERVAL_MS - 1))).toBe('throttled');
    expect(s.calls).toEqual([]);
    expect(await updateRules(deps(s.fetchText, NOW + 1), { force: true })).toBe('up-to-date');
  });

  it('skips the download when the cached bundle matches', async () => {
    const s = site(bundle(REMOTE));
    await updateRules(deps(s.fetchText));
    s.calls.length = 0;
    expect(await updateRules(deps(s.fetchText), { force: true })).toBe('up-to-date');
    expect(s.calls).toEqual([`${BASE}rules.meta.json`]);
  });

  it('repairs a corrupted cache even when its stored hash matches', async () => {
    const s = site(bundle(REMOTE));
    await updateRules(deps(s.fetchText));
    await setKv(db, 'rules.cache', JSON.stringify({ sha256: s.sha256, text: '{broken' }));
    expect(await updateRules(deps(s.fetchText), { force: true })).toBe('updated');
    expect((await loadRules(db, BUNDLED)).rules.version).toBe(REMOTE);
  });

  it('rejects a bundle whose hash does not match', async () => {
    const s = site(bundle(REMOTE), { schemaVersion: 1, version: REMOTE, sha256: 'deadbeef' });
    expect(await updateRules(deps(s.fetchText))).toBe('failed-mismatch');
    expect((await loadRules(db, BUNDLED)).rules).toBe(BUNDLED);
  });

  it('rejects a structurally invalid bundle', async () => {
    expect(await updateRules(deps(site({ ...bundle(REMOTE), expanders: {} }).fetchText))).toBe('failed-unsupported');
    expect((await loadRules(db, BUNDLED)).rules).toBe(BUNDLED);
  });

  it('rejects unsupported meta schema versions', async () => {
    const s = site(bundle(REMOTE), { schemaVersion: 2, version: REMOTE, sha256: 'x' });
    expect(await updateRules(deps(s.fetchText))).toBe('failed-unsupported');
  });

  it('does not throttle after a failed check', async () => {
    expect(await updateRules(deps(site(bundle(REMOTE), undefined, { rulesFails: true }).fetchText))).toBe('failed-network');
    expect(Number(await getKv(db, 'rules.checkedAt'))).toBe(0);
    expect(await updateRules(deps(site(bundle(REMOTE)).fetchText))).toBe('updated');
  });

  it('throttles after a definite failure so a broken site is not polled on every launch', async () => {
    const s = site(bundle(REMOTE), { schemaVersion: 2, version: REMOTE, sha256: 'x' });
    expect(await updateRules(deps(s.fetchText))).toBe('failed-unsupported');
    s.calls.length = 0;
    expect(await updateRules(deps(s.fetchText, NOW + 1))).toBe('throttled');
    expect(s.calls).toEqual([]);
  });

  it('reports storage errors as failed-network instead of throwing', async () => {
    const broken: Db = {
      ...db,
      getFirstAsync: async () => {
        throw new Error('disk I/O error');
      },
    };
    expect(await updateRules(deps(site(bundle(REMOTE)).fetchText, NOW, { db: broken }))).toBe('failed-network');
    expect((await loadRules(broken, BUNDLED)).rules).toBe(BUNDLED);
  });
});

const offline = async (url: string): Promise<string> => {
  throw new Error(`offline: ${url}`);
};
const fixedMeta = (text: string) => async (url: string) => {
  if (url === `${BASE}rules.meta.json`) return text;
  throw new Error(`unexpected ${url}`);
};

describe('updateRules failure reasons', () => {
  it('classifies a thrown fetch as failed-network and does not record the check', async () => {
    expect(await updateRules(deps(offline))).toBe('failed-network');
    const s = site(bundle(REMOTE));
    expect(await updateRules(deps(s.fetchText, NOW + 1))).toBe('updated');
  });

  it('a network failure after an earlier success today still retries on the next open', async () => {
    const s = site(bundle(REMOTE));
    expect(await updateRules(deps(s.fetchText))).toBe('updated');
    expect(await updateRules(deps(offline, NOW + 3600000), { force: true })).toBe('failed-network');
    s.calls.length = 0;
    expect(await updateRules(deps(s.fetchText, NOW + 3600001))).toBe('up-to-date');
    expect(s.calls).toEqual([`${BASE}rules.meta.json`]);
  });

  it('classifies an HTML meta page as failed-network', async () => {
    expect(await updateRules(deps(fixedMeta('<html><body>Sign in to Wi-Fi</body></html>')))).toBe('failed-network');
    expect(Number(await getKv(db, 'rules.checkedAt'))).toBe(0);
  });

  it('classifies meta null, {} and a meta without sha256 as failed-invalid, not unsupported', async () => {
    for (const text of ['null', '{}', JSON.stringify({ schemaVersion: 1, version: 'v' })]) {
      expect(await updateRules(deps(fixedMeta(text)), { force: true })).toBe('failed-invalid');
    }
  });

  it('classifies a hash mismatch as failed-mismatch and retries after 15 minutes', async () => {
    const s = site(bundle(REMOTE), { schemaVersion: 1, version: REMOTE, sha256: 'deadbeef' });
    expect(await updateRules(deps(s.fetchText))).toBe('failed-mismatch');
    s.calls.length = 0;
    expect(await updateRules(deps(s.fetchText, NOW + MISMATCH_RETRY_MS - 1))).toBe('throttled');
    expect(s.calls).toEqual([]);
    expect(await updateRules(deps(s.fetchText, NOW + MISMATCH_RETRY_MS))).toBe('failed-mismatch');
    expect(s.calls.length).toBeGreaterThan(0);
  });

  it('classifies schemaVersion 2 and an invalid bundle as failed-unsupported', async () => {
    const v2 = site(bundle(REMOTE), { schemaVersion: 2, version: REMOTE, sha256: 'x' });
    expect(await updateRules(deps(v2.fetchText))).toBe('failed-unsupported');
    const bad = site({ ...bundle(REMOTE), expanders: {} });
    expect(await updateRules(deps(bad.fetchText), { force: true })).toBe('failed-unsupported');
  });

  it('classifies non-JSON rules as failed-invalid', async () => {
    expect(await updateRules(deps(site('{not json').fetchText))).toBe('failed-invalid');
  });

  it('returns up-to-date without downloading rules.json when meta.version equals the built-in version and nothing newer is cached', async () => {
    const s = site(bundle(BUNDLED.version), { schemaVersion: 1, version: BUNDLED.version, sha256: 'abc' });
    expect(await updateRules(deps(s.fetchText))).toBe('up-to-date');
    expect(s.calls).toEqual([`${BASE}rules.meta.json`]);
  });
});

describe('update status', () => {
  it('records lastSuccessAt and clears the failure on up-to-date and updated', async () => {
    const s = site(bundle(REMOTE));
    expect(await updateRules(deps(offline))).toBe('failed-network');
    expect(await updateRules(deps(s.fetchText, NOW + 5))).toBe('updated');
    expect(await readStatus(db)).toEqual({ lastSuccessAt: NOW + 5, failure: null });
    expect(await updateRules(deps(offline, NOW + 6), { force: true })).toBe('failed-network');
    expect(await updateRules(deps(s.fetchText, NOW + 7), { force: true })).toBe('up-to-date');
    expect(await readStatus(db)).toEqual({ lastSuccessAt: NOW + 7, failure: null });
  });

  it('a failure keeps the earlier lastSuccessAt', async () => {
    await updateRules(deps(site(bundle(REMOTE)).fetchText));
    await updateRules(deps(offline, NOW + 9), { force: true });
    expect(await readStatus(db)).toEqual({ lastSuccessAt: NOW, failure: { reason: 'network', at: NOW + 9, count: 1 } });
  });

  it('counts the same reason in a row and restarts the count when the reason changes', async () => {
    const mismatch = site(bundle(REMOTE), { schemaVersion: 1, version: REMOTE, sha256: 'deadbeef' });
    await updateRules(deps(offline, NOW), { force: true });
    await updateRules(deps(offline, NOW + 1), { force: true });
    expect((await readStatus(db)).failure).toEqual({ reason: 'network', at: NOW + 1, count: 2 });
    await updateRules(deps(mismatch.fetchText, NOW + 2), { force: true });
    expect((await readStatus(db)).failure).toEqual({ reason: 'mismatch', at: NOW + 2, count: 1 });
  });

  it('throttled leaves the status unchanged', async () => {
    await updateRules(deps(site(bundle(REMOTE)).fetchText));
    const before = await readStatus(db);
    expect(await updateRules(deps(offline, NOW + 1))).toBe('throttled');
    expect(await readStatus(db)).toEqual(before);
  });

  it('readStatus returns empty status for a corrupted record', async () => {
    await setKv(db, 'rules.status', '{broken');
    expect(await readStatus(db)).toEqual({ lastSuccessAt: null, failure: null });
  });

  it('shouldOfferReport', () => {
    const st = (reason: 'network' | 'unsupported' | 'invalid', count: number): UpdateStatus => ({
      lastSuccessAt: null,
      failure: { reason, at: 1, count },
    });
    expect(shouldOfferReport(st('network', 2))).toBe(false);
    expect(shouldOfferReport(st('network', 3))).toBe(true);
    expect(shouldOfferReport(st('unsupported', 1))).toBe(true);
    expect(shouldOfferReport(st('invalid', 1))).toBe(true);
    expect(shouldOfferReport({ lastSuccessAt: 1, failure: null })).toBe(false);
  });
});

describe('compareVersions', () => {
  it('orders valid versions and puts malformed ones first', () => {
    expect(compareVersions('2026.10.29.1010', '2026.10.22.1441')).toBeGreaterThan(0);
    expect(compareVersions('2026.10.22.1441', '2026.10.22.1441')).toBe(0);
    expect(compareVersions('bad', '2026.10.22.1441')).toBeLessThan(0);
    expect(compareVersions('2026.10.22.1441', 'remote')).toBeGreaterThan(0);
    expect(compareVersions('bad', 'worse')).toBe(0);
  });
});

describe('settingsLines', () => {
  const failed: UpdateStatus = { lastSuccessAt: 1, failure: { reason: 'network', at: 2, count: 1 } };
  const clean: UpdateStatus = { lastSuccessAt: 3, failure: null };

  it('hides a stale manual failure once the stored status has recovered', () => {
    expect(settingsLines(clean, 'failed-network')).toEqual({ failure: null, manualKey: null });
  });
  it('shows only the stored failure when a manual success is older', () => {
    expect(settingsLines(failed, 'up-to-date')).toEqual({ failure: 'network', manualKey: null });
  });
  it('shows a manual success when nothing failed since', () => {
    expect(settingsLines(clean, 'updated')).toEqual({ failure: null, manualKey: 'updated' });
  });
});
