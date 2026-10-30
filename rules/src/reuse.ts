// Keeps the published version and hash when a fresh build has the same rules, so the
// site's rules.json and rules.meta.json only change when the rules do (avoids CDN
// caches serving a new meta with an old rules.json). Never fails because of the live site.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { RuleBundle } from '@linkclean/core';
import { fetchPublished, sameContent } from './published';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, dist: { type: 'string', default: here('../dist') } } });
  if (!values.base) throw new Error('--base <published site URL> is required');
  const dist = values.dist!;
  const built = JSON.parse(await readFile(join(dist, 'rules.json'), 'utf8')) as RuleBundle;

  let live;
  try {
    live = await fetchPublished(values.base, fetchText);
  } catch (e) {
    console.log(`publishing new rules ${built.version} (published rules unavailable: ${e instanceof Error ? e.message : e})`);
    return;
  }
  if (!sameContent(built, live.bundle)) {
    console.log(`publishing new rules ${built.version} (content changed since ${live.bundle.version})`);
    return;
  }
  await writeFile(join(dist, 'rules.json'), live.rulesText);
  await writeFile(join(dist, 'rules.meta.json'), live.metaText);
  console.log(`reused published rules ${live.bundle.version}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
