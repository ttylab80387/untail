import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetch as expoFetch } from 'expo/fetch';
import { rnFetch } from './rnFetch';

vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(expoFetch).mockReset();
});

describe('rnFetch', () => {
  it('forwards method, headers and signal, follows redirects, and reports the final URL', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: unknown) => {
      seen.push([url, init]);
      return { url: 'https://final.example/', status: 200 };
    });
    const signal = new AbortController().signal;
    const r = await rnFetch('https://bit.ly/x', { method: 'HEAD', headers: { 'User-Agent': 'Untail/test' }, signal, redirect: 'follow' });
    expect(r).toEqual({ url: 'https://final.example/', status: 200 });
    expect(seen).toEqual([['https://bit.ly/x', { method: 'HEAD', headers: { 'User-Agent': 'Untail/test' }, signal, redirect: 'follow' }]]);
    expect(expoFetch).not.toHaveBeenCalled();
  });

  it('uses expo/fetch for manual redirects and reports the Location header', async () => {
    vi.mocked(expoFetch).mockResolvedValue({
      url: 'http://xhslink.com/o/x',
      status: 302,
      headers: new Headers({ Location: 'https://www.xiaohongshu.com/discovery/item/a' }),
    } as never);
    const signal = new AbortController().signal;
    const init = { method: 'GET' as const, headers: { 'User-Agent': 'Untail/test' }, signal, redirect: 'manual' as const };
    const r = await rnFetch('http://xhslink.com/o/x', init);
    expect(r).toEqual({ url: 'http://xhslink.com/o/x', status: 302, location: 'https://www.xiaohongshu.com/discovery/item/a' });
    expect(expoFetch).toHaveBeenCalledWith('http://xhslink.com/o/x', init);
  });
});
