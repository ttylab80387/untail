// apps/mobile/src/lib/tileFlow.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProcessResult, RuleBundle } from '@linkclean/core';
import type { CleanOutcome } from './cleaner';
import { createTileGate, runTile } from './tileFlow';
import type { CleanPolicy, TileFlowDeps } from './tileFlow';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: { globalRules: { urlPattern: '.*', rules: ['utm_source'] } },
  expanders: {},
  knowledge: {},
};

const DIRTY = 'https://ex.com/a?utm_source=x';
const CLEAN = 'https://ex.com/a';
const removed: ProcessResult['removed'] = [{ key: 'utm_source', value: 'x', category: 'campaign', risk: 'low' }];
const cleaned: ProcessResult = { originalUrl: DIRTY, cleanUrl: CLEAN, status: 'clean', removed, hops: [DIRTY] };

describe('createTileGate', () => {
  it('treats a second tap while a request runs as the same request', () => {
    const g = createTileGate();
    const first = g.start();
    expect(first).not.toBeNull();
    expect(g.start()).toBeNull();
    expect(g.isValid(first!)).toBe(true);
  });

  it('after leaving: no more side effects, result still shown, a new tap replaces it', () => {
    const g = createTileGate();
    const first = g.start()!;
    g.leave();
    expect(g.isValid(first)).toBe(false);
    expect(g.showsResult(first)).toBe(true);
    const second = g.start()!;
    expect(second).not.toBe(first);
    expect(g.showsResult(first)).toBe(false);
    expect(g.isValid(second)).toBe(true);
  });

  it('a user action cancels the request and its result', () => {
    const g = createTileGate();
    const id = g.start()!;
    g.cancel();
    expect(g.isValid(id)).toBe(false);
    expect(g.showsResult(id)).toBe(false);
    expect(g.busy()).toBe(false);
  });

  it('finishing frees the gate, and an old id cannot finish a newer request', () => {
    const g = createTileGate();
    const first = g.start()!;
    g.finish(first);
    expect(g.busy()).toBe(false);
    const second = g.start()!;
    g.finish(first);
    expect(g.isValid(second)).toBe(true);
  });
});

let log: string[];
let clips: string[];
let reads: number;
let valid: boolean;
let cleanResult: (text: string, policy: CleanPolicy) => Promise<CleanOutcome | null>;

const deps = (over: Partial<TileFlowDeps> = {}): TileFlowDeps => ({
  waitForFocus: async () => true,
  readClipboard: async () => {
    reads += 1;
    return clips.shift() ?? '';
  },
  sleep: async (ms) => {
    log.push(`sleep ${ms}`);
  },
  rules: () => rules,
  clean: (text, policy) => cleanResult(text, policy),
  isValid: () => valid,
  noteSeen: (t) => log.push(`seen ${t}`),
  resetScreen: () => log.push('reset'),
  showNotice: (n) => log.push(`notice ${n}`),
  toast: (t) => log.push(`toast ${JSON.stringify(t)}`),
  moveToBack: async () => {
    log.push('back');
    return true;
  },
  remember: async (r) => {
    log.push(`remember ${r.row}`);
  },
  forget: async () => {
    log.push('forget');
  },
  ...over,
});

beforeEach(() => {
  log = [];
  clips = [];
  reads = 0;
  valid = true;
  cleanResult = async (_text, policy) => ({ result: cleaned, copied: policy.copyIf(cleaned) });
});

