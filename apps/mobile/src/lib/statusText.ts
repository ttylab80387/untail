import type { TFunction } from 'i18next';
import type { ProcessResult } from '@linkclean/core';

// The headline states what was done, never that a link is "clean" or safe, and never calls a removed
// hidden character a tracking code.
export function statusText(t: TFunction, result: ProcessResult): string {
  if (result.status !== 'clean') return t(`result.status.${result.status}`);
  const trackers = result.removed.filter((p) => p.category !== 'hidden').length;
  const hidden = result.removed.length - trackers;
  if (!trackers) return hidden ? t('result.status.hiddenRemoved') : t('result.status.none');
  const text = t('result.status.removed', { count: trackers });
  return hidden ? `${text} · ${t('result.status.hiddenRemoved')}` : text;
}
