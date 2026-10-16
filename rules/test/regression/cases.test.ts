import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalUrl, processUrl, sameSite } from '@linkclean/core';
import type { FetchFn, RuleBundle } from '@linkclean/core';
import cases from '../../fixtures/cases.json';

const rulesPath = fileURLToPath(new URL('../../dist/rules.json', import.meta.url));
if (!existsSync(rulesPath)) throw new Error('rules/dist/rules.json missing: run `pnpm build:rules` first');
const rules = JSON.parse(readFileSync(rulesPath, 'utf8')) as RuleBundle;

const loginWalls = Object.values(rules.expanders).flatMap((e) => (e.loginWall ? [new RegExp(e.loginWall.match, 'i')] : []));

// Each recorded short link answers with a redirect to its final URL. A final URL is answered only
// when it is on the same site as the link that pointed to it and is not a login wall; anything else
// is an unexpected request.
function replay(responses: Record<string, string | undefined>): FetchFn {
  const source = new Map(Object.entries(responses).map(([from, to]) => [canonicalUrl(to ?? '') ?? to, from]));
  return async (url, init) => {
    if (init.redirect !== 'manual' || (init.method !== 'HEAD' && init.method !== 'GET')) {
      throw new Error(`unexpected ${init.method} ${init.redirect} request to ${url}`);
    }
    const final = responses[url];
    if (final === url) return { url, status: 200 }; // recorded as not redirecting
    if (final !== undefined) return { url, status: 302, location: final };
    if (loginWalls.some((re) => re.test(url))) throw new Error(`login wall requested: ${url}`);
    const from = source.get(url);
    if (from !== undefined && sameSite(from, url)) return { url, status: 200 };
    throw new Error(`unexpected request to ${url}`);
  };
}

describe('offline regression against built rules', () => {
  it.each(cases)('$name', async (c) => {
    const r = await processUrl(c.input, rules, { expand: true, locale: 'en', fetch: replay(c.responses) });
    expect(r.cleanUrl).toBe(c.expected.cleanUrl);
    expect(r.status).toBe(c.expected.status);
    expect(r.removed.map((p) => p.key).sort()).toEqual([...c.expected.removedKeys].sort());
  });
});
