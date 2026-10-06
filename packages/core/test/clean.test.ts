import { describe, it, expect } from 'vitest';
import { cleanUrl, activeProviders } from '../src/clean';
import type { Provider } from '../src/types';

const providers: Record<string, Provider> = {
  globalRules: { urlPattern: '.*', rules: ['(?:%3F)?utm(?:_[a-z_]*)?', 'fbclid', 'gclid'] },
  spotify: { urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?spotify\\.com', rules: ['si'] },
  amazon: { urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?amazon\\.com', rules: ['qid'], referralMarketing: ['tag'] },
  google: {
    urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google\\.com',
    rules: ['ved'],
    exceptions: ['^https?:\\/\\/accounts\\.google\\.com'],
  },
  raw: { urlPattern: '^https?:\\/\\/raw\\.example', rawRules: ['\\/ref=[^/?]*'] },
  broken: { urlPattern: '.*', rules: ['(unclosed'] },
  brokenPattern: { urlPattern: '(unclosed', rules: ['id'] },
};

describe('activeProviders', () => {
  it('skips providers whose exceptions match', () => {
    const names = activeProviders('https://accounts.google.com/x', providers).map((p) => p.urlPattern);
    expect(names).not.toContain(providers.google!.urlPattern);
  });
  it('skips providers with invalid urlPattern', () => {
    expect(activeProviders('https://ex.com/', providers)).not.toContain(providers.brokenPattern);
  });
});

describe('cleanUrl', () => {
  it('removes global tracking params and keeps others byte-for-byte', () => {
    const r = cleanUrl('https://ex.com/p?id=%E4%B8%AD&utm_source=fb&x=a+b&fbclid=IwAR1', providers);
    expect(r.url).toBe('https://ex.com/p?id=%E4%B8%AD&x=a+b');
    expect(r.removed).toEqual([
      { key: 'utm_source', value: 'fb', host: 'ex.com' },
      { key: 'fbclid', value: 'IwAR1', host: 'ex.com' },
    ]);
  });

  it('applies site rules only on matching hosts', () => {
    expect(cleanUrl('https://open.spotify.com/track/1?si=abc', providers).url).toBe('https://open.spotify.com/track/1');
    expect(cleanUrl('https://ex.com/?si=abc', providers).url).toBe('https://ex.com/?si=abc');
  });

  it('removes referralMarketing params', () => {
    expect(cleanUrl('https://www.amazon.com/dp/B0?tag=me-20&th=1', providers).url).toBe('https://www.amazon.com/dp/B0?th=1');
  });

  it('honours exceptions', () => {
    expect(cleanUrl('https://accounts.google.com/x?ved=1', providers).url).toBe('https://accounts.google.com/x?ved=1');
    expect(cleanUrl('https://www.google.com/s?ved=1&q=a', providers).url).toBe('https://www.google.com/s?q=a');
  });

  it('applies rawRules to the whole URL and reports what was removed', () => {
    expect(cleanUrl('https://raw.example/item/ref=abc?x=1', providers)).toEqual({
      url: 'https://raw.example/item?x=1',
      removed: [{ key: 'raw', value: '/ref=abc', host: 'raw.example' }],
    });
  });

  it('returns untouched URLs byte-for-byte', () => {
    expect(cleanUrl('https://ex.com/?q=a&&x=1', providers)).toEqual({ url: 'https://ex.com/?q=a&&x=1', removed: [] });
  });

  it('keeps the query byte-for-byte when only rawRules changed the URL', () => {
    expect(cleanUrl('https://raw.example/item/ref=abc?keep=a&&b=1', providers).url).toBe('https://raw.example/item?keep=a&&b=1');
  });

  it('drops empty query components once a query param was removed', () => {
    expect(cleanUrl('https://ex.com/?q=a&&utm_source=x', providers).url).toBe('https://ex.com/?q=a');
  });

  it('matches keys case-insensitively and after decoding', () => {
    expect(cleanUrl('https://ex.com/?UTM_Source=x&utm%5Fmedium=y&k=1', providers).url).toBe('https://ex.com/?k=1');
  });

  it('requires a full key match', () => {
    expect(cleanUrl('https://ex.com/?fbclidx=1', providers).url).toBe('https://ex.com/?fbclidx=1');
  });

  it('keeps the hash and URLs without query', () => {
    expect(cleanUrl('https://ex.com/p?utm_source=x#top', providers).url).toBe('https://ex.com/p#top');
    expect(cleanUrl('https://ex.com/p', providers)).toEqual({ url: 'https://ex.com/p', removed: [] });
  });
});
