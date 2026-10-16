import { createHash } from 'node:crypto';
import type { Expander, KnowledgeEntry, Provider, RuleBundle } from '@linkclean/core';
import { ARRAY_FIELDS, mergeProviders } from './merge';

export interface OwnData {
  overrides: { providers: Record<string, Partial<Provider>> };
  expanders: Record<string, Expander>;
  knowledge: Record<string, KnowledgeEntry>;
}

// Only categories every installed app accepts: an app rejects the whole bundle on an unknown one.
// ('hidden' is described by the app itself, not by published rules.)
const CATEGORIES = ['sharer_id', 'ad_click', 'affiliate', 'campaign', 'session', 'unknown'];
const RISKS = ['high', 'medium', 'low'];
const LOCALES = ['zh-TW', 'en', 'ja'] as const;
const KEY_PATTERN_FIELDS = new Set(['rules', 'referralMarketing']);

export function validateOwnData({ overrides, expanders, knowledge }: OwnData): string[] {
  const errors: string[] = [];
  const checkRe = (where: string, src: string, compiled = src) => {
    try {
      new RegExp(compiled, 'i');
    } catch {
      errors.push(`${where}: invalid regex ${src}`);
    }
  };

  for (const [name, p] of Object.entries(overrides.providers)) {
    if (p.urlPattern !== undefined) checkRe(`overrides.${name}.urlPattern`, p.urlPattern);
    for (const f of ARRAY_FIELDS) {
      for (const r of p[f] ?? []) checkRe(`overrides.${name}.${f}`, r, KEY_PATTERN_FIELDS.has(f) ? `^(?:${r})$` : r);
    }
  }

  for (const [name, e] of Object.entries(expanders)) {
    checkRe(`expanders.${name}.match`, e.match);
    if (e.shareId !== undefined) checkRe(`expanders.${name}.shareId`, e.shareId);
    if (e.loginWall) checkRe(`expanders.${name}.loginWall.match`, e.loginWall.match);
  }

  for (const [key, k] of Object.entries(knowledge)) {
    if (key !== key.toLowerCase()) errors.push(`knowledge.${key}: key must be lowercase`);
    if (key.endsWith('*') && key.includes(':')) errors.push(`knowledge.${key}: wildcard keys cannot have a host`);
    if (!CATEGORIES.includes(k.category)) errors.push(`knowledge.${key}: invalid category ${k.category}`);
    if (!RISKS.includes(k.risk)) errors.push(`knowledge.${key}: invalid risk ${k.risk}`);
  }
  return errors;
}

export function missingTranslations(kb: Record<string, KnowledgeEntry>): string[] {
  const out: string[] = [];
  for (const [key, k] of Object.entries(kb)) {
    const missing = LOCALES.filter((l) => !k.desc?.[l]);
    if (missing.length) out.push(`knowledge.${key}: missing ${missing.join(', ')}`);
  }
  return out;
}

export function buildBundle(
  input: OwnData & { clearurls: { providers: Record<string, Provider> }; version: string },
): RuleBundle {
  return {
    schemaVersion: 1,
    version: input.version,
    providers: mergeProviders(input.clearurls.providers, input.overrides.providers),
    expanders: input.expanders,
    knowledge: input.knowledge,
  };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function makeVersion(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
