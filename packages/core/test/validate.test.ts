import { describe, it, expect } from 'vitest';
import { validateBundle } from '../src/validate';

const valid = () => ({
  schemaVersion: 1,
  version: '2026.10.06.0000',
  providers: { globalRules: { urlPattern: '.*', rules: ['utm_source'] } },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/' } },
  knowledge: {},
});

describe('validateBundle', () => {
  it('accepts a well-formed bundle', () => {
    expect(validateBundle(valid())).toEqual([]);
  });

  it('rejects non-objects', () => {
    expect(validateBundle(null)).toEqual(['bundle is not an object']);
    expect(validateBundle([])).toEqual(['bundle is not an object']);
  });

  it('rejects unsupported schema versions and missing sections', () => {
    expect(validateBundle({ ...valid(), schemaVersion: 2 })).toEqual(['unsupported schemaVersion 2']);
    expect(validateBundle({ ...valid(), knowledge: undefined })).toEqual(['knowledge must be an object']);
  });

  it('rejects providers without a urlPattern', () => {
    const b = valid();
    (b.providers as Record<string, unknown>).broken = { rules: ['id'] };
    expect(validateBundle(b)).toEqual(['providers.broken: missing urlPattern']);
  });

  it('tolerates provider patterns that fail to compile', () => {
    const b = valid();
    (b.providers as Record<string, unknown>).odd = { urlPattern: '(' };
    expect(validateBundle(b)).toEqual([]);
  });

  it('rejects expanders whose match cannot compile', () => {
    expect(validateBundle({ ...valid(), expanders: { x: { match: '(' } } })).toEqual(['expanders.x: invalid match']);
  });

  it('rejects an empty expander set', () => {
    expect(validateBundle({ ...valid(), expanders: {} })).toEqual(['expanders is empty']);
  });

  it('rejects provider rule fields that are not string arrays', () => {
    const b = valid();
    (b.providers as Record<string, unknown>).bad = { urlPattern: '.*', exceptions: 42, rules: ['ok', 1] };
    expect(validateBundle(b)).toEqual(['providers.bad.rules: must be a string array', 'providers.bad.exceptions: must be a string array']);
  });

  it('rejects malformed optional expander fields', () => {
    const b = { ...valid(), expanders: { x: { match: '^https://x/', loginWall: { match: '(' }, normalizeHost: { a: 1 }, shareId: 5 } } };
    expect(validateBundle(b)).toEqual(['expanders.x.loginWall: invalid', 'expanders.x.normalizeHost: invalid', 'expanders.x.shareId: invalid']);
  });

  it('rejects malformed knowledge entries', () => {
    const b = {
      ...valid(),
      knowledge: {
        ok: { category: 'campaign', risk: 'low', desc: { en: 'x' } },
        nodesc: { category: 'campaign', risk: 'low' },
        badcat: { category: 'nope', risk: 'low', desc: {} },
      },
    };
    expect(validateBundle(b)).toEqual(['knowledge.nodesc: invalid entry', 'knowledge.badcat: invalid entry']);
  });
});
