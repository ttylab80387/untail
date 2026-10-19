import { describe, expect, it } from 'vitest';
import type { ProcessResult, RuleBundle } from '@linkclean/core';
import { decideTileOutcome, precheckTile } from './tileOutcome';
import type { TileFacts } from './tileOutcome';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: { globalRules: { urlPattern: '.*', rules: ['utm_source'] } },
  expanders: { bitly: { match: '^https://bit\\.ly/' } },
  knowledge: {},
};

const ZWSP = String.fromCharCode(0x200b);

const result = (over: Partial<ProcessResult>): ProcessResult => ({
  originalUrl: 'https://ex.com/a?utm_source=x',
  cleanUrl: 'https://ex.com/a',
  status: 'clean',
  removed: [],
  hops: ['https://ex.com/a?utm_source=x'],
  ...over,
});

const facts = (over: Partial<TileFacts>): TileFacts => ({
  read: 'ok',
  pre: { kind: 'needs_cleaning' },
  outcome: null,
  wasInForeground: false,
  valid: true,
  ...over,
});

const removedItem: ProcessResult['removed'][number] = { key: 'utm_source', value: 'x', category: 'campaign', risk: 'low' };

describe('precheckTile', () => {
  it('finds no link in empty or plain text', () => {
    expect(precheckTile('', rules)).toEqual({ kind: 'no_link' });
    expect(precheckTile('see you at 7', rules)).toEqual({ kind: 'no_link' });
  });

  it('treats a link with nothing to clean as already clean', () => {
    expect(precheckTile('https://ex.com/a', rules)).toEqual({ kind: 'already_clean', url: 'https://ex.com/a' });
  });

  it('needs cleaning for tracking params, short links and removable hidden characters', () => {
    expect(precheckTile('https://ex.com/a?utm_source=x', rules)).toEqual({ kind: 'needs_cleaning' });
    expect(precheckTile('https://bit.ly/abc', rules)).toEqual({ kind: 'needs_cleaning' });
    expect(precheckTile(`https://ex.com/a${ZWSP}b`, rules)).toEqual({ kind: 'needs_cleaning' });
  });

  it('finds the link inside surrounding text', () => {
    expect(precheckTile('look: https://ex.com/a?utm_source=x thanks', rules)).toEqual({ kind: 'needs_cleaning' });
  });
});

describe('decideTileOutcome', () => {
  it('row 1: copied, toast with the count, returns when Untail was not in front', () => {
    const d = decideTileOutcome(facts({ outcome: { result: result({ removed: [removedItem] }), copied: true } }));
    expect(d).toEqual({ row: 1, toast: { kind: 'copied', removed: 1 }, goBack: true, remember: { row: 1, removed: 1, expandedOnly: false } });
  });

  it('row 1: an expansion with nothing removed says expanded', () => {
    const d = decideTileOutcome(facts({ outcome: { result: result({ removed: [] }), copied: true } }));
    expect(d.toast).toEqual({ kind: 'expanded' });
    expect(d.remember).toEqual({ row: 1, removed: 0, expandedOnly: true });
  });

  it('counts a removed hidden character as a change', () => {
    const hidden: ProcessResult['removed'][number] = { key: 'hidden', value: 'U+200B', category: 'hidden', risk: 'low' };
    const same = { originalUrl: 'https://ex.com/ab', cleanUrl: 'https://ex.com/ab' };
    const d = decideTileOutcome(facts({ outcome: { result: result({ ...same, removed: [hidden] }), copied: true } }));
    expect(d.toast).toEqual({ kind: 'copied', removed: 1 });
  });

  it('row 1: stays when Untail was already in front', () => {
    const d = decideTileOutcome(facts({ wasInForeground: true, outcome: { result: result({ removed: [removedItem] }), copied: true } }));
    expect(d.row).toBe(1);
    expect(d.goBack).toBe(false);
    expect(d.toast).toEqual({ kind: 'copied', removed: 1 });
  });

  it('row 2: already clean toasts and returns, nothing else', () => {
    const d = decideTileOutcome(facts({ pre: { kind: 'already_clean', url: 'https://ex.com/a' } }));
    expect(d).toEqual({ row: 2, toast: { kind: 'noTracking' }, goBack: true, remember: { row: 2, removed: 0, expandedOnly: false } });
  });

  it('row 2: a short link that expands to itself with nothing removed is already clean', () => {
    const same = result({ originalUrl: 'https://bit.ly/abc', cleanUrl: 'https://bit.ly/abc', removed: [] });
    const d = decideTileOutcome(facts({ outcome: { result: same, copied: false } }));
    expect(d).toEqual({ row: 2, toast: { kind: 'noTracking' }, goBack: true, remember: { row: 2, removed: 0, expandedOnly: false } });
  });

  it('row 3: no link stays without toast', () => {
    expect(decideTileOutcome(facts({ pre: { kind: 'no_link' } }))).toEqual({ row: 3, toast: null, goBack: false, remember: null });
  });

  it('row 4: unreadable clipboard stays without toast', () => {
    expect(decideTileOutcome(facts({ read: 'unreadable', pre: null }))).toEqual({ row: 4, toast: null, goBack: false, remember: null });
  });

  it('row 5: changed but not copied stays', () => {
    const d = decideTileOutcome(facts({ outcome: { result: result({ removed: [removedItem] }), copied: false } }));
    expect(d).toEqual({ row: 5, toast: null, goBack: false, remember: null });
  });

  it('stays on partial results', () => {
    const d = decideTileOutcome(facts({ outcome: { result: result({ status: 'partial', reason: 'expand_disabled' }), copied: false } }));
    expect(d).toEqual({ row: 6, toast: null, goBack: false, remember: null });
  });

  it('row 6: failed, or a job that returned nothing, stays', () => {
    expect(decideTileOutcome(facts({ outcome: { result: result({ status: 'failed', cleanUrl: '' }), copied: false } })).row).toBe(6);
    expect(decideTileOutcome(facts({ outcome: null })).row).toBe(6);
  });

  it('row 7: an invalid request does nothing, whatever the result', () => {
    const d = decideTileOutcome(facts({ valid: false, outcome: { result: result({ removed: [removedItem] }), copied: true } }));
    expect(d).toEqual({ row: 7, toast: null, goBack: false, remember: null });
  });
});
