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
    const fetch = fakeFetch({ [THREADS]: { url: THREADS, status: 302, location: THREADS_POST }, [THREADS_POST]: { url: THREADS_POST } }, calls);
    const r = await expandUrl(THREADS, expanders, opts(fetch));
    expect(r).toEqual({
      url: THREADS_POST,
      hops: [THREADS, THREADS_POST],
      removed: [{ key: 'share-id', value: 'BAAtest0001', host: 'www.threads.com' }],
    });
    expect(calls).toEqual([
      { url: THREADS, method: 'HEAD', ua: DEFAULT_USER_AGENT, redirect: 'manual' },
      { url: THREADS_POST, method: 'HEAD', ua: DEFAULT_USER_AGENT, redirect: 'manual' },
    ]);
  });

  it('resolves a Facebook share link that redirects straight to the post', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: FB, status: 302, location: FB_POST }, [FB_POST]: { url: FB_POST } })));
    expect(r.url).toBe(FB_POST);
    expect(r.reason).toBeUndefined();
    expect(r.removed).toEqual([{ key: 'share-id', value: 'TEST01', host: 'www.facebook.com' }]);
  });

  it('keeps the path when a redirect spells it with a backslash', async () => {
    const fetch = fakeFetch({
      [FB]: { url: FB, status: 302, location: 'https://m.facebook.com\\photo.php?fbid=123' },
      'https://m.facebook.com/photo.php?fbid=123': { url: 'https://m.facebook.com/photo.php?fbid=123' },
    });
    const r = await expandUrl(FB, expanders, opts(fetch));
    expect(r.url).toBe('https://www.facebook.com/photo.php?fbid=123');
  });

  it('gives up on a redirect target the browser would refuse', async () => {
    const XHS = 'https://xhslink.com/o/TEST01';
    const fetch = fakeFetch({ [XHS]: { url: XHS, status: 302, location: 'https://example.com:bad/post' } });
    const r = await expandUrl(XHS, expanders, opts(fetch));
    expect(r.reason).toBe('unresolved');
  });

  it('spots a login wall hidden behind an odd spelling', async () => {
    const fetch = fakeFetch({ [FB]: { url: FB, status: 302, location: loginFor('https://m.facebook.com\\login.php?next=x') } });
    const r = await expandUrl(FB, expanders, opts(fetch));
    expect(r.reason).toBe('unresolved');
  });

  it('reads the post URL out of a login wall and normalizes the host', async () => {
    const mPost = 'https://m.facebook.com/groups/somegroup/permalink/1234567890/?rdid=xyz';
    const login = loginFor(mPost);
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: FB, status: 302, location: login } })));
    expect(r.url).toBe('https://www.facebook.com/groups/somegroup/permalink/1234567890/?rdid=xyz');
    expect(r.hops).toEqual([FB, login, mPost, r.url]);
    expect(r.reason).toBeUndefined();
  });

  it('handles a login wall reached through a generic short link', async () => {
    const login = loginFor('https://m.facebook.com/groups/g/permalink/1/');
    const r = await expandUrl('https://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: 'https://bit.ly/x', status: 302, location: login } })));
    expect(r).toMatchObject({ url: 'https://www.facebook.com/groups/g/permalink/1/', removed: [] });
    expect(r.reason).toBeUndefined();
  });

  it('is unresolved when the login wall has no usable next param', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: FB, status: 302, location: 'https://m.facebook.com/login.php' } })));
    expect(r).toEqual({ url: FB, hops: [FB, 'https://m.facebook.com/login.php'], removed: [], reason: 'unresolved' });
  });

  it('is unresolved when next points to another login page', async () => {
    const r = await expandUrl(FB, expanders, opts(fakeFetch({ [FB]: { url: FB, status: 302, location: loginFor('https://m.facebook.com/login.php') } })));
    expect(r.reason).toBe('unresolved');
    expect(r.removed).toEqual([]);
  });

  it('hands a different short link back to the caller instead of failing', async () => {
    const r = await expandUrl('https://bit.ly/a', expanders, opts(fakeFetch({ 'https://bit.ly/a': { url: 'https://bit.ly/a', status: 302, location: 'https://t.co/b' } })));
    expect(r).toEqual({ url: 'https://t.co/b', hops: ['https://bit.ly/a', 'https://t.co/b'], removed: [] });
  });

  it('keeps the redirect target on HTTP errors', async () => {
    const fetch = fakeFetch({ [THREADS]: { url: THREADS, status: 302, location: THREADS_POST }, [THREADS_POST]: { url: THREADS_POST, status: 404 } });
    const r = await expandUrl(THREADS, expanders, opts(fetch));
    expect(r).toEqual({ url: THREADS, hops: [THREADS, THREADS_POST], removed: [], reason: 'network' });
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

  it('retries with GET when HEAD returns 405', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      { 'HEAD https://bit.ly/x': { url: 'https://bit.ly/x', status: 405 }, 'GET https://bit.ly/x': { url: 'https://bit.ly/x', status: 302, location: 'https://ex.com/a' } },
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
    const r = await expandUrl('https://t.co/x', expanders, opts(fakeFetch({ 'https://t.co/x': { url: 'https://t.co/x', status: 302, location: 'intent://x' } })));
    expect(r.reason).toBe('unresolved');
  });

  it('retries with GET when HEAD returns 404', async () => {
    const calls: Call[] = [];
    const r = await expandUrl(
      'https://bit.ly/x',
      expanders,
      opts(fakeFetch({ 'HEAD https://bit.ly/x': { url: 'https://bit.ly/x', status: 404 }, 'GET https://bit.ly/x': { url: 'https://bit.ly/x', status: 302, location: 'https://ex.com/a' } }, calls)),
    );
    expect(r.url).toBe('https://ex.com/a');
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  it('reads a cross-site destination from Location without requesting it', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      { 'https://bit.ly/TEST01': { url: 'https://bit.ly/TEST01', status: 301, location: 'https://example.com/post?utm_source=x' } },
      calls,
    );
    const r = await expandUrl('https://bit.ly/TEST01', expanders, opts(fetch));
    expect(r.url).toBe('https://example.com/post?utm_source=x');
    expect(calls.map((c) => c.url)).toEqual(['https://bit.ly/TEST01']);
    expect(calls.every((c) => c.redirect === 'manual')).toBe(true);
  });

  it.each([
    ['../../@someone/post/DTest00001?xmt=AQGtest&slof=1'],
    ['/@someone/post/DTest00001?xmt=AQGtest&slof=1'],
  ])('follows a relative redirect %s that stays on the same site', async (location) => {
    const fetch = fakeFetch({ [THREADS]: { url: THREADS, status: 301, location }, [THREADS_POST]: { url: THREADS_POST, status: 200 } });
    expect((await expandUrl(THREADS, expanders, opts(fetch))).url).toBe(THREADS_POST);
  });

  it('resolves a sibling or query-only Location like a browser', async () => {
    const page = 'https://www.threads.com/share/BAAtest0002/x';
    const y = 'https://www.threads.com/share/BAAtest0002/y';
    const fetch = fakeFetch({
      [page]: { url: page, status: 302, location: 'y' },
      [y]: { url: y, status: 302, location: '?x=1' },
      [`${y}?x=1`]: { url: `${y}?x=1`, status: 302, location: THREADS_POST },
      [THREADS_POST]: { url: THREADS_POST, status: 200 },
    });
    const r = await expandUrl(page, expanders, opts(fetch));
    expect(r.hops).toEqual([page, y, `${y}?x=1`, THREADS_POST]);
  });

  it('never requests a Facebook login wall, even one that would answer 403', async () => {
    const calls: Call[] = [];
    const fetch = fakeFetch(
      { [FB]: { url: FB, status: 302, location: loginFor(FB_POST) }, [loginFor(FB_POST)]: { url: loginFor(FB_POST), status: 403 } },
      calls,
    );
    const r = await expandUrl(FB, expanders, opts(fetch));
    expect(r.url).toBe(FB_POST);
    expect(calls.map((c) => c.url)).toEqual([FB]);
  });

  it('stops at six requests on one site and keeps every hop', async () => {
    const calls: Call[] = [];
    const hop = (n: number) => `https://www.threads.com/share/LOOP000${n}/`;
    const map = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((n) => [hop(n), { url: hop(n), status: 302, location: hop(n + 1) }]));
    const r = await expandUrl(hop(0), expanders, opts(fakeFetch(map, calls)));
    expect(r.reason).toBe('unresolved');
    expect(calls).toHaveLength(6);
    expect(r.hops).toEqual([0, 1, 2, 3, 4, 5, 6].map(hop));
  });

  it('does not request the next hop after the deadline', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const late = new Promise<void>((r) => (release = r));
    const fetch: FetchFn = async (url) => {
      calls.push(url);
      if (url === THREADS) {
        await late; // ignores abort, answers after the deadline
        return { url, status: 302, location: THREADS_POST };
      }
      return { url, status: 200 };
    };
    const r = await expandUrl(THREADS, expanders, opts(fetch, 20));
    expect(r.reason).toBe('expand_timeout');
    release();
    await new Promise((done) => setTimeout(done, 30));
    expect(calls).toEqual([THREADS]);
  });

  it('keeps the hop reached when a later hop fails', async () => {
    const fetch = fakeFetch({ [THREADS]: { url: THREADS, status: 302, location: THREADS_POST }, [THREADS_POST]: new Error('offline') });
    const r = await expandUrl(THREADS, expanders, opts(fetch));
    expect(r.reason).toBe('network');
    expect(r.hops).toEqual([THREADS, THREADS_POST]);
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

    it('uses manual redirects for every expander', async () => {
      const calls: Call[] = [];
      await expandUrl(THREADS, expanders, opts(fakeFetch({ [THREADS]: { url: THREADS, status: 302, location: THREADS_POST }, [THREADS_POST]: { url: THREADS_POST } }, calls)));
      expect(calls.map((c) => c.redirect)).toEqual(['manual', 'manual']);
    });
  });

  it('requests http short links over https, keeping the original as the first hop', async () => {
    const calls: Call[] = [];
    const r = await expandUrl('http://bit.ly/x', expanders, opts(fakeFetch({ 'https://bit.ly/x': { url: 'https://bit.ly/x', status: 302, location: 'https://ex.com/a' } }, calls)));
    expect(calls.map((c) => c.url)).toEqual(['https://bit.ly/x']);
    expect(r.url).toBe('https://ex.com/a');
    expect(r.hops).toEqual(['http://bit.ly/x', 'https://ex.com/a']);
  });
});
