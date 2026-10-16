import { describe, it, expect } from 'vitest';
import { siteOf, sameSite } from '../src/site';

describe('siteOf', () => {
  it('returns the registrable domain under the public suffix list', () => {
    expect(siteOf('https://shopee.tw.secure-login.xyz/a')).toMatchObject({
      host: 'shopee.tw.secure-login.xyz',
      domain: 'secure-login.xyz',
      isIp: false,
    });
    expect(siteOf('https://news.bbc.co.uk/x')?.domain).toBe('bbc.co.uk');
  });
  it('treats private suffixes as separate sites', () => {
    expect(siteOf('https://alice.github.io/')?.domain).toBe('alice.github.io');
    expect(sameSite('https://alice.github.io/', 'https://bob.github.io/')).toBe(false);
  });
  it('handles IPv4, IPv6, a bare suffix, an unknown suffix and a trailing dot', () => {
    expect(siteOf('http://203.0.113.5/login')).toMatchObject({ host: '203.0.113.5', domain: null, isIp: true });
    expect(siteOf('https://[2001:db8::1]/')).toMatchObject({ host: '[2001:db8::1]', domain: null, isIp: true });
    expect(siteOf('https://co.uk/')).toMatchObject({ host: 'co.uk', domain: null });
    expect(siteOf('https://a.b.notarealtld/')?.domain).toBe('b.notarealtld');
    expect(siteOf('https://Example.COM./x')).toMatchObject({ host: 'example.com', domain: 'example.com' });
  });
  it('gives Unicode and xn-- input the same site, in both forms', () => {
    const u = siteOf('https://例子.台灣/路徑')!;
    const a = siteOf('https://xn--fsqu00a.xn--kpry57d/')!;
    expect(u).toEqual(a);
    expect(u).toMatchObject({ host: '例子.台灣', asciiHost: 'xn--fsqu00a.xn--kpry57d' });
  });
  it('maps full-width letters, ideographic dots and ignorable characters like a browser', () => {
    expect(siteOf('https://\uFF45\uFF58\uFF41\uFF4D\uFF50\uFF4C\uFF45.com/')?.asciiHost).toBe('example.com');
    expect(siteOf('https://a\u034Fb.com/')?.asciiHost).toBe('ab.com');
    expect(sameSite('https://example\u3002com/', 'https://www.example.com/')).toBe(true);
  });
  it('refuses a host that maps to a URL delimiter, as a browser does', () => {
    expect(siteOf('https://shopee.tw\uFF0F.evil.com/')).toBeNull();
    expect(siteOf('https://shopee.tw\uFF20evil.com/')).toBeNull();
  });
  it('does not throw on an invalid punycode label', () => {
    expect(siteOf('https://xn--zz.example/')?.domain).toBe('xn--zz.example');
  });
  it('returns null for something that is not a URL', () => {
    expect(siteOf('')).toBeNull();
    expect(siteOf('not a url')).toBeNull();
  });
});
