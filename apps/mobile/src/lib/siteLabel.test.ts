import { describe, it, expect } from 'vitest';
import { siteOf } from '@linkclean/core';
import { siteLabel } from './siteLabel';

const label = (u: string) => siteLabel(siteOf(u)!);

describe('siteLabel', () => {
  it('splits the host into subdomain and main domain', () => {
    expect(label('https://shopee.tw.secure-login.xyz/a')).toEqual({ sub: 'shopee.tw.', main: 'secure-login.xyz', ascii: null });
    expect(label('https://example.com/')).toEqual({ sub: '', main: 'example.com', ascii: null });
  });
  it('shows the whole host for IPs and bare suffixes', () => {
    expect(label('http://203.0.113.5/')).toEqual({ sub: '', main: '203.0.113.5', ascii: null });
    expect(label('https://[2001:db8::1]/')).toEqual({ sub: '', main: '[2001:db8::1]', ascii: null });
    expect(label('https://co.uk/')).toEqual({ sub: '', main: 'co.uk', ascii: null });
  });
  it('shows an IDN host in both forms', () => {
    expect(label('https://www.例子.台灣/')).toEqual({ sub: 'www.', main: '例子.台灣', ascii: 'www.xn--fsqu00a.xn--kpry57d' });
  });
});
