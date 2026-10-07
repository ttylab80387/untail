import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FetchFn, RuleBundle } from '@linkclean/core';

export const nodeFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, init);
  const location = res.headers.get('location');
  return { url: res.url || url, status: res.status, ...(location ? { location } : {}) };
};

export async function loadRules(): Promise<RuleBundle> {
  const path = fileURLToPath(new URL('../dist/rules.json', import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as RuleBundle;
}