describe('runTile', () => {
  it('returns to the previous app after a cold start, toast first', async () => {
    clips = [DIRTY];
    const d = await runTile(false, deps());
    expect(d.row).toBe(1);
    expect(log).toEqual([`seen ${DIRTY}`, 'notice null', 'remember 1', 'toast {"kind":"copied","removed":1}', 'back']);
  });

  it('stays when Untail was already in front', async () => {
    clips = [DIRTY];
    await runTile(true, deps());
    expect(log).not.toContain('back');
    expect(log).toContain('toast {"kind":"copied","removed":1}');
  });

  it('does not clean or copy an already clean link, and clears the old result', async () => {
    clips = [CLEAN];
    let cleanedCalled = false;
    cleanResult = async () => {
      cleanedCalled = true;
      return null;
    };
    const d = await runTile(false, deps());
    expect(d.row).toBe(2);
    expect(cleanedCalled).toBe(false);
    expect(log).toEqual([`seen ${CLEAN}`, 'reset', 'notice null', 'remember 2', 'toast {"kind":"noTracking"}', 'back']);
  });

  it('copies and records only a changed link while the request is valid', async () => {
    clips = [DIRTY];
    const got: { policy?: CleanPolicy } = {};
    cleanResult = async (_t, policy) => {
      got.policy = policy;
      return { result: cleaned, copied: policy.copyIf(cleaned) };
    };
    await runTile(false, deps());
    const p = got.policy!;
    const same: ProcessResult = { originalUrl: CLEAN, cleanUrl: CLEAN, status: 'clean', removed: [], hops: [CLEAN] };
    const partial: ProcessResult = { ...same, status: 'partial', reason: 'expand_disabled' };
    expect(p.copyIf(cleaned)).toBe(true);
    expect(p.copyIf(same)).toBe(false);
    expect(p.copyIf(partial)).toBe(false);
    expect(p.recordIf(cleaned)).toBe(true);
    expect(p.recordIf(same)).toBe(false);
    expect(p.recordIf(partial)).toBe(true);
    valid = false;
    expect(p.recordIf(cleaned)).toBe(false);
  });

  it('stays and clears the last tile line when the copy failed', async () => {
    clips = [DIRTY];
    cleanResult = async () => ({ result: cleaned, copied: false });
    const d = await runTile(false, deps());
    expect(d.row).toBe(5);
    expect(log).toEqual([`seen ${DIRTY}`, 'notice null', 'forget']);
  });

  it('retries once after an empty read, then reports no link', async () => {
    clips = ['', ''];
    const d = await runTile(false, deps());
    expect(d.row).toBe(3);
    expect(log).toEqual(['sleep 100', 'seen ', 'reset', 'notice no_link', 'forget']);
  });

  it('uses the second read when the first was empty', async () => {
    clips = ['', DIRTY];
    const d = await runTile(false, deps());
    expect(d.row).toBe(1);
  });

  it('does not read again after the user left during the retry pause', async () => {
    clips = ['', DIRTY];
    const d = await runTile(
      false,
      deps({
        sleep: async () => {
          valid = false;
        },
      }),
    );
    expect(reads).toBe(1);
    expect(d.row).toBe(7);
  });

  it('reports unreadable when focus never comes', async () => {
    const d = await runTile(false, deps({ waitForFocus: async () => false }));
    expect(d.row).toBe(4);
    expect(reads).toBe(0);
    expect(log).toEqual(['reset', 'notice unreadable', 'forget']);
  });

  it('reports unreadable when reading throws', async () => {
    const d = await runTile(
      false,
      deps({
        readClipboard: async () => {
          throw new Error('denied');
        },
      }),
    );
    expect(d.row).toBe(4);
  });

  it('does not start cleaning once the request is invalid, e.g. a share arrived', async () => {
    let cleanedCalled = false;
    cleanResult = async () => {
      cleanedCalled = true;
      return null;
    };
    const d = await runTile(
      false,
      deps({
        readClipboard: async () => {
          valid = false;
          return DIRTY;
        },
      }),
    );
    expect(cleanedCalled).toBe(false);
    expect(d.row).toBe(7);
  });

  it('does nothing visible when the request turns invalid while cleaning', async () => {
    clips = [DIRTY];
    cleanResult = async (_t, policy) => {
      valid = false; // the user left while a short link was expanding
      return { result: cleaned, copied: policy.copyIf(cleaned) };
    };
    const d = await runTile(false, deps());
    expect(d.row).toBe(7);
    expect(log.some((l) => l.startsWith('toast') || l === 'back' || l.startsWith('remember') || l === 'forget')).toBe(false);
  });

  it('does not go back when the request turns invalid right after the toast', async () => {
    clips = [DIRTY];
    const d = await runTile(
      false,
      deps({
        toast: (t) => {
          log.push(`toast ${JSON.stringify(t)}`);
          valid = false;
        },
      }),
    );
    expect(d.row).toBe(1);
    expect(log).not.toContain('back');
  });
});
