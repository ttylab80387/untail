import { afterEach, describe, expect, it, vi } from 'vitest';
import { rnFetch } from './rnFetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rnFetch', () => {
  it('forwards method, headers and signal, follows redirects, and reports the final URL', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: unknown) => {
      seen.push([url, init]);
      return { url: 'https://final.example/', status: 200 };
    });
    const signal = new AbortController().signal;
    const r = await rnFetch('https://bit.ly/x', { method: 'HEAD', headers: { 'User-Agent': 'LinkClean/test' }, signal });
    expect(r).toEqual({ url: 'https://final.example/', status: 200 });
    expect(seen).toEqual([['https://bit.ly/x', { method: 'HEAD', headers: { 'User-Agent': 'LinkClean/test' }, signal, redirect: 'follow' }]]);
  });
});
