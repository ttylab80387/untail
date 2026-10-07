import { validateBundle } from '@linkclean/core';
import type { RuleBundle } from '@linkclean/core';
import { getKv, setKv } from './db';
import type { Db } from './db';

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Bundle text and its hash live in one record so they can never diverge.
const K_CACHE = 'rules.cache';
const K_CHECKED = 'rules.checkedAt';

export interface UpdateDeps {
  db: Db;
  baseUrl: string; // "" disables remote updates
  fetchText(url: string): Promise<string>;
  sha256(text: string): Promise<string>;
  now: number;
}

export type UpdateOutcome = 'disabled' | 'throttled' | 'up-to-date' | 'updated' | 'failed';

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

export async function loadRules(db: Db, bundled: RuleBundle): Promise<RuleBundle> {
  try {
    return (await readCache(db))?.bundle ?? bundled;
  } catch {
    return bundled;
  }
}

export async function updateRules(deps: UpdateDeps, opts: { force?: boolean } = {}): Promise<UpdateOutcome> {
  const { db, baseUrl, now } = deps;
  if (!baseUrl) return 'disabled';
  try {
    const last = Number((await getKv(db, K_CHECKED)) ?? 0);
    if (!opts.force && now - last < CHECK_INTERVAL_MS) return 'throttled';

    const meta = JSON.parse(await deps.fetchText(`${baseUrl}rules.meta.json`)) as Record<string, unknown>;
    if (meta.schemaVersion !== 1 || typeof meta.sha256 !== 'string') return 'failed';

    const cached = await readCache(db);
    if (cached && cached.sha256 === meta.sha256 && (await deps.sha256(cached.text)) === meta.sha256) {
      await setKv(db, K_CHECKED, String(now));
      return 'up-to-date';
    }

    const text = await deps.fetchText(`${baseUrl}rules.json`);
    if ((await deps.sha256(text)) !== meta.sha256) return 'failed';
    if (validateBundle(JSON.parse(text)).length) return 'failed';

    await setKv(db, K_CACHE, JSON.stringify({ sha256: meta.sha256, text }));
    await setKv(db, K_CHECKED, String(now));
    return 'updated';
  } catch {
    return 'failed';
  }
}
