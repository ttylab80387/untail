import { describe, it, expect } from 'vitest';
import { processUrl } from '../src/process';
import type { FetchFn, RuleBundle } from '../src/types';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: {
    globalRules: { urlPattern: '.*', rules: ['(?:%3F)?utm(?:_[a-z_]*)?', 'fbclid'] },
    facebook: {
      urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?facebook\\.com',
      rules: ['rdid', 'share_url'],
      redirections: ['^https?:\\/\\/l[a-z]?\\.facebook\\.com/l\\.php\\?.*?u=(https?%3A%2F%2F[^&]*)'],
    },
    threads: { urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?threads\\.(?:com|net)(?:[/:?#]|$)', rules: ['xmt', 'slof'] },
  },
  expanders: {
    threads: { match: '^https://www\\.threads\\.(com|net)/share/', shareId: '/share/([^/?#]+)' },
    facebook: { match: '^https://(www|m)\\.facebook\\.com/share/', shareId: '/share/(?:[a-z]/)?([^/?#]+)' },
    generic: { match: '^https?://(bit\\.ly|fb\\.me)/' },
  },
  knowledge: {
    'threads.com:share-id': { owner: 'Meta', category: 'sharer_id', risk: 'high', desc: { en: 'share id' } },
    'threads.com:xmt': { owner: 'Meta', category: 'sharer_id', risk: 'high', desc: { en: 'xmt' } },
    'facebook.com:share-id': { owner: 'Meta', category: 'sharer_id', risk: 'high', desc: { en: 'fb share id' } },
    'utm_*': { category: 'campaign', risk: 'low', desc: { en: 'utm' } },
  },
};

const THREADS = 'https://www.threads.com/share/BAAtest0001/';
const THREADS_POST = 'https://www.threads.com/@someone/post/DTest00001?xmt=AQGtest&slof=1';

const EMBEDDED_ODD_SHARE = 'https://example.com/a?next=https:%5C%5Cwww.threads.com%5Cshare%5CABCDEF123';

const noFetch: FetchFn = async (url) => {
  throw new Error(`fetch must not be called: ${url}`);
};
// The share link redirects to the post; the post (same site) answers 200.
const threadsFetch: FetchFn = async (url) =>
  url === THREADS_POST ? { url, status: 200 } : { url, status: 302, location: THREADS_POST };
// A mapped URL redirects to its value; a URL that is some mapped value answers 200.
const mapFetch = (map: Record<string, string>): FetchFn => async (url) => {
  const next = map[url];
  if (next !== undefined) return { url, status: 302, location: next };
  if (Object.values(map).includes(url)) return { url, status: 200 };
  throw new Error(`unexpected fetch ${url}`);
};

describe('processUrl', () => {
  it('still flags a share link embedded with an odd spelling', async () => {
    const r = await processUrl(EMBEDDED_ODD_SHARE, rules, { expand: true, locale: 'en', fetch: noFetch });
    expect(r.status).toBe('partial');
  });

  it('fails on input without a URL', async () => {
    expect(await processUrl('hello', rules, { expand: true, locale: 'en', fetch: noFetch })).toEqual({
      originalUrl: 'hello',
      cleanUrl: '',
      status: 'failed',
      reason: 'invalid_input',
      removed: [],
      hops: [],
    });
  });

  it('cleans a normal link offline', async () => {
    const r = await processUrl('https://ex.com/a?utm_source=x&id=1', rules, { expand: true, locale: 'en', fetch: noFetch });
    expect(r).toMatchObject({ cleanUrl: 'https://ex.com/a?id=1', status: 'clean', hops: ['https://ex.com/a?utm_source=x&id=1'] });
    expect(r.removed.map((p) => p.key)).toEqual(['utm_source']);
  });

  it('unwraps then cleans, recording the hop', async () => {
    const wrapped = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fex.com%2Fa%3Futm_source%3Dfb%26id%3D5&h=AT0';
    const r = await processUrl(wrapped, rules, { expand: true, locale: 'en', fetch: noFetch });
    expect(r.cleanUrl).toBe('https://ex.com/a?id=5');
    expect(r.hops).toEqual([wrapped, 'https://ex.com/a?utm_source=fb&id=5']);
  });

  it('reports unresolved when wrappers nest deeper than the unwrap limit', async () => {
    let u = 'https://ex.com/z';
    for (let i = 0; i < 4; i++) u = `https://l.facebook.com/l.php?u=${encodeURIComponent(u)}`;
    const r = await processUrl(u, rules, { expand: true, locale: 'en', fetch: noFetch });
    expect(r).toMatchObject({ status: 'partial', reason: 'unresolved' });
  });

  it('expands and cleans a Threads share link from shared text', async () => {
    const r = await processUrl(`來看 ${THREADS}`, rules, { expand: true, locale: 'en', fetch: threadsFetch });
    expect(r.originalUrl).toBe(THREADS);
    expect(r.cleanUrl).toBe('https://www.threads.com/@someone/post/DTest00001');
    expect(r.status).toBe('clean');
    expect(r.reason).toBeUndefined();
    expect(r.hops).toEqual([THREADS, THREADS_POST]);
    expect(r.removed.map((p) => [p.key, p.risk])).toEqual([
      ['share-id', 'high'],
      ['xmt', 'high'],
      ['slof', 'low'],
    ]);
  });

  it('follows a generic short link into another expander', async () => {
    const FB_SHARE = 'https://www.facebook.com/share/p/TEST01/';
    const FB_POST = 'https://www.facebook.com/groups/g/permalink/1/?rdid=x';
    const r = await processUrl('https://fb.me/abc', rules, {
      expand: true,
      locale: 'en',
      fetch: mapFetch({ 'https://fb.me/abc': FB_SHARE, [FB_SHARE]: FB_POST }),
    });
    expect(r).toMatchObject({
      cleanUrl: 'https://www.facebook.com/groups/g/permalink/1/',
      status: 'clean',
      hops: ['https://fb.me/abc', FB_SHARE, FB_POST],
    });
    expect(r.removed.map((p) => p.key)).toEqual(['share-id', 'rdid']);
  });

  it('stops after three expansions and reports unresolved', async () => {
    const T1 = 'https://www.threads.com/share/A/';
    const F2 = 'https://www.facebook.com/share/p/B/';
    const T3 = 'https://www.threads.com/share/C/';
    const r = await processUrl('https://fb.me/x', rules, {
      expand: true,
      locale: 'en',
      fetch: mapFetch({ 'https://fb.me/x': T1, [T1]: F2, [F2]: T3 }),
    });
    expect(r).toMatchObject({ status: 'partial', reason: 'unresolved', cleanUrl: T3 });
  });

  it('applies the timeout to the whole expansion chain', async () => {
    const slow = (next: string): FetchFn => async (url) => {
      await new Promise((r) => setTimeout(r, 30));
      return { url, status: 302, location: next };
    };
    const FB_SHARE = 'https://www.facebook.com/share/p/TEST01/';
    const fetch: FetchFn = (url, init) =>
      url === 'https://fb.me/abc' ? slow(FB_SHARE)(url, init) : slow('https://www.facebook.com/groups/g/permalink/1/')(url, init);
    const r = await processUrl('https://fb.me/abc', rules, { expand: true, locale: 'en', fetch, timeoutMs: 50 });
    expect(r).toMatchObject({ status: 'partial', reason: 'expand_timeout' });
  });

  it('reports unresolved when the expanded URL still embeds the share link', async () => {
    const FB_SHARE = 'https://www.facebook.com/share/p/TEST01abc/';
    const leaky = `https://www.facebook.com/groups/g/permalink/1/?shared_from=${encodeURIComponent(FB_SHARE)}`;
    const r = await processUrl(FB_SHARE, rules, { expand: true, locale: 'en', fetch: mapFetch({ [FB_SHARE]: leaky }) });
    expect(r).toMatchObject({ status: 'partial', reason: 'unresolved' });
    expect(r.removed.map((p) => p.key)).not.toContain('share-id');
  });

  it('reports unresolved when an unknown login page carries the share ID', async () => {
    const login = `https://www.threads.com/login/?next=${encodeURIComponent(THREADS)}`;
    const r = await processUrl(THREADS, rules, { expand: true, locale: 'en', fetch: mapFetch({ [THREADS]: login }) });
    expect(r).toMatchObject({ status: 'partial', reason: 'unresolved' });
  });

  it('does not touch the network when expansion is disabled', async () => {
    const r = await processUrl(THREADS, rules, { expand: false, locale: 'en', fetch: noFetch });
    expect(r).toMatchObject({ cleanUrl: THREADS, status: 'partial', reason: 'expand_disabled', removed: [] });
  });

  it('treats a missing fetch as expansion disabled', async () => {
    const r = await processUrl(THREADS, rules, { expand: true, locale: 'en' });
    expect(r.reason).toBe('expand_disabled');
  });

  it('keeps the hops recorded before an unresolved expansion', async () => {
    const stuck: FetchFn = async () => ({ url: THREADS, status: 200 });
    const r = await processUrl(THREADS, rules, { expand: true, locale: 'en', fetch: stuck });
    expect(r).toMatchObject({ status: 'partial', reason: 'unresolved', cleanUrl: THREADS, hops: [THREADS] });
  });

  it('returns partial with the failure reason when expansion fails', async () => {
    const offline: FetchFn = async () => {
      throw new Error('offline');
    };
    const r = await processUrl(`${THREADS}?utm_source=x`, rules, { expand: true, locale: 'en', fetch: offline });
    expect(r).toMatchObject({ cleanUrl: THREADS, status: 'partial', reason: 'network' });
    expect(r.removed.map((p) => p.key)).toEqual(['utm_source']);
  });
  it('treats a full-width short link like the ASCII one', async () => {
    const r = await processUrl('https://www.\uFF54\uFF48\uFF52\uFF45\uFF41\uFF44\uFF53.com/share/BAAtest0001/', rules, { expand: false, locale: 'en' });
    expect(r.reason).toBe('expand_disabled');
  });
  it('lists each removed hidden character once and reports the ones it kept', async () => {
    const r = await processUrl('https://ex\u200B.com/a\u200Bb\u200Dc\u202Ed', rules, { expand: false, locale: 'en' });
    expect(r.cleanUrl).toBe('https://ex.com/ab\u200Dcd');
    expect(r.removed.filter((p) => p.category === 'hidden').map((p) => [p.key, p.value])).toEqual([
      ['hidden-bidi', 'U+202E'],
      ['hidden', 'U+200B'],
    ]);
    expect(r.hiddenKept?.map((h) => h.code)).toEqual(['U+200D']);
  });
  it('cleans hidden characters in an unwrapped link', async () => {
    const wrapped = `https://l.facebook.com/l.php?u=${encodeURIComponent('https://example.com/a\u200Bb')}`;
    const r = await processUrl(wrapped, rules, { expand: false, locale: 'en' });
    expect(r.cleanUrl).toBe('https://example.com/ab');
    expect(r.removed.map((p) => p.key)).toContain('hidden');
  });
  it('reports the destination reached so far when expansion stops early', async () => {
    const post = 'https://www.threads.com/@someone/post/DTest00001';
    const fetch: FetchFn = async (url) => {
      if (url === THREADS) return { url, status: 302, location: post };
      throw new Error('offline');
    };
    const r = await processUrl(THREADS, rules, { expand: true, locale: 'en', fetch });
    expect(r.hops).toEqual([THREADS, post]);
    expect(r.destination).toMatchObject({ complete: false, site: { domain: 'threads.com' } });
  });
  it('reports a finished destination for a clean result', async () => {
    const r = await processUrl('https://shopee.tw.secure-login.xyz/a?utm_source=x', rules, { expand: false, locale: 'en' });
    expect(r.destination).toMatchObject({ complete: true, site: { domain: 'secure-login.xyz' } });
  });
  it('cleans a hidden character that arrives in a Location header', async () => {
    const fetch: FetchFn = async (url) => ({ url, status: 301, location: 'https://example.com/a\u200Bb' });
    const r = await processUrl('https://bit.ly/TEST02', rules, { expand: true, locale: 'en', fetch });
    expect(r.cleanUrl).toBe('https://example.com/ab');
    expect(r.removed.map((p) => p.key)).toContain('hidden');
  });
});
