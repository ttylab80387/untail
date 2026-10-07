import { describe, expect, it } from 'vitest';
import type { AnalyzedParam } from '@linkclean/core';
import { referralCode } from './referral';

const param = (p: Partial<AnalyzedParam>): AnalyzedParam => ({ key: 'k', value: 'v', category: 'unknown', risk: 'low', ...p });

describe('referralCode', () => {
  it('returns the plain-text value of an affiliate / referral param', () => {
    expect(referralCode(param({ key: 'tag', value: 'someone-20', category: 'affiliate' }))).toBe('someone-20');
  });

  it('returns null for opaque sharer IDs and other categories', () => {
    expect(referralCode(param({ key: 'xmt', value: 'AQGz', category: 'sharer_id' }))).toBeNull();
    expect(referralCode(param({ key: 'utm_source', value: 'x', category: 'campaign' }))).toBeNull();
  });

  it('returns null for an empty or blank value', () => {
    expect(referralCode(param({ category: 'affiliate', value: '' }))).toBeNull();
    expect(referralCode(param({ category: 'affiliate', value: '  ' }))).toBeNull();
  });
});
