import { describe, it, expect } from 'vitest';
import punycode from 'punycode/punycode.js';
import { processUrl } from '../src/process';
import { extractUrl, extractUrlDetailed } from '../src/extract';
import { scanHidden } from '../src/hidden';
import { siteOf } from '../src/site';
import { getHost, matchView } from '../src/query';
import type { FetchFn, RuleBundle } from '../src/types';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: {
    globalRules: { urlPattern: '.*', rules: ['utm_source'] },
    facebook: {
      urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?facebook\\.com',
      redirections: ['^https?:\\/\\/l[a-z]?\\.facebook\\.com/l\\.php\\?.*?u=(https?%3A%2F%2F[^&]*)'],
    },
  },
  expanders: {
    facebook: {
      match: '^https://(www|m)\\.facebook\\.com/share/',
      loginWall: { match: '^https://(www|m)\\.facebook\\.com/login', param: 'next' },
      normalizeHost: { 'm.facebook.com': 'www.facebook.com' },
    },
    threads: { match: '^https://www\\.threads\\.com/share/' },
    generic: { match: '^https?://(bit\\.ly)/' },
  },
  knowledge: {},
};
const run = (input: string, fetch?: FetchFn) => processUrl(input, rules, { expand: !!fetch, locale: 'en', fetch });
const removedCodes = (r: Awaited<ReturnType<typeof run>>) => r.removed.filter((p) => p.category === 'hidden').map((p) => p.value);

describe('F1: hidden characters in redirects and wrappers are found and reported', () => {
  it('reports a hidden character in the host of a Location header', async () => {
    const fetch: FetchFn = async (url) => ({ url, status: 301, location: 'https://ex\u200Bample.com/post' });
    const r = await run('https://bit.ly/TEST001', fetch);
    expect(r.cleanUrl).toBe('https://example.com/post');
    expect(removedCodes(r)).toEqual(['U+200B']);
  });
  it('unwraps a wrapper whose path hid a zero-width space', async () => {
    const fetch: FetchFn = async (url) => ({ url, status: 302, location: 'https://l.facebook.com/l.php\u200B?u=https%3A%2F%2Fexample.com%2Fa' });
    const r = await run('https://bit.ly/TEST003', fetch);
    expect(r.cleanUrl).toBe('https://example.com/a');
  });
  it('unwraps a nested wrapper once its hidden character is gone', async () => {
    const inner = 'https://l.facebook.com/l\u200B.php?u=https%3A%2F%2Fexample.com%2Fpost';
    const r = await run(`https://l.facebook.com/l.php?u=${encodeURIComponent(inner)}`);
    expect(r.cleanUrl).toBe('https://example.com/post');
    expect(removedCodes(r)).toEqual(['U+200B']);
  });
  it('still spots a login wall whose host carried a direction mark', async () => {
    const calls: string[] = [];
    const post = 'https://m.facebook.com/groups/g/permalink/1/';
    const fetch: FetchFn = async (url) => {
      calls.push(url);
      return { url, status: 302, location: `https://m\u200F.facebook.com/login.php?next=${encodeURIComponent(post)}` };
    };
    const r = await run('https://www.facebook.com/share/p/TEST01/', fetch);
    expect(r.cleanUrl).toBe('https://www.facebook.com/groups/g/permalink/1/');
    expect(calls).toHaveLength(1);
  });
});

describe('F2: 。 in Chinese prose', () => {
  it('does not turn a following date or word into a host label', () => {
    expect(extractUrl('請看https://example.com\u300210/20截止')).toBe('https://example.com');
  });
  it('drops a trailing 。 after a bare URL', () => {
    expect(extractUrl('https://example.com\u3002')).toBe('https://example.com');
  });
  it('ignores a hidden character inside the label after 。', () => {
    expect(extractUrl('請看https://example\u3002c\u200Bom/a 謝謝')).toBe('https://example.com/a');
  });
});

describe('F3: kept characters are judged on the final link', () => {
  it('does not report a character that a removed tracking parameter carried', async () => {
    const r = await run('https://example.com/a?utm_source=x\u200D');
    expect(r.cleanUrl).toBe('https://example.com/a');
    expect(r.hiddenKept).toBeUndefined();
  });
  it('does not report an encoded character that unwrapping removed', async () => {
    const r = await run('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa%E2%80%8Bb');
    expect(r.cleanUrl).toBe('https://example.com/ab');
    expect(r.hiddenKept).toBeUndefined();
  });
});

describe('F4: encoded joiners are ordinary text', () => {
  it('does not report a percent-encoded ZWNJ in a Persian path', () => {
    expect(scanHidden('https://fa.wikipedia.org/wiki/%D9%85%DB%8C%E2%80%8C%D8%B1%D9%88%D8%AF').found).toEqual([]);
  });
  it('never reports a kept joiner in the host as removed', () => {
    const r = extractUrlDetailed('https://ex%E2%80%8Dample.com/')!;
    expect(r.hidden.filter((h) => h.removed)).toEqual([]);
  });
});

describe('F5: a trailing dot on the host', () => {
  it('matches rules and expanders as the same host', async () => {
    expect(getHost('https://line.me./R/ti/p/x')).toBe('line.me');
    expect(matchView('https://www.threads.com./share/X/')).toBe('https://www.threads.com/share/X/');
    const r = await run('https://www.threads.com./share/BAAtest0001/');
    expect(r.reason).toBe('expand_disabled');
  });
});

describe('F6: xn-- labels are shown decoded only when the result is plain text', () => {
  it('keeps a label in xn-- form when it decodes to a direction override', () => {
    const tricky = punycode.toASCII('ex\u202Eample');
    const site = siteOf(`https://${tricky}.evil.com/`)!;
    expect(site.host).toBe(`${tricky}.evil.com`);
  });
  it('decodes labels one by one, so one bad label does not hide the rest', () => {
    const site = siteOf('https://xn--zz.shopee.tw.例子.台灣/')!;
    expect(site.host).toBe('xn--zz.shopee.tw.例子.台灣');
    expect(site.domain).toBe('例子.台灣');
  });
});

describe('F7: a BOM or zero-width space around a bare URL', () => {
  it('keeps the URL bare, so trailing characters of the URL survive', () => {
    expect(extractUrl('https://example.com/?token=abc*\uFEFF')).toBe('https://example.com/?token=abc*');
    expect(extractUrl('\u200Bhttps://ex.com/a.')).toBe('https://ex.com/a.');
  });
});

describe('F10: same-site redirects over http', () => {
  it('requests a same-site http hop over https', async () => {
    const calls: string[] = [];
    const fetch: FetchFn = async (url) => {
      calls.push(url);
      if (url === 'https://bit.ly/q') return { url, status: 301, location: 'http://bit.ly/r' };
      return { url, status: 301, location: 'https://example.com/x' };
    };
    const r = await run('https://bit.ly/q', fetch);
    expect(calls).toEqual(['https://bit.ly/q', 'https://bit.ly/r']);
    expect(r.cleanUrl).toBe('https://example.com/x');
  });
});
