import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { processUrl } from '@linkclean/core';
import type { FetchFn, RuleBundle } from '@linkclean/core';
import cases from '../../fixtures/cases.json';

const rulesPath = fileURLToPath(new URL('../../dist/rules.json', import.meta.url));
if (!existsSync(rulesPath)) throw new Error('rules/dist/rules.json missing: run `pnpm build:rules` first');
const rules = JSON.parse(readFileSync(rulesPath, 'utf8')) as RuleBundle;

function replay(responses: Record<string, string | undefined>): FetchFn {
  return async (url) => {
    const final = responses[url];
    if (final === undefined) throw new Error(`no recorded response for ${url}`);
    return { url: final, status: 200 };
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
