import { describe, it, expect } from 'vitest';
import { compile, matches } from '../src/regex';

describe('compile', () => {
  it('compiles case-insensitive by default', () => {
    expect(compile('abc')!.test('ABC')).toBe(true);
  });
  it('returns null for invalid patterns instead of throwing', () => {
    expect(compile('(unclosed')).toBeNull();
  });
  it('returns null for non-string patterns from broken remote data', () => {
    expect(compile(undefined as unknown as string)).toBeNull();
    expect(compile(42 as unknown as string)).toBeNull();
  });
  it('caches by pattern and flags', () => {
    expect(compile('x')).toBe(compile('x'));
    expect(compile('x', 'gi')).not.toBe(compile('x'));
  });
});

describe('matches', () => {
  it('is false for invalid patterns', () => {
    expect(matches('[', 'anything')).toBe(false);
  });
  it('tests against the string', () => {
    expect(matches('^https://ex\\.com', 'HTTPS://EX.COM/a')).toBe(true);
  });
});
