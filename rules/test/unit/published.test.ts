import { describe, it, expect } from 'vitest';
import type { RuleBundle } from '@linkclean/core';
import { sha256 } from '../../src/bundle';
import { fetchPublished, sameContent } from '../../src/published';

const BASE = 'https://example.github.io/untail/';

const bundle = (version: string, rules = ['utm_source']): RuleBundle => ({
  schemaVersion: 1,
  version,
  providers: { globalRules: { urlPattern: '.*', rules } },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/' } },
  knowledge: {},
});

function site(files: Record<string, string>) {
  return async (url: string) => {
    const name = url.slice(BASE.length);
    const text = files[name];
    if (text !== undefined) return text;
    throw new Error(`HTTP 404 ${url}`);
  };
}

function published(b: RuleBundle, meta?: Record<string, unknown>) {
  const rulesText = JSON.stringify(b);
  const metaText = JSON.stringify(meta ?? { schemaVersion: 1, version: b.version, sha256: sha256(rulesText) });
  return { rulesText, metaText };
}

describe('fetchPublished', () => {
  it('returns texts and bundle when hash and bundle are valid', async () => {
    const { rulesText, metaText } = published(bundle('2026.10.29.1010'));
    const got = await fetchPublished(BASE, site({ 'rules.json': rulesText, 'rules.meta.json': metaText }));
    expect(got.rulesText).toBe(rulesText);
    expect(got.metaText).toBe(metaText);
    expect(got.bundle.version).toBe('2026.10.29.1010');
  });

  it('throws on HTML meta', async () => {
    const { rulesText } = published(bundle('v'));
    await expect(fetchPublished(BASE, site({ 'rules.json': rulesText, 'rules.meta.json': '<html>' }))).rejects.toThrow();
  });

  it('throws when sha256 does not match rules text', async () => {
    const { rulesText } = published(bundle('v'));
    const metaText = JSON.stringify({ schemaVersion: 1, version: 'v', sha256: sha256('other') });
    await expect(fetchPublished(BASE, site({ 'rules.json': rulesText, 'rules.meta.json': metaText }))).rejects.toThrow(/sha256/);
  });

  it('throws when the bundle fails validateBundle', async () => {
    const bad = { ...bundle('v'), expanders: {} };
    const { rulesText, metaText } = published(bad as RuleBundle);
    await expect(fetchPublished(BASE, site({ 'rules.json': rulesText, 'rules.meta.json': metaText }))).rejects.toThrow();
  });
});

describe('sameContent', () => {
  it('ignores version', () => {
    expect(sameContent(bundle('2026.10.29.1010'), bundle('2026.10.30.0917'))).toBe(true);
  });

  it('detects a changed rule', () => {
    expect(sameContent(bundle('a'), bundle('a', ['utm_source', 'fbclid']))).toBe(false);
  });
});
