import { describe, it, expect } from 'vitest';
import { splitUrl, joinUrl, getParam, getHost, getPath, safeDecode, canonicalUrl } from '../src/query';

describe('splitUrl / joinUrl', () => {
  it('round-trips a URL byte-for-byte', () => {
    const u = 'https://ex.com/a/b?q=%E4%B8%AD&x=a+b&flag#frag?x=1';
    expect(joinUrl(splitUrl(u))).toBe(u);
  });

  it('keeps empty query components so untouched URLs round-trip', () => {
    const u = 'https://ex.com/?q=a&&x=1';
    expect(joinUrl(splitUrl(u))).toBe(u);
  });

  it('decodes keys and values for matching only', () => {
    const s = splitUrl('https://ex.com/?q=%E4%B8%AD&x=a+b&flag');
    expect(s.pairs.map((p) => [p.key, p.value])).toEqual([
      ['q', '中'],
      ['x', 'a b'],
      ['flag', ''],
    ]);
    expect(s.pairs.map((p) => p.raw)).toEqual(['q=%E4%B8%AD', 'x=a+b', 'flag']);
  });

  it('drops the "?" when no pairs remain and keeps the hash', () => {
    const s = splitUrl('https://ex.com/p?utm_source=x#top');
    expect(joinUrl({ ...s, pairs: [] })).toBe('https://ex.com/p#top');
  });

  it('handles URLs without query', () => {
    const s = splitUrl('https://ex.com/p#h');
    expect(s).toEqual({ base: 'https://ex.com/p', pairs: [], hash: '#h' });
  });

  it('does not throw on malformed percent-encoding', () => {
    const u = 'https://ex.com/?bad=%E0%A4%A&ok=1';
    const s = splitUrl(u);
    expect(s.pairs[0]!.value).toBe('%E0%A4%A');
    expect(joinUrl(s)).toBe(u);
  });
});

describe('getParam', () => {
  it('returns the decoded value of the first match', () => {
    expect(getParam('https://m.facebook.com/login.php?next=https%3A%2F%2Fex.com%2Fa%3Fb%3D1&x=2', 'next'))
      .toBe('https://ex.com/a?b=1');
  });
  it('returns undefined when missing', () => {
    expect(getParam('https://ex.com/?a=1', 'next')).toBeUndefined();
  });
});

describe('getHost / getPath', () => {
  it('lowercases host and ignores scheme case', () => {
    expect(getHost('HTTPS://WWW.Threads.com/share/x')).toBe('www.threads.com');
  });
  it('strips userinfo and port', () => {
    expect(getHost('https://user:pw@ex.com:8080/a')).toBe('ex.com');
  });
  it('returns empty host for non-URLs and host-less authorities', () => {
    expect(getHost('not a url')).toBe('');
    expect(getHost('https://@/')).toBe('');
  });
  // The browser decides where a link really goes, so host and path must match WHATWG URL parsing.
  const tricky = [
    'https://evil.example\\@shopee.tw/x',
    'https://one.example@two.example@evil.example/',
    'https://shopee.tw@evil.example/login',
    'https://user:p@ss@evil.example:8443/a?b=1#c',
    'https://[2001:db8::1]/a',
    'https://[2001:db8::1]:8080/a',
    'https://evil.example\\shopee.tw/x',
    'https:\\\\evil.example/x',
    'https:///evil.example/x',
    'https://EVIL.Example./x',
    'https://evil.example?q=shopee.tw/x',
    'https://evil.example#@shopee.tw',
  ];
  it.each(tricky)('agrees with the browser on host: %s', (url) => {
    expect(getHost(url)).toBe(new URL(url).hostname);
  });
  it.each(tricky)('agrees with the browser on path: %s', (url) => {
    expect(getPath(url)).toBe(new URL(url).pathname);
  });

  it('returns path without query or hash', () => {
    expect(getPath('https://ex.com/a/b?x=1#y')).toBe('/a/b');
    expect(getPath('https://ex.com')).toBe('/');
    expect(getPath('https://ex.com?x=1')).toBe('/');
  });
});

describe('safeDecode', () => {
  it('keeps "+" unless asked to treat it as space', () => {
    expect(safeDecode('a+b')).toBe('a+b');
    expect(safeDecode('a+b', true)).toBe('a b');
  });
  it('returns input unchanged when decoding fails', () => {
    expect(safeDecode('%E0%A4%A')).toBe('%E0%A4%A');
  });
});

describe('canonicalUrl host mapping', () => {
  it('rewrites a host that a browser maps to plain ASCII', () => {
    expect(canonicalUrl('https://\uFF42\uFF49\uFF54.ly/abc?x=\uFF41')).toBe('https://bit.ly/abc?x=%EF%BD%81');
    expect(canonicalUrl('https://例子.台灣/路徑')).toBe('https://例子.台灣/路徑');
  });
  it('refuses a host that maps to a URL delimiter', () => {
    expect(canonicalUrl('https://shopee.tw\uFF0F.evil.com/')).toBeNull();
  });
});
