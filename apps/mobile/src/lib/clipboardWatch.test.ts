import { describe, expect, it } from 'vitest';
import type { RuleBundle } from '@linkclean/core';
import type { ProcessResult } from '@linkclean/core';
import type { CleanOutcome } from './cleaner';
import { decideText, decideIos, initialWatchState, needsCleaning, noteSelfWrite, undoTarget } from './clipboardWatch';

const rules: RuleBundle = {
  schemaVersion: 1,
  version: 'test',
  providers: {
    globalRules: { urlPattern: '.*', rules: ['utm_source', 'fbclid'] },
    facebook: {
      urlPattern: '^https?:\\/\\/(?:[a-z0-9-]+\\.)*?facebook\\.com',
      redirections: ['^https?:\\/\\/l[a-z]?\\.facebook\\.com/l\\.php\\?.*?u=(https?%3A%2F%2F[^&]*)'],
    },
  },
  expanders: { threads: { match: '^https://www\\.threads\\.com/share/' } },
  knowledge: {},
};

describe('needsCleaning', () => {
  it('is true for links with tracking params, wrappers or share links', () => {
    expect(needsCleaning('https://ex.com/a?utm_source=x', rules)).toBe(true);
    expect(needsCleaning('https://l.facebook.com/l.php?u=https%3A%2F%2Fex.com%2F', rules)).toBe(true);
    expect(needsCleaning('https://www.threads.com/share/ABC/', rules)).toBe(true);
  });
  it('is false for links that are already clean', () => {
    expect(needsCleaning('https://www.threads.com/@a/post/B', rules)).toBe(false);
    expect(needsCleaning('https://ex.com/a?id=1', rules)).toBe(false);
  });
});

describe('decideText', () => {
  it('offers the URL found in new clipboard text', () => {
    const r = decideText('看這個 https://ex.com/a?utm_source=x', initialWatchState(), rules);
    expect(r.url).toBe('https://ex.com/a?utm_source=x');
  });

  it('does not offer the same text twice', () => {
    const first = decideText('https://ex.com/a?fbclid=1', initialWatchState(), rules);
    expect(decideText('https://ex.com/a?fbclid=1', first.next, rules).url).toBeNull();
  });

  it('does not offer a link that is already clean, e.g. one copied in an earlier session', () => {
    expect(decideText('https://www.threads.com/@a/post/B', initialWatchState(), rules).url).toBeNull();
  });

  it('ignores text without a URL', () => {
    expect(decideText('just words', initialWatchState(), rules).url).toBeNull();
    expect(decideText('', initialWatchState(), rules).url).toBeNull();
  });

  it('does not offer a link the app copied itself', () => {
    const s = noteSelfWrite(initialWatchState(), 'https://ex.com/clean');
    expect(decideText('https://ex.com/clean', s, rules).url).toBeNull();
  });

  it('offers a different link copied after the app wrote its own', () => {
    const s = noteSelfWrite(initialWatchState(), 'https://ex.com/clean');
    expect(decideText('https://other.example/b?fbclid=1', s, rules).url).toBe('https://other.example/b?fbclid=1');
  });

  it('returns a new link that has nothing to clean, so the screen can show it', () => {
    expect(decideText('see https://www.threads.com/@a/post/B', initialWatchState(), rules).clean).toBe(
      'https://www.threads.com/@a/post/B',
    );
    expect(decideText('https://ex.com/a?fbclid=1', initialWatchState(), rules).clean).toBeNull();
    expect(decideText('just words', initialWatchState(), rules).clean).toBeNull();
    const seen = decideText('https://www.threads.com/@a/post/B', initialWatchState(), rules).next;
    expect(decideText('https://www.threads.com/@a/post/B', seen, rules).clean).toBeNull();
  });

  it('marks new clipboard content as fresh even when there is nothing to clean', () => {
    const first = decideText('https://ex.com/a?fbclid=1', initialWatchState(), rules);
    expect(first.fresh).toBe(true);
    expect(decideText('https://www.threads.com/@a/post/B', first.next, rules).fresh).toBe(true);
    expect(decideText('https://ex.com/a?fbclid=1', first.next, rules).fresh).toBe(false);
    expect(decideText('', first.next, rules).fresh).toBe(false);
  });
});

describe('decideIos', () => {
  const clip = (hasUrl: boolean, changeCount: number) => ({ hasUrl, changeCount });

  it('offers a link the first time it sees the clipboard', () => {
    expect(decideIos(clip(true, 5), initialWatchState()).offer).toBe(true);
    expect(decideIos(clip(false, 5), initialWatchState()).offer).toBe(false);
  });

  it('stays quiet while the clipboard has not changed, so iOS never asks to paste again', () => {
    const first = decideIos(clip(true, 5), initialWatchState());
    const again = decideIos(clip(true, 5), first.next);
    expect(again).toMatchObject({ fresh: false, offer: false });
  });

  it('never offers the link the app copied itself, however often the app comes back', () => {
    let s = noteSelfWrite(initialWatchState(), 'https://ex.com/clean', 9);
    for (let i = 0; i < 3; i++) {
      const d = decideIos(clip(true, 9), s);
      expect(d.offer).toBe(false);
      s = d.next;
    }
  });

  it('reports new content even without a link, so older work cannot overwrite it', () => {
    const s = noteSelfWrite(initialWatchState(), 'https://ex.com/clean', 9);
    expect(decideIos(clip(false, 10), s)).toMatchObject({ fresh: true, offer: false });
    expect(decideIos(clip(true, 10), s)).toMatchObject({ fresh: true, offer: true });
  });
});

describe('undoTarget', () => {
  const outcome = (cleanUrl: string, copied: boolean): CleanOutcome => ({
    result: { cleanUrl, status: copied ? 'clean' : 'partial' } as ProcessResult,
    copied,
  });
  const original = 'look https://ex.com/a?utm_source=x';

  it('returns the original clipboard text when a different clean link was copied', () => {
    expect(undoTarget(original, outcome('https://ex.com/a', true))).toBe(original);
  });

  it('returns null when nothing was copied', () => {
    expect(undoTarget(original, outcome('https://ex.com/a', false))).toBeNull();
  });

  it('returns null when the copied text equals the original', () => {
    expect(undoTarget('https://ex.com/a', outcome('https://ex.com/a', true))).toBeNull();
  });
});
