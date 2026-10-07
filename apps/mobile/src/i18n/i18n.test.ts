import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./locales/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

const locales = { 'zh-TW': flatten(load('zh-TW')), en: flatten(load('en')), ja: flatten(load('ja')) };

describe('locale files', () => {
  it('share the same keys', () => {
    const keys = Object.keys(locales.en).sort();
    expect(Object.keys(locales['zh-TW']).sort()).toEqual(keys);
    expect(Object.keys(locales.ja).sort()).toEqual(keys);
  });

  it('have no empty strings', () => {
    for (const [name, table] of Object.entries(locales)) {
      for (const [k, v] of Object.entries(table)) expect(typeof v === 'string' && v.length > 0, `${name}:${k}`).toBe(true);
    }
  });

  it('cover every enum value the UI renders', () => {
    const required = [
      ...['expand_disabled', 'expand_timeout', 'unresolved', 'network', 'invalid_input'].map((r) => `result.reason.${r}`),
      ...['sharer_id', 'ad_click', 'affiliate', 'campaign', 'session', 'unknown'].map((c) => `category.${c}`),
      ...['high', 'medium', 'low'].map((r) => `risk.${r}`),
      ...['disabled', 'throttled', 'up-to-date', 'updated', 'failed'].map((o) => `settings.update.${o}`),
    ];
    for (const key of required) expect(locales.en, key).toHaveProperty([key]);
  });
});
