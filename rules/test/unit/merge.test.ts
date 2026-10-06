import { describe, it, expect } from 'vitest';
import { mergeProviders } from '../../src/merge';

describe('mergeProviders', () => {
  const base = {
    facebook: { urlPattern: 'fb', rules: ['a'], exceptions: ['x'] },
    google: { urlPattern: 'g', rules: ['ved'] },
  };

  it('appends array fields to existing providers', () => {
    const out = mergeProviders(base, { facebook: { rules: ['rdid'], redirections: ['r'] } });
    expect(out.facebook).toEqual({ urlPattern: 'fb', rules: ['a', 'rdid'], exceptions: ['x'], redirections: ['r'] });
  });

  it('adds new providers', () => {
    const out = mergeProviders(base, { threads: { urlPattern: 't', rules: ['xmt'] } });
    expect(out.threads).toEqual({ urlPattern: 't', rules: ['xmt'] });
  });

  it('replaces scalar fields', () => {
    expect(mergeProviders(base, { google: { urlPattern: 'g2' } }).google!.urlPattern).toBe('g2');
  });

  it('does not mutate the base', () => {
    mergeProviders(base, { facebook: { rules: ['z'] } });
    expect(base.facebook.rules).toEqual(['a']);
  });

  it('throws when a new provider has no urlPattern', () => {
    expect(() => mergeProviders(base, { nope: { rules: ['x'] } })).toThrow(/nope.*urlPattern/);
  });
});
