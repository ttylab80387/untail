// Keeps the published version and hash when a fresh build has the same rules, so the
// site's rules.json and rules.meta.json only change when the rules do (avoids CDN
// caches serving a new meta with an old rules.json). Never fails because of the live site.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { RuleBundle } from '@linkclean/core';
import { cdnWaitMs } from './pages';
import { fetchPublished, sameContent } from './published';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export async function reuseDist(
  dist: string,
  baseUrl: string,
  fetchText: (url: string) => Promise<string>,
): Promise<'reused' | 'new'> {
  const built = JSON.parse(await readFile(join(dist, 'rules.json'), 'utf8')) as RuleBundle;
  let live;
  try {
    live = await fetchPublished(baseUrl, fetchText);
  } catch (e) {
    console.log(`publishing new rules ${built.version} (published rules unavailable: ${e instanceof Error ? e.message : e})`);
    return 'new';
  }
  if (!sameContent(built, live.bundle)) {
    console.log(`publishing new rules ${built.version} (content changed since ${live.bundle.version})`);
    return 'new';
  }
  await writeFile(join(dist, 'rules.json'), live.rulesText);
  await writeFile(join(dist, 'rules.meta.json'), live.metaText);
  console.log(`reused published rules ${live.bundle.version}`);
  return 'reused';
}

async function fetchText(url: string): Promise<string> {
  const headers: Record<string, string> = {};
  // Only the GitHub API call needs it; avoids the shared unauthenticated rate limit on CI runners.
  if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, dist: { type: 'string', default: here('../dist') } } });
  if (!values.base) throw new Error('--base <published site URL> is required');
  // Comparing against a stale CDN copy could skip a reuse or bring back an older version.
  const wait = await cdnWaitMs(fetchText, Date.now);
  if (wait > 0) {
    console.log(`waiting ${Math.ceil(wait / 1000)} s for the CDN to drop the previous deploy`);
    await new Promise((r) => setTimeout(r, wait));
  }
  await reuseDist(values.dist!, values.base, fetchText);
}

// Run only as a script, so tests can import reuseDist.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
