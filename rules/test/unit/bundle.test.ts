import { describe, it, expect } from 'vitest';
import { buildBundle, makeVersion, missingTranslations, sha256, validateOwnData } from '../../src/bundle';
import type { OwnData } from '../../src/bundle';

const own: OwnData = {
  overrides: { providers: { threads: { urlPattern: 'threads', rules: ['xmt'] } } },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/' } },
  knowledge: { xmt: { category: 'sharer_id', risk: 'high', desc: { en: 'x', 'zh-TW': 'x', ja: 'x' } } },
};

describe('validateOwnData', () => {
  it('accepts valid data', () => {
    expect(validateOwnData(own)).toEqual([]);
  });
  it('reports invalid regexes, categories and risks', () => {
    const errors = validateOwnData({
      overrides: { providers: { bad: { urlPattern: '(', rules: ['('] } } },
      expanders: { e: { match: '(', shareId: '(', loginWall: { match: '(', param: 'next' } } },
      knowledge: { k: { category: 'nope' as never, risk: 'huge' as never, desc: {} } },
    });
    expect(errors).toEqual([
      'overrides.bad.urlPattern: invalid regex (',
      'overrides.bad.rules: invalid regex (',
      'expanders.e.match: invalid regex (',
      'expanders.e.shareId: invalid regex (',
      'expanders.e.loginWall.match: invalid regex (',
      'knowledge.k: invalid category nope',
      'knowledge.k: invalid risk huge',
    ]);
  });
  it('rejects uppercase knowledge keys and wildcard keys with a host', () => {
    const errors = validateOwnData({
      ...own,
      knowledge: {
        Fbclid: { category: 'ad_click', risk: 'medium', desc: { en: 'x' } },
        'ex.com:utm_*': { category: 'campaign', risk: 'low', desc: { en: 'x' } },
      },
    });
    expect(errors).toEqual(['knowledge.Fbclid: key must be lowercase', 'knowledge.ex.com:utm_*: wildcard keys cannot have a host']);
  });
});

describe('missingTranslations', () => {
  it('lists entries missing any locale', () => {
    expect(missingTranslations({ a: { category: 'campaign', risk: 'low', desc: { en: 'x' } } })).toEqual([
      'knowledge.a: missing zh-TW, ja',
    ]);
  });
});

describe('buildBundle', () => {
  it('merges ClearURLs providers with overrides', () => {
    const b = buildBundle({ ...own, clearurls: { providers: { globalRules: { urlPattern: '.*', rules: ['utm'] } } }, version: 'v1' });
    expect(b.schemaVersion).toBe(1);
    expect(b.version).toBe('v1');
    expect(Object.keys(b.providers)).toEqual(['globalRules', 'threads']);
    expect(b.expanders).toBe(own.expanders);
    expect(b.knowledge).toBe(own.knowledge);
  });
});

describe('sha256 / makeVersion', () => {
  it('hashes UTF-8 text as hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('formats the version in UTC', () => {
    expect(makeVersion(new Date('2026-10-06T03:07:00Z'))).toBe('2026.10.06.0307');
  });
});
