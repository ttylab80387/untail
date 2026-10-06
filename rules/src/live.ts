import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { processUrl } from '@linkclean/core';
import { loadRules, nodeFetch } from './node';

interface LiveCase {
  input: string;
  expectedCleanUrl: string;
}

async function main() {
  const path = fileURLToPath(new URL('../regression.json', import.meta.url));
  const cases = JSON.parse(await readFile(path, 'utf8')) as LiveCase[];
  if (cases.length === 0) {
    const msg = 'regression.json is empty: live monitoring is not checking any platform';
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `warning: ${msg}`);
    return;
  }
  const rules = await loadRules();
  let failed = 0;
  for (const c of cases) {
    const r = await processUrl(c.input, rules, { expand: true, locale: 'en', fetch: nodeFetch });
    const ok = r.status === 'clean' && r.cleanUrl === c.expectedCleanUrl;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.input}\n  got: ${r.status}${r.reason ? `/${r.reason}` : ''} ${r.cleanUrl}\n  hops: ${r.hops.join(' -> ')}`);
  }
  if (failed) {
    console.error(`${failed}/${cases.length} live cases failed: a platform may have changed its redirect behaviour`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
