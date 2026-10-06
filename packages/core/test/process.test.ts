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

const noFetch: FetchFn = async (url) => {
  throw new Error(`fetch must not be called: ${url}`);
};
const threadsFetch: FetchFn = async () => ({ url: THREADS_POST, status: 200 });
const mapFetch = (map: Record<string, string>): FetchFn => async (url) => {
  const next = map[url];
  if (next === undefined) throw new Error(`unexpected fetch ${url}`);
  return { url: next, status: 200 };
};

describe('processUrl', () => {
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
    const slow = (next: string): FetchFn => async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { url: next, status: 200 };
    };
    const FB_SHARE = 'https://www.facebook.com/share/p/TEST01/';
    const fetch: FetchFn = (url, init) =>
      url === 'https://fb.me/abc' ? slow(FB_SHARE)(url, init) : slow('https://www.facebook.com/groups/g/permalink/1/')(url, init);
    const r = await processUrl('https://fb.me/abc', rules, { expand: true, locale: 'en', fetch, timeoutMs: 50 });
    expect(r).toMatchObject({ status: 'partial', reason: 'expand_timeout' });
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
});
