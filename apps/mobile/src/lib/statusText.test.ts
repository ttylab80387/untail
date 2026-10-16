import { describe, it, expect } from 'vitest';
import type { AnalyzedParam, ProcessResult } from '@linkclean/core';
import { statusText } from './statusText';

const t = ((key: string, opts?: { count?: number }) => (opts?.count === undefined ? key : `${key}:${opts.count}`)) as never;
const item = (category: AnalyzedParam['category']): AnalyzedParam => ({ key: 'k', value: 'v', category, risk: 'low' });
const result = (removed: AnalyzedParam[]): ProcessResult => ({ originalUrl: 'u', cleanUrl: 'u', status: 'clean', removed, hops: ['u'] });

describe('statusText', () => {
  it('never calls a removed hidden character a tracking code', () => {
    expect(statusText(t, result([item('hidden')]))).toBe('result.status.hiddenRemoved');
  });
  it('counts only tracking codes, and mentions hidden characters separately', () => {
    expect(statusText(t, result([item('campaign'), item('hidden')]))).toBe('result.status.removed:1 · result.status.hiddenRemoved');
  });
  it('says nothing was found when nothing was removed', () => {
    expect(statusText(t, result([]))).toBe('result.status.none');
  });
});
