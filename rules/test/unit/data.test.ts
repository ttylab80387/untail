import { describe, it, expect } from 'vitest';
import overrides from '../../overrides.json';
import expanders from '../../expanders.json';
import knowledge from '../../knowledge.json';
import { validateOwnData } from '../../src/bundle';
import type { OwnData } from '../../src/bundle';

describe('checked-in rule data', () => {
  it('passes validation', () => {
    expect(validateOwnData({ overrides, expanders, knowledge } as OwnData)).toEqual([]);
  });
});
