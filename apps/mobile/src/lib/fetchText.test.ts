import { afterEach, describe, expect, it, vi } from 'vitest';
import { FETCH_TIMEOUT_MS, makeFetchText } from './fetchText';

afterEach(() => {
  vi.useRealTimers();
});

const respond = (status: number, body: string) =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

describe('makeFetchText', () => {
  it('returns the body on 200', async () => {
    expect(await makeFetchText(respond(200, 'hello'))('https://x/')).toBe('hello');
  });

  it('throws on 404', async () => {
    await expect(makeFetchText(respond(404, 'nope'))('https://x/')).rejects.toThrow('HTTP 404');
  });

  it('rejects after the timeout when the request hangs', async () => {
    vi.useFakeTimers();
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const p = makeFetchText(hanging)('https://x/');
    const settled = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    await settled;
    expect(FETCH_TIMEOUT_MS).toBe(15_000);
  });
});
