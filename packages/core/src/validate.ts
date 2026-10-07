import { compile } from './regex';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isStrMap = (v: unknown) => isObj(v) && Object.values(v).every((x) => typeof x === 'string');
const isPattern = (v: unknown) => typeof v === 'string' && compile(v) !== null;

const RULE_FIELDS = ['rules', 'rawRules', 'referralMarketing', 'exceptions', 'redirections'] as const;
const CATEGORIES = ['sharer_id', 'ad_click', 'affiliate', 'campaign', 'session', 'unknown'];
const RISKS = ['high', 'medium', 'low'];

// Validates a bundle obtained at runtime: every field core reads must have the type core expects.
// Any error means: keep the previous bundle.
export function validateBundle(data: unknown): string[] {
  if (!isObj(data)) return ['bundle is not an object'];
  const errors: string[] = [];
  if (data.schemaVersion !== 1) errors.push(`unsupported schemaVersion ${String(data.schemaVersion)}`);
  if (typeof data.version !== 'string') errors.push('version must be a string');
  for (const field of ['providers', 'expanders', 'knowledge'] as const) {
    if (!isObj(data[field])) errors.push(`${field} must be an object`);
  }
  if (errors.length) return errors;

  for (const [name, p] of Object.entries(data.providers as Record<string, unknown>)) {
    if (!isObj(p) || typeof p.urlPattern !== 'string') {
      errors.push(`providers.${name}: missing urlPattern`);
      continue;
    }
    for (const f of RULE_FIELDS) {
      if (p[f] !== undefined && !isStrArr(p[f])) errors.push(`providers.${name}.${f}: must be a string array`);
    }
  }

  const expanders = Object.entries(data.expanders as Record<string, unknown>);
  if (expanders.length === 0) errors.push('expanders is empty');
  for (const [name, e] of expanders) {
    if (!isObj(e) || !isPattern(e.match)) {
      errors.push(`expanders.${name}: invalid match`);
      continue;
    }
    const wall = e.loginWall;
    if (wall !== undefined && !(isObj(wall) && isPattern(wall.match) && typeof wall.param === 'string')) {
      errors.push(`expanders.${name}.loginWall: invalid`);
    }
    if (e.normalizeHost !== undefined && !isStrMap(e.normalizeHost)) errors.push(`expanders.${name}.normalizeHost: invalid`);
    if (e.shareId !== undefined && typeof e.shareId !== 'string') errors.push(`expanders.${name}.shareId: invalid`);
    if (e.firstHop !== undefined && typeof e.firstHop !== 'boolean') errors.push(`expanders.${name}.firstHop: invalid`);
  }

  for (const [key, k] of Object.entries(data.knowledge as Record<string, unknown>)) {
    const ok =
      isObj(k) &&
      CATEGORIES.includes(k.category as string) &&
      RISKS.includes(k.risk as string) &&
      isStrMap(k.desc) &&
      (k.owner === undefined || typeof k.owner === 'string');
    if (!ok) errors.push(`knowledge.${key}: invalid entry`);
  }
  return errors;
}
