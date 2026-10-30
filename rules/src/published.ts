import { validateBundle } from '@linkclean/core';
import type { RuleBundle } from '@linkclean/core';
import { sha256 } from './bundle';

export interface Published {
  rulesText: string;
  metaText: string;
  bundle: RuleBundle;
}

// Downloads the published rules and checks them the way the app does; throws if anything is off.
export async function fetchPublished(baseUrl: string, fetchText: (url: string) => Promise<string>): Promise<Published> {
  const metaText = await fetchText(`${baseUrl}rules.meta.json`);
  const meta = JSON.parse(metaText) as unknown;
  if (!meta || typeof meta !== 'object') throw new Error('rules.meta.json is not an object');
  const { schemaVersion, sha256: hash } = meta as Record<string, unknown>;
  if (schemaVersion !== 1 || typeof hash !== 'string') throw new Error('rules.meta.json has an unsupported schema');

  const rulesText = await fetchText(`${baseUrl}rules.json`);
  if (sha256(rulesText) !== hash) throw new Error('rules.json does not match the sha256 in rules.meta.json');
  const bundle = JSON.parse(rulesText) as unknown;
  const errors = validateBundle(bundle);
  if (errors.length) throw new Error(`published bundle is invalid:\n${errors.join('\n')}`);
  return { rulesText, metaText, bundle: bundle as RuleBundle };
}

// Same rules apart from the version stamp. Both sides come from JSON.stringify of buildBundle output, so key order matches.
export function sameContent(a: RuleBundle, b: RuleBundle): boolean {
  const strip = ({ version: _v, ...rest }: RuleBundle) => JSON.stringify(rest);
  return strip(a) === strip(b);
}
