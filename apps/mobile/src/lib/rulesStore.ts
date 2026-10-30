import { validateBundle } from '@linkclean/core';
import type { RuleBundle } from '@linkclean/core';
import { getKv, setKv } from './db';
import type { Db } from './db';

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// The CDN caches each file for 10 minutes, so a meta/rules mismatch clears within this.
export const MISMATCH_RETRY_MS = 15 * 60 * 1000;

// Bundle text and its hash live in one record so they can never diverge.
const K_CACHE = 'rules.cache';
const K_CHECKED = 'rules.checkedAt';
// Result of the latest check, kept on the phone only for Settings and the user's own report email.
const K_STATUS = 'rules.status';

export interface UpdateDeps {
  db: Db;
  baseUrl: string; // "" disables remote updates
  fetchText(url: string): Promise<string>;
  sha256(text: string): Promise<string>;
  now: number;
  bundledVersion: string;
}

export type FailReason = 'network' | 'mismatch' | 'unsupported' | 'invalid';
export type UpdateOutcome = 'disabled' | 'throttled' | 'up-to-date' | 'updated' | `failed-${FailReason}`;

export interface UpdateStatus {
  lastSuccessAt: number | null;
  failure: { reason: FailReason; at: number; count: number } | null;
}

const EMPTY_STATUS: UpdateStatus = { lastSuccessAt: null, failure: null };
const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}\.\d{4}$/;

// Rules versions are YYYY.MM.DD.HHMM, so valid ones compare as strings; malformed ones sort first.
export function compareVersions(a: string, b: string): number {
  const okA = VERSION_RE.test(a);
  const okB = VERSION_RE.test(b);
  if (!okA || !okB) return Number(okA) - Number(okB);
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function readStatus(db: Db): Promise<UpdateStatus> {
  try {
    const raw = await getKv(db, K_STATUS);
    if (!raw) return EMPTY_STATUS;
    const s = JSON.parse(raw) as Partial<UpdateStatus>;
    return { lastSuccessAt: s.lastSuccessAt ?? null, failure: s.failure ?? null };
  } catch {
    return EMPTY_STATUS;
  }
}

// Retrying will not help for these, so the user may want to tell the developer at once.
export function shouldOfferReport(s: UpdateStatus): boolean {
  const f = s.failure;
  return !!f && (f.count >= 3 || f.reason === 'unsupported' || f.reason === 'invalid');
}

async function recordStatus(db: Db, outcome: UpdateOutcome, now: number): Promise<void> {
  if (outcome === 'updated' || outcome === 'up-to-date') {
    await setKv(db, K_STATUS, JSON.stringify({ lastSuccessAt: now, failure: null }));
    return;
  }
  if (!outcome.startsWith('failed-')) return;
  const reason = outcome.slice('failed-'.length) as FailReason;
  const prev = await readStatus(db);
  const count = prev.failure?.reason === reason ? prev.failure.count + 1 : 1;
  await setKv(db, K_STATUS, JSON.stringify({ lastSuccessAt: prev.lastSuccessAt, failure: { reason, at: now, count } }));
}

interface Cached {
  sha256: string;
  text: string;
  bundle: RuleBundle;
}

async function readCache(db: Db): Promise<Cached | null> {
  const raw = await getKv(db, K_CACHE);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as { sha256?: unknown; text?: unknown };
    if (typeof rec.sha256 !== 'string' || typeof rec.text !== 'string') return null;
    const data: unknown = JSON.parse(rec.text);
    return validateBundle(data).length ? null : { sha256: rec.sha256, text: rec.text, bundle: data as RuleBundle };
  } catch {
    return null;
  }
}

export type RulesSource = 'downloaded' | 'built-in';

// A newer app ships newer rules; an older download must not hide them.
export async function loadRules(db: Db, bundled: RuleBundle): Promise<{ rules: RuleBundle; source: RulesSource }> {
  try {
    const cached = (await readCache(db))?.bundle;
    if (cached && compareVersions(cached.version, bundled.version) > 0) return { rules: cached, source: 'downloaded' };
  } catch {
    // Fall back to the built-in rules.
  }
  return { rules: bundled, source: 'built-in' };
}

export async function updateRules(deps: UpdateDeps, opts: { force?: boolean } = {}): Promise<UpdateOutcome> {
  const { db, baseUrl, now } = deps;
  if (!baseUrl) return 'disabled';
  let outcome: UpdateOutcome;
  try {
    const last = Number((await getKv(db, K_CHECKED)) ?? 0);
    if (!opts.force && now - last < CHECK_INTERVAL_MS) return 'throttled';
    outcome = await check(deps);
  } catch {
    // Storage errors: nothing useful to record; try again next time.
    return 'failed-network';
  }
  try {
    await recordStatus(db, outcome, now);
  } catch {
    // The status is only for display; never let it fail the update.
  }
  return outcome;
}

async function check(deps: UpdateDeps): Promise<UpdateOutcome> {
  const { db, baseUrl, now, bundledVersion } = deps;
  // checkedAt decides the next automatic try: 0 = next open, now = in 24 hours.
  const done = async (outcome: UpdateOutcome, checkedAt = now): Promise<UpdateOutcome> => {
    await setKv(db, K_CHECKED, String(checkedAt));
    return outcome;
  };
  const network = () => done('failed-network', 0);

  let metaText: string;
  try {
    metaText = await deps.fetchText(`${baseUrl}rules.meta.json`);
  } catch {
    return network();
  }
  let meta: unknown;
  try {
    meta = JSON.parse(metaText);
  } catch {
    // Usually a Wi-Fi sign-in page answering in place of the site.
    return network();
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return done('failed-invalid');
  const { schemaVersion, sha256: hash, version } = meta as Record<string, unknown>;
  if (typeof hash !== 'string' || typeof schemaVersion !== 'number') return done('failed-invalid');
  if (schemaVersion !== 1) return done('failed-unsupported');

  const cached = await readCache(db);
  // The app ships a published release; no need to download it again.
  if (version === bundledVersion && (!cached || compareVersions(cached.bundle.version, bundledVersion) <= 0)) {
    return done('up-to-date');
  }
  if (cached && cached.sha256 === hash && (await deps.sha256(cached.text)) === hash) return done('up-to-date');

  let text: string;
  try {
    text = await deps.fetchText(`${baseUrl}rules.json`);
  } catch {
    return network();
  }
  if ((await deps.sha256(text)) !== hash) return done('failed-mismatch', now - CHECK_INTERVAL_MS + MISMATCH_RETRY_MS);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return done('failed-invalid');
  }
  if (validateBundle(data).length) return done('failed-unsupported');

  await setKv(db, K_CACHE, JSON.stringify({ sha256: hash, text }));
  return done('updated');
}
