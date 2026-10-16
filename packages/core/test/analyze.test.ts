import { describe, it, expect } from 'vitest';
import { analyze, lookupKnowledge, resolveLocale } from '../src/analyze';
import type { KnowledgeEntry } from '../src/types';

const kb: Record<string, KnowledgeEntry> = {
  'utm_*': { category: 'campaign', risk: 'low', desc: { en: 'campaign', 'zh-TW': '活動' } },
  'utm_source*': { category: 'campaign', risk: 'low', desc: { en: 'source' } },
  fbclid: { owner: 'Meta', category: 'ad_click', risk: 'medium', desc: { en: 'fb click', ja: 'FBクリック' } },
  si: { category: 'session', risk: 'low', desc: { en: 'generic si' } },
  'spotify.com:si': { owner: 'Spotify', category: 'sharer_id', risk: 'high', desc: { en: 'spotify share' } },
  'threads.com:xmt': { owner: 'Meta', category: 'sharer_id', risk: 'high', desc: {} },
};

describe('resolveLocale', () => {
  it.each([
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-CN', 'zh-TW'],
    ['ja-JP', 'ja'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
    ['', 'en'],
  ])('%s → %s', (tag, expected) => {
    expect(resolveLocale(tag)).toBe(expected);
  });
});

describe('lookupKnowledge', () => {
  it('prefers host-specific entries, walking up host suffixes', () => {
    expect(lookupKnowledge({ key: 'si', value: 'x', host: 'open.spotify.com' }, kb)).toBe(kb['spotify.com:si']);
    expect(lookupKnowledge({ key: 'xmt', value: 'x', host: 'www.threads.com' }, kb)).toBe(kb['threads.com:xmt']);
  });
  it('falls back to the plain key', () => {
    expect(lookupKnowledge({ key: 'si', value: 'x', host: 'ex.com' }, kb)).toBe(kb.si);
  });
  it('matches wildcards, longest prefix first, case-insensitively', () => {
    expect(lookupKnowledge({ key: 'utm_medium', value: 'x', host: 'ex.com' }, kb)).toBe(kb['utm_*']);
    expect(lookupKnowledge({ key: 'UTM_Source', value: 'x', host: 'ex.com' }, kb)).toBe(kb['utm_source*']);
  });
  it('returns undefined for unknown keys', () => {
    expect(lookupKnowledge({ key: 'zzz', value: 'x', host: 'ex.com' }, kb)).toBeUndefined();
  });
  it('ignores inherited Object.prototype keys', () => {
    expect(lookupKnowledge({ key: 'constructor', value: 'x', host: 'ex.com' }, kb)).toBeUndefined();
    expect(lookupKnowledge({ key: '__proto__', value: 'x', host: 'ex.com' }, kb)).toBeUndefined();
  });
});

describe('analyze', () => {
  it('resolves desc by locale with en fallback', () => {
    const [ja] = analyze([{ key: 'fbclid', value: 'a', host: 'ex.com' }], kb, 'ja-JP');
    expect(ja).toEqual({ key: 'fbclid', value: 'a', owner: 'Meta', category: 'ad_click', risk: 'medium', desc: 'FBクリック' });
    const [zh] = analyze([{ key: 'fbclid', value: 'a', host: 'ex.com' }], kb, 'zh-TW');
    expect(zh!.desc).toBe('fb click');
  });
  it('leaves desc undefined when no translation exists', () => {
    const [r] = analyze([{ key: 'xmt', value: 'a', host: 'www.threads.com' }], kb, 'en');
    expect(r!.desc).toBeUndefined();
  });
  it('marks unknown params as unknown / low', () => {
    expect(analyze([{ key: 'zzz', value: '1', host: 'ex.com' }], kb, 'en')).toEqual([
      { key: 'zzz', value: '1', category: 'unknown', risk: 'low' },
    ]);
  });
  it('does not crash on prototype-named params', () => {
    expect(analyze([{ key: 'constructor', value: '1', host: 'ex.com' }], {}, 'en')).toEqual([
      { key: 'constructor', value: '1', category: 'unknown', risk: 'low' },
    ]);
  });
  it('sorts high risk first and keeps order within a level', () => {
    const r = analyze(
      [
        { key: 'utm_source', value: '1', host: 'ex.com' },
        { key: 'fbclid', value: '2', host: 'ex.com' },
        { key: 'zzz', value: '3', host: 'ex.com' },
        { key: 'si', value: '4', host: 'open.spotify.com' },
      ],
      kb,
      'en',
    );
    expect(r.map((p) => p.key)).toEqual(['si', 'fbclid', 'utm_source', 'zzz']);
  });
});

describe('built-in knowledge for hidden characters', () => {
  it('describes hidden characters even when the rules have no entry', () => {
    const [plain] = analyze([{ key: 'hidden', value: 'U+200B', host: 'ex.com' }], {}, 'zh-TW');
    expect(plain).toMatchObject({ category: 'hidden', risk: 'medium' });
    expect(plain!.desc).toContain('看不見');
    const [bidi] = analyze([{ key: 'hidden-bidi', value: 'U+202E', host: 'ex.com' }], {}, 'en');
    expect(bidi).toMatchObject({ category: 'hidden', risk: 'high' });
  });
});
