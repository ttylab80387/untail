import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateBundle } from '@linkclean/core';
import type { Provider } from '@linkclean/core';
import { buildBundle, makeVersion, missingTranslations, sha256, validateOwnData } from './bundle';
import type { OwnData } from './bundle';

export const CLEARURLS_URL = 'https://gitlab.com/ClearURLs/rules/-/raw/master/data.min.json';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;

async function loadClearUrls(file: string | undefined): Promise<{ providers: Record<string, Provider> }> {
  let data: unknown;
  if (file) {
    data = await readJson(file);
  } else {
    const res = await fetch(CLEARURLS_URL);
    if (!res.ok) throw new Error(`ClearURLs download failed: HTTP ${res.status}`);
    data = await res.json();
  }
  const providers = (data as { providers?: unknown }).providers;
  if (!providers || typeof providers !== 'object') throw new Error('ClearURLs payload has no providers object');
  return { providers: providers as Record<string, Provider> };
}

async function main() {
  const { values } = parseArgs({
    options: { clearurls: { type: 'string' }, out: { type: 'string', default: here('../dist') } },
  });
  const outDir = values.out!;

  const own: OwnData = {
    overrides: await readJson(here('../overrides.json')),
    expanders: await readJson(here('../expanders.json')),
    knowledge: await readJson(here('../knowledge.json')),
  };
  const errors = validateOwnData(own);
  if (errors.length) throw new Error(`invalid rule data:\n${errors.join('\n')}`);

  const now = new Date();
  const bundle = buildBundle({ ...own, clearurls: await loadClearUrls(values.clearurls), version: makeVersion(now) });
  const bundleErrors = validateBundle(bundle);
  if (bundleErrors.length) throw new Error(`built bundle is invalid:\n${bundleErrors.join('\n')}`);
  const json = JSON.stringify(bundle);
  const meta = { schemaVersion: bundle.schemaVersion, version: bundle.version, sha256: sha256(json), generatedAt: now.toISOString() };

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'rules.json'), json);
  await writeFile(join(outDir, 'rules.meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  for (const w of missingTranslations(own.knowledge)) {
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${w}` : `warning: ${w}`);
  }
  console.log(`built rules ${bundle.version}: ${Object.keys(bundle.providers).length} providers, sha256 ${meta.sha256}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
