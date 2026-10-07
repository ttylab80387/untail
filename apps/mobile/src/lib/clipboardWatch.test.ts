import { describe, expect, it } from 'vitest';
import { decideAndroid, decideIos, initialWatchState, noteSelfWrite } from './clipboardWatch';

describe('decideAndroid', () => {
  it('offers the URL found in new clipboard text', () => {
    const r = decideAndroid('看這個 https://ex.com/a?utm_source=x', initialWatchState());
    expect(r.url).toBe('https://ex.com/a?utm_source=x');
  });

  it('does not offer the same text twice', () => {
    const first = decideAndroid('https://ex.com/a', initialWatchState());
    expect(decideAndroid('https://ex.com/a', first.next).url).toBeNull();
  });

  it('ignores text without a URL', () => {
    expect(decideAndroid('just words', initialWatchState()).url).toBeNull();
    expect(decideAndroid('', initialWatchState()).url).toBeNull();
  });

  it('does not offer a link the app copied itself', () => {
    const s = noteSelfWrite(initialWatchState(), 'https://ex.com/clean');
    expect(decideAndroid('https://ex.com/clean', s).url).toBeNull();
  });

  it('offers a different link copied after the app wrote its own', () => {
    const s = noteSelfWrite(initialWatchState(), 'https://ex.com/clean');
    expect(decideAndroid('https://other.example/b?fbclid=1', s).url).toBe('https://other.example/b?fbclid=1');
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
