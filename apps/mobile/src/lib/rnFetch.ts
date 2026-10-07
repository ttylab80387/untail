import type { FetchFn } from '@linkclean/core';

// The platform fetch follows redirects itself; we only need the final URL and status.
export const rnFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, signal: init.signal, redirect: 'follow' });
  return { url: res.url, status: res.status };
};
