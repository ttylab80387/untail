import { describe, it, expect } from 'vitest';
import { extractUrl } from '../src/extract';

describe('extractUrl', () => {
  it('returns a bare URL', () => {
    expect(extractUrl('https://ex.com/a?x=1')).toBe('https://ex.com/a?x=1');
  });
  it('finds a URL inside shared text with a title', () => {
    expect(extractUrl('看看這篇 https://www.threads.com/share/BAAtest0001/ 很好笑'))
      .toBe('https://www.threads.com/share/BAAtest0001/');
  });
  it('stops at full-width punctuation and whitespace', () => {
    expect(extractUrl('連結：https://ex.com/a?x=1。謝謝')).toBe('https://ex.com/a?x=1');
    expect(extractUrl('「https://ex.com/a」')).toBe('https://ex.com/a');
    expect(extractUrl('https://ex.com/a\u3000下一句')).toBe('https://ex.com/a');
  });
  it('keeps raw non-ASCII characters inside the URL', () => {
    expect(extractUrl('看 https://zh.wikipedia.org/wiki/台灣 很棒')).toBe('https://zh.wikipedia.org/wiki/台灣');
    expect(extractUrl('https://shopee.tw/商品-i.1.2?utm_source=x')).toBe('https://shopee.tw/商品-i.1.2?utm_source=x');
  });
  it('strips trailing ASCII punctuation', () => {
    expect(extractUrl('see https://ex.com/a.')).toBe('https://ex.com/a');
    expect(extractUrl('https://ex.com/a, and more')).toBe('https://ex.com/a');
  });
  it('strips an unbalanced closing paren but keeps balanced ones', () => {
    expect(extractUrl('(https://ex.com/a)')).toBe('https://ex.com/a');
    expect(extractUrl('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  });
  it('returns the first URL when there are several', () => {
    expect(extractUrl('https://a.com/1 https://b.com/2')).toBe('https://a.com/1');
  });
  it('accepts uppercase scheme', () => {
    expect(extractUrl('HTTPS://EX.COM/a')).toBe('HTTPS://EX.COM/a');
  });
  it('keeps a bare URL verbatim, including trailing punctuation', () => {
    expect(extractUrl('https://ex.com/?token=abc*')).toBe('https://ex.com/?token=abc*');
    expect(extractUrl('  https://ex.com/a.  ')).toBe('https://ex.com/a.');
  });
  it('rejects URLs without a host', () => {
    expect(extractUrl('https://?utm_source=x')).toBeNull();
    expect(extractUrl('https://@/')).toBeNull();
  });
  it('returns null when there is no http(s) URL', () => {
    expect(extractUrl('no link here')).toBeNull();
    expect(extractUrl('ftp://ex.com/file')).toBeNull();
    expect(extractUrl('')).toBeNull();
  });
});
