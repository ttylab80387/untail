import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { RuleBundle } from '@linkclean/core';
import { sha256 } from '../../src/bundle';
import { CDN_SETTLE_MS, cdnWaitMs, lastPagesDeploy, settleWaitMs } from '../../src/pages';
import { reuseDist } from '../../src/reuse';

const BASE = 'https://example.github.io/untail/';

const bundle = (version: string, rules = ['utm_source']): RuleBundle => ({
  schemaVersion: 1,
  version,
  providers: { globalRules: { urlPattern: '.*', rules } },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/' } },
  knowledge: {},
});

function liveSite(b: RuleBundle) {
  const rulesText = JSON.stringify(b);
  const metaText = `${JSON.stringify({ schemaVersion: 1, version: b.version, sha256: sha256(rulesText) }, null, 2)}\n`;
  const fetchText = async (url: string) => {
    if (url === `${BASE}rules.json`) return rulesText;
    if (url === `${BASE}rules.meta.json`) return metaText;
    throw new Error(`HTTP 404 ${url}`);
  };
  return { rulesText, metaText, fetchText };
}

async function dist(b: RuleBundle) {
  const dir = await mkdtemp(join(tmpdir(), 'reuse-'));
  const rulesText = JSON.stringify(b);
  await writeFile(join(dir, 'rules.json'), rulesText);
  await writeFile(join(dir, 'rules.meta.json'), JSON.stringify({ schemaVersion: 1, version: b.version, sha256: sha256(rulesText) }));
  return dir;
}

const read = (dir: string, f: string) => readFile(join(dir, f), 'utf8');

describe('reuseDist', () => {
  it('reuses the published files byte for byte when only the version differs', async () => {
    const live = liveSite(bundle('2026.10.29.1010'));
    const dir = await dist(bundle('2026.10.30.0522'));
    expect(await reuseDist(dir, BASE, live.fetchText)).toBe('reused');
    expect(await read(dir, 'rules.json')).toBe(live.rulesText);
    expect(await read(dir, 'rules.meta.json')).toBe(live.metaText);
  });

  it('reuses when the content and version are identical', async () => {
    const live = liveSite(bundle('2026.10.29.1010'));
    const dir = await dist(bundle('2026.10.29.1010'));
    expect(await reuseDist(dir, BASE, live.fetchText)).toBe('reused');
  });

  it('keeps the new build when the content changed', async () => {
    const live = liveSite(bundle('2026.10.29.1010'));
    const dir = await dist(bundle('2026.10.30.0522', ['utm_source', 'fbclid']));
    const before = await read(dir, 'rules.json');
    expect(await reuseDist(dir, BASE, live.fetchText)).toBe('new');
    expect(await read(dir, 'rules.json')).toBe(before);
  });

  it('keeps the new build when the published rules cannot be fetched', async () => {
    const dir = await dist(bundle('2026.10.30.0522'));
    const before = await read(dir, 'rules.meta.json');
    const offline = async (url: string): Promise<string> => {
      throw new Error(`offline ${url}`);
    };
    expect(await reuseDist(dir, BASE, offline)).toBe('new');
    expect(await read(dir, 'rules.meta.json')).toBe(before);
  });
});

describe('Pages deploy settling', () => {
  it('waits until 15 minutes after the last deploy', () => {
    expect(CDN_SETTLE_MS).toBe(15 * 60 * 1000);
    expect(settleWaitMs(1_000_000, 1_000_000 + 60_000)).toBe(CDN_SETTLE_MS - 60_000);
    expect(settleWaitMs(1_000_000, 1_000_000 + CDN_SETTLE_MS)).toBe(0);
    expect(settleWaitMs(null, 5)).toBe(0);
  });

  it('uses the time the latest deployment finished', async () => {
    const list = async () => JSON.stringify([{ created_at: '2026-10-29T10:10:40Z', updated_at: '2026-10-29T10:10:54Z' }]);
    expect(await lastPagesDeploy(list)).toBe(Date.parse('2026-10-29T10:10:54Z'));
    expect(await lastPagesDeploy(async () => '[]')).toBeNull();
  });

  it('throws when the deployments lookup fails', async () => {
    await expect(lastPagesDeploy(async () => '{"message":"Bad credentials"}')).rejects.toThrow();
    await expect(
      lastPagesDeploy(async () => {
        throw new Error('HTTP 503');
      }),
    ).rejects.toThrow();
  });

  it('cdnWaitMs retries the lookup and waits the full window when it keeps failing', async () => {
    const noDelay = async () => {};
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls < 3) throw new Error('HTTP 503');
      return JSON.stringify([{ updated_at: new Date(1_000_000).toISOString() }]);
    };
    expect(await cdnWaitMs(flaky, () => 1_000_000 + 60_000, noDelay)).toBe(CDN_SETTLE_MS - 60_000);
    expect(calls).toBe(3);
    const down = async (): Promise<string> => {
      throw new Error('HTTP 503');
    };
    expect(await cdnWaitMs(down, () => 0, noDelay)).toBe(CDN_SETTLE_MS);
  });
});
