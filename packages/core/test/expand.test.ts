import { describe, it, expect } from 'vitest';
import { expandUrl, findExpander, DEFAULT_USER_AGENT } from '../src/expand';
import type { Expander, FetchFn } from '../src/types';

const expanders: Record<string, Expander> = {
  facebook: {
    match: '^https://(www|m)\\.facebook\\.com/share/',
    loginWall: { match: '^https://(www|m)\\.facebook\\.com/login', param: 'next' },
    normalizeHost: { 'm.facebook.com': 'www.facebook.com' },
    shareId: '/share/(?:[a-z]/)?([^/?#]+)',
  },
  threads: { match: '^https://www\\.threads\\.(com|net)/share/', shareId: '/share/([^/?#]+)' },
  generic: { match: '^https?://(bit\\.ly|t\\.co)/' },
  xhs: { match: '^https?://xhslink\\.com/', firstHop: true, shareId: '^/(?:[a-z]/)?([^/?#]+)' },
};

type Reply = { url: string; status?: number; location?: string } | Error | 'hang' | 'ignore-abort';
interface Call { url: string; method: string; ua: string | undefined; redirect?: string }

function fakeFetch(map: Record<string, Reply>, calls: Call[] = []): FetchFn {
  return async (url, init) => {
    calls.push({ url, method: init.method, ua: init.headers['User-Agent'], redirect: init.redirect });
    const r = map[`${init.method} ${url}`] ?? map[url];
    if (r === undefined) throw new Error(`unexpected fetch ${init.method} ${url}`);
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    if (r === 'ignore-abort') return new Promise(() => {});
    if (r instanceof Error) throw r;
    return { url: r.url, status: r.status ?? 200, ...(r.location ? { location: r.location } : {}) };
  };
}

const opts = (fetch: FetchFn, timeoutMs = 1000) => ({ fetch, userAgent: DEFAULT_USER_AGENT, timeoutMs });

const THREADS = 'https://www.threads.com/share/BAAtest0001/';
const THREADS_POST = 'https://www.threads.com/@someone/post/DTest00001?xmt=AQGtest&slof=1';
const FB = 'https://www.facebook.com/share/p/TEST01/';
const FB_POST = 'https://www.facebook.com/groups/somegroup/permalink/1234567890/?rdid=abc';
const loginFor = (next: string) => `https://m.facebook.com/login.php?next=${encodeURIComponent(next)}&refsrc=deprecated`;

describe('findExpander', () => {
  it('matches case-insensitively', () => {
    expect(findExpander('HTTPS://WWW.FACEBOOK.COM/share/p/X/', expanders)).toBe(expanders.facebook);
  });
  it('returns undefined for other URLs', () => {
    expect(findExpander('https://ex.com/share/x', expanders)).toBeUndefined();
  });
});

