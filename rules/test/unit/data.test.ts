import { describe, it, expect } from 'vitest';
import { analyze } from '@linkclean/core';
import type { KnowledgeEntry } from '@linkclean/core';
import overrides from '../../overrides.json';
import expanders from '../../expanders.json';
import knowledge from '../../knowledge.json';
import { validateOwnData } from '../../src/bundle';
import type { OwnData } from '../../src/bundle';

const kb = knowledge as Record<string, KnowledgeEntry>;
const explain = (key: string, host: string) => analyze([{ key, value: 'v', host }], kb, 'en')[0]!;

describe('checked-in rule data', () => {
  it('passes validation', () => {
    expect(validateOwnData({ overrides, expanders, knowledge } as OwnData)).toEqual([]);
  });

  it('explains generic ref / referrer params as referral codes', () => {
    for (const key of ['ref', 'referrer']) {
      const p = explain(key, 'example.com');
      expect(p.category).toBe('affiliate');
      expect(p.desc).toBeDefined();
    }
  });

  it('does not call Amazon page-navigation ref a referral code', () => {
    for (const host of ['www.amazon.com', 'www.amazon.co.jp']) {
      for (const key of ['ref', 'ref_']) expect(explain(key, host).category).toBe('session');
    }
  });
});
