import { processUrl } from '@linkclean/core';
import type { FetchFn, ProcessResult, RuleBundle } from '@linkclean/core';
import { addHistory } from './db';
import type { Db } from './db';
import type { Settings } from './settings';

export interface CleanDeps {
  db: Db;
  rules: RuleBundle;
  settings: Settings;
  locale: string;
  fetch: FetchFn;
  userAgent: string;
  copy(text: string): Promise<unknown>;
  now(): number;
  // False once newer clipboard content arrived; the clean link must then not replace it.
  isCurrent?(): boolean;
  // Extra conditions from the caller, e.g. the tile copies and records only a link that changed,
  // and only while its request is still valid.
  copyIf?(result: ProcessResult): boolean;
  recordIf?(result: ProcessResult): boolean;
}

export interface CleanOutcome {
  result: ProcessResult;
  copied: boolean;
}

export async function cleanInput(input: string, deps: CleanDeps): Promise<CleanOutcome> {
  const result = await processUrl(input, deps.rules, {
    expand: deps.settings.expand,
    locale: deps.locale,
    fetch: deps.fetch,
    userAgent: deps.userAgent,
  });
  if (result.status === 'failed') return { result, copied: false };

  // Side effects are best-effort: a storage or clipboard failure must never hide the cleaned result.
  if (deps.settings.history && (deps.recordIf?.(result) ?? true)) {
    try {
      await addHistory(deps.db, result, deps.now());
    } catch {
      // history is optional
    }
  }
  let copied = false;
  // Only a fully clean URL is copied automatically (spec §6.3).
  if (
    result.status === 'clean' &&
    deps.settings.autoCopy &&
    (deps.isCurrent?.() ?? true) &&
    (deps.copyIf?.(result) ?? true)
  ) {
    try {
      await deps.copy(result.cleanUrl);
      copied = true;
    } catch {
      copied = false;
    }
  }
  return { result, copied };
}