describe('expandUrl', () => {
  it('returns the input untouched when no expander matches', async () => {
    const r = await expandUrl('https://ex.com/a', expanders, opts(fakeFetch({})));
    expect(r).toEqual({ url: 'https://ex.com/a', hops: ['https://ex.com/a'], removed: [] });
  });

  it('resolves a Threads share link with a HEAD request and our UA', async () => {
    const calls: Call[] = [];
    const r = await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: { url: THREADS_POST } }, calls)));
    expect(r).toEqual({
      url: THREADS_POST,
      hops: [THREADS, THREADS_POST],
      removed: [{ key: 'share-id', value: 'BAAtest0001', host: 'www.threads.com' }],
    });
    expect(calls).toEqual([{ url: THREADS, method: 'HEAD', ua: DEFAULT_USER_AGENT, redirect: 'follow' }]);
  });

  it('resolves a Facebook share link that redirects straight to the post', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: FB_POST } })));
    expect(r.url).toBe(FB_POST);
    expect(r.reason).toBeUndefined();
    expect(r.removed).toEqual([{ key: 'share-id', value: 'TEST01', host: 'www.facebook.com' }]);
  });

  it('reads the post URL out of a login wall and normalizes the host', async () => {
    const mPost = 'https://m.facebook.com/groups/somegroup/permalink/1234567890/?rdid=xyz';
    const login = loginFor(mPost);
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: login } })));
    expect(r.url).toBe('https://www.facebook.com/groups/somegroup/permalink/1234567890/?rdid=xyz');
    expect(r.hops).toEqual([FB, login, mPost, r.url]);
    expect(r.reason).toBeUndefined();
  });

  it('handles a login wall reached through a generic short link', async () => {
    const login = loginFor('https://m.facebook.com/groups/g/permalink/1/');
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: login } })));
    expect(r).toMatchObject({ url: 'https://www.facebook.com/groups/g/permalink/1/', removed: [] });
    expect(r.reason).toBeUndefined();
  });

  it('is unresolved when the login wall has no usable next param', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: 'https://m.facebook.com/login.php' } })));
    expect(r).toEqual({ url: FB, hops: [FB, 'https://m.facebook.com/login.php'], removed: [], reason: 'unresolved' });
  });

  it('is unresolved when next points to another login page', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: loginFor('https://m.facebook.com/login.php') } })));
    expect(r.reason).toBe('unresolved');
    expect(r.removed).toEqual([]);
  });

  it('hands a different short link back to the caller instead of failing', async () => {
    const r = await expandUrl('https://bit.ly/a', expanders, opts(fakeFetch({ 'https://bit.ly/a': { url: 'https://t.co/b' } })));
    expect(r).toEqual({ url: 'https://t.co/b', hops: ['https://bit.ly/a', 'https://t.co/b'], removed: [] });
  });

  it('keeps the redirect target on HTTP errors', async () => {
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: 'https://ex.com/gone', status: 404 } })));
    expect(r).toEqual({ url: 'https://bit.ly/x', hops: ['https://bit.ly/x', 'https://ex.com/gone'], removed: [], reason: 'network' });
  });

  it('does not send GET after the deadline when a late HEAD returns 405', async () => {
    const calls: Call[] = [];
    const lateHead: FetchFn = async (url, init) => {
      calls.push({ url, method: init.method, ua: init.headers['User-Agent'] });
      if (init.method === 'GET') return { url: 'https://ex.com/a', status: 200 };
      await new Promise((r) => setTimeout(r, 40));
      return { url, status: 405 };
    };
    const r = await expandUrl('https://bit.ly/x', expanders, opts(lateHead, 10));
    expect(r.reason).toBe('expand_timeout');
    await new Promise((r) => setTimeout(r, 60));
    expect(calls.map((c) => c.method)).toEqual(['HEAD']);
  });

  it('is unresolved when the final URL is still the same share link', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: FB } })));
    expect(r.reason).toBe('unresolved');
    expect(r.removed).toEqual([]);
  });

  it('is unresolved when fetch reports an empty final URL', async () => {
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: '' } })));
    expect(r.reason).toBe('unresolved');
  });

  it('retries with GET when HEAD returns 405', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      { 'HEAD https://bit.ly/x': { url: 'https://bit.ly/x', status: 405 }, 'GET https://bit.ly/x': { url: 'https://ex.com/a' } },
      calls,
    );
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fetch));
    expect(r.url).toBe('https://ex.com/a');
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  it('reports network on HTTP error status', async () => {
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: 'https://bit.ly/x', status: 404 } })));
    expect(r).toEqual({ url: 'https://bit.ly/x', hops: ['https://bit.ly/x'], removed: [], reason: 'network' });
  });

  it('reports network when fetch throws', async () => {
    const r = await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: new Error('offline') })));
    expect(r).toEqual({ url: THREADS, hops: [THREADS], removed: [], reason: 'network' });
  });

  it('reports expand_timeout when the request exceeds the timeout', async () => {
    const r = await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: 'hang' }), 20));
    expect(r).toEqual({ url: THREADS, hops: [THREADS], removed: [], reason: 'expand_timeout' });
  });

  it('times out even when fetch ignores the abort signal', async () => {
    const r = await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: 'ignore-abort' }), 20));
    expect(r.reason).toBe('expand_timeout');
  });

  it('is unresolved when redirected to a non-http URL', async () => {
    const r = await expandUrl('https://t.co/x', expanders, opts(fakeFetch({ 'https://t.co/x': { url: 'intent://x' } })));
    expect(r.reason).toBe('unresolved');
  });

  it('retries with GET when HEAD returns 404', async () => {
    const calls: Call[] = [];
    const r = await expandUrl(
      'https://bit.ly/x',
      expanders,
      opts(fakeFetch({ 'HEAD https://bit.ly/x': { url: 'https://bit.ly/x', status: 404 }, 'GET https://bit.ly/x': { url: 'https://ex.com/a' } }, calls)),
    );
    expect(r.url).toBe('https://ex.com/a');
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  describe('firstHop expanders', () => {
    const XHS = 'http://xhslink.com/o/TEST01';
    const XHS_REQ = 'https://xhslink.com/o/TEST01'; // requested over https
    const NOTE = 'https://www.xiaohongshu.com/discovery/item/abc?xsec_token=T&shareRedId=S';

    it('reads the first redirect target without contacting it', async () => {
      const calls: Call[] = [];
      const r = await expandUrl(
        XHS,
        expanders,
        opts(fakeFetch({ [`HEAD ${XHS_REQ}`]: { url: XHS_REQ, status: 404 }, [`GET ${XHS_REQ}`]: { url: XHS_REQ, status: 302, location: NOTE } }, calls)),
      );
      expect(r).toEqual({ url: NOTE, hops: [XHS, NOTE], removed: [{ key: 'share-id', value: 'TEST01', host: 'xhslink.com' }] });
      expect(calls.map((c) => [c.method, c.url, c.redirect])).toEqual([
        ['HEAD', XHS_REQ, 'manual'],
        ['GET', XHS_REQ, 'manual'],
      ]);
    });

    it('resolves a relative Location against the short link', async () => {
      const r = await expandUrl(XHS, expanders, opts(fakeFetch({ [XHS_REQ]: { url: XHS_REQ, status: 301, location: '/next/path?a=1' } })));
      expect(r.url).toBe('https://xhslink.com/next/path?a=1');
    });

    it('is unresolved when the short link does not redirect', async () => {
      const r = await expandUrl(XHS, expanders, opts(fakeFetch({ [XHS_REQ]: { url: XHS_REQ, status: 200 } })));
      expect(r.reason).toBe('unresolved');
      expect(r.url).toBe(XHS);
    });

    it('lets other expanders keep following redirects', async () => {
      const calls: Call[] = [];
      await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: { url: THREADS_POST } }, calls)));
      expect(calls[0]!.redirect).toBe('follow');
    });
  });

  it('requests http short links over https, keeping the original as the first hop', async () => {
    const calls: Call[] = [];
    const r = await expandUrl('http://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: 'https://ex.com/a' } }, calls)));
    expect(calls.map((c) => c.url)).toEqual(['https://bit.ly/x']);
    expect(r.url).toBe('https://ex.com/a');
    expect(r.hops).toEqual(['http://bit.ly/x', 'https://ex.com/a']);
  });
});
