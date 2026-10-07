import { fetch as expoFetch } from 'expo/fetch';
import type { FetchFn } from '@linkclean/core';

// The platform fetch follows redirects itself; we only need the final URL and status.
// React Native's fetch cannot stop at a redirect, so manual mode goes through expo/fetch,
// which returns the 3xx response with its Location header.
export const rnFetch: FetchFn = async (url, init) => {
  const { method, headers, signal } = init;
  if (init.redirect === 'manual') {
    const res = await expoFetch(url, { method, headers, signal, redirect: 'manual' });
    const location = res.headers.get('location');
    return { url: res.url || url, status: res.status, ...(location ? { location } : {}) };
  }
  const res = await fetch(url, { method, headers, signal, redirect: 'follow' });
  return { url: res.url, status: res.status };
};
