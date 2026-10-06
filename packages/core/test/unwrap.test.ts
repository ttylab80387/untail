import { describe, it, expect } from 'vitest';
import { unwrapUrl } from '../src/unwrap';
import type { Provider } from '../src/types';

const providers: Record<string, Provider> = {
  facebook: {
    urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?facebook\\.com',
    redirections: ['^https?:\\/\\/l[a-z]?\\.facebook\\.com/l\\.php\\?.*?u=(https?%3A%2F%2F[^&]*)'],
  },
  google: {
    urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google(?:\\.[a-z]{2,}){1,}',
    redirections: [
      '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google(?:\\.[a-z]{2,}){1,}\\/url\\?.*?(?:url|q)=(https?[^&]+)',
      '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google(?:\\.[a-z]{2,}){1,}\\/amp\\/s\\/([^&]+)',
    ],
  },
  loose: { urlPattern: '^https?:\\/\\/loose\\.example', redirections: ['.*u=([^&]*)'] },
  excepted: {
    urlPattern: '^https?:\\/\\/exc\\.example',
    redirections: ['.*u=([^&]*)'],
    exceptions: ['^https?:\\/\\/exc\\.example\\/keep'],
  },
};

const googleWrap = (u: string) => `https://www.google.com/url?q=${encodeURIComponent(u)}`;

describe('unwrapUrl', () => {
  it('unwraps l.facebook.com links', () => {
    expect(unwrapUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fex.com%2Fa%3Fb%3D1&h=AT0x', providers)).toEqual({
      url: 'https://ex.com/a?b=1',
      hops: ['https://l.facebook.com/l.php?u=https%3A%2F%2Fex.com%2Fa%3Fb%3D1&h=AT0x', 'https://ex.com/a?b=1'],
      complete: true,
    });
  });

  it('unwraps google /url?q=', () => {
    expect(unwrapUrl('https://www.google.com/url?sa=t&q=https%3A%2F%2Fex.com%2F&ved=1', providers).url).toBe('https://ex.com/');
  });

  it('adds https:// to scheme-less targets such as Google AMP', () => {
    expect(unwrapUrl('https://www.google.com/amp/s/example.com/p', providers).url).toBe('https://example.com/p');
  });

  it('keeps encoded bytes of targets that are already usable', () => {
    expect(unwrapUrl('https://www.google.com/amp/s/example.com/p%2Fq', providers).url).toBe('https://example.com/p%2Fq');
  });

  it('records every layer of nested wrappers', () => {
    const middle = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fex.com%2Fz';
    const outer = googleWrap(middle);
    expect(unwrapUrl(outer, providers)).toEqual({ url: 'https://ex.com/z', hops: [outer, middle, 'https://ex.com/z'], complete: true });
  });

  it('reports incomplete when nesting exceeds the depth limit', () => {
    let u = 'https://ex.com/z';
    for (let i = 0; i < 4; i++) u = googleWrap(u);
    const r = unwrapUrl(u, providers);
    expect(r.complete).toBe(false);
    expect(r.hops).toHaveLength(4);
  });

  it('ignores non-http targets', () => {
    expect(unwrapUrl('https://loose.example/r?u=javascript%3Aalert(1)', providers).url)
      .toBe('https://loose.example/r?u=javascript%3Aalert(1)');
  });

  it('honours provider exceptions', () => {
    expect(unwrapUrl('https://exc.example/keep?u=https%3A%2F%2Fex.com', providers).url)
      .toBe('https://exc.example/keep?u=https%3A%2F%2Fex.com');
    expect(unwrapUrl('https://exc.example/go?u=https%3A%2F%2Fex.com', providers).url).toBe('https://ex.com');
  });

  it('returns the input when nothing matches', () => {
    expect(unwrapUrl('https://ex.com/a', providers)).toEqual({ url: 'https://ex.com/a', hops: ['https://ex.com/a'], complete: true });
  });
});
