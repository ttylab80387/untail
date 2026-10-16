import { describe, it, expect } from 'vitest';
import { scanHidden } from '../src/hidden';

const codes = (r: ReturnType<typeof scanHidden>) => r.found.map((f) => [f.code, f.part, f.removed]);

describe('scanHidden', () => {
  it('removes zero-width space, BOM, soft hyphen and word joiner anywhere, once per kind and part', () => {
    const r = scanHidden('https://ex\u200Bample.com/a\uFEFFb\u00ADc\u2060d\u200B\u200B');
    expect(r.url).toBe('https://example.com/abcd');
    expect(codes(r)).toEqual([
      ['U+200B', 'host', true],
      ['U+FEFF', 'path', true],
      ['U+00AD', 'path', true],
      ['U+2060', 'path', true],
      ['U+200B', 'path', true],
    ]);
    expect(r.found[0]!.index).toBe(10);
  });
  it('removes direction embeddings and overrides outside userinfo', () => {
    expect(scanHidden('https://evil\u202E.com/a?b=\u202Dc').url).toBe('https://evil.com/a?b=c');
  });
  it('removes direction marks in the hostname but keeps them elsewhere', () => {
    const r = scanHidden('https://ex\u200Fample.com/a\u200Fb?q=\u2066#\u200E');
    expect(r.url).toBe('https://example.com/a\u200Fb?q=\u2066#\u200E');
    expect(codes(r)).toEqual([
      ['U+200F', 'host', true],
      ['U+200F', 'path', false],
      ['U+2066', 'query', false],
      ['U+200E', 'fragment', false],
    ]);
  });
  it('never modifies userinfo, and finds the hostname after the last @', () => {
    const r = scanHidden('https://u\u200F:p\u200B@a@ex\u200Fample.com/');
    expect(r.url).toBe('https://u\u200F:p\u200B@a@example.com/');
    expect(codes(r)).toEqual([
      ['U+200F', 'userinfo', false],
      ['U+200B', 'userinfo', false],
      ['U+200F', 'host', true],
    ]);
  });
  it('handles IPv6, a backslash and a query or fragment with no path', () => {
    expect(codes(scanHidden('https://[2001:db8::1]\\a\u200F'))).toEqual([['U+200F', 'path', false]]);
    expect(codes(scanHidden('https://ex.com?q=\u200F'))).toEqual([['U+200F', 'query', false]]);
    expect(codes(scanHidden('https://ex.com#\u200F'))).toEqual([['U+200F', 'fragment', false]]);
  });
  it('never removes ZWJ or ZWNJ, but reports them', () => {
    const r = scanHidden('https://ex.com/\u200C\u200D');
    expect(r.url).toBe('https://ex.com/\u200C\u200D');
    expect(codes(r)).toEqual([['U+200C', 'path', false], ['U+200D', 'path', false]]);
  });
  it('removes Unicode tag characters (astral, matched as surrogate pairs)', () => {
    expect(scanHidden('https://ex.com/a\u{E0041}b').url).toBe('https://ex.com/ab');
  });
  it('reports percent-encoded hidden characters in any case without changing them', () => {
    const r = scanHidden('https://ex.com/a%E2%80%8Bb?x=%ef%bb%bf#%E2%80%8d');
    expect(r.url).toBe('https://ex.com/a%E2%80%8Bb?x=%ef%bb%bf#%E2%80%8d');
    expect(r.found.map((f) => [f.code, f.part, f.removed, f.encoded])).toEqual([
      ['U+200B', 'path', false, true],
      ['U+FEFF', 'query', false, true],
      ['U+200D', 'fragment', false, true],
    ]);
  });
  it('does not report encoded characters outside the policy', () => {
    expect(scanHidden('https://ex.com/%E2%81%A3').found).toEqual([]); // U+2063, not in the table
  });
  it('leaves an ordinary URL alone', () => {
    expect(scanHidden('https://例子.台灣/路徑?q=1#x')).toEqual({ url: 'https://例子.台灣/路徑?q=1#x', found: [] });
  });
});
