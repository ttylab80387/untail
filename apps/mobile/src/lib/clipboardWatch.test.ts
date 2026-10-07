import { describe, expect, it } from 'vitest';
import type { RuleBundle } from '@linkclean/core';
import { decideAndroid, decideIos, initialWatchState, needsCleaning, noteSelfWrite } from './clipboardWatch';

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

describe('decideAndroid', () => {
  it('offers the URL found in new clipboard text', () => {
    const r = decideAndroid('看這個 https://ex.com/a?utm_source=x', initialWatchState(), rules);
    expect(r.url).toBe('https://ex.com/a?utm_source=x');
  });

  it('does not offer the same text twice', () => {
    const first = decideAndroid('https://ex.com/a?fbclid=1', initialWatchState(), rules);
    expect(decideAndroid('https://ex.com/a?fbclid=1', first.next, rules).url).toBeNull();
  });

  it('does not offer a link that is already clean, e.g. one copied in an earlier session', () => {
    expect(decideAndroid('https://www.threads.com/@a/post/B', initialWatchState(), rules).url).toBeNull();
  });

  it('ignores text without a URL', () => {
    expect(decideAndroid('just words', initialWatchState(), rules).url).toBeNull();
    expect(decideAndroid('', initialWatchState(), rules).url).toBeNull();
  });

  it('does not offer a link the app copied itself', () => {
    const s = noteSelfWrite(initialWatchState(), 'https://ex.com/clean');
    expect(decideAndroid('https://ex.com/clean', s, rules).url).toBeNull();
  });

  it('offers a different link copied after the app wrote its own', () => {
    const s = noteSelfWrite(initialWatchState(), 'https://ex.com/clean');
    expect(decideAndroid('https://other.example/b?fbclid=1', s, rules).url).toBe('https://other.example/b?fbclid=1');
  });
});

describe('decideIos', () => {
  it('offers when the clipboard has a URL', () => {
    expect(decideIos(true, initialWatchState()).offer).toBe(true);
    expect(decideIos(false, initialWatchState()).offer).toBe(false);
  });

  it('skips once right after the app copied a clean link, then offers again', () => {
    const s = noteSelfWrite(initialWatchState(), 'https://ex.com/clean');
    const first = decideIos(true, s);
    expect(first.offer).toBe(false);
    expect(decideIos(true, first.next).offer).toBe(true);
  });
});
