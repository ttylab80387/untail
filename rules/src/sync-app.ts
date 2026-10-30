// Copies the published rules release into the app as its built-in snapshot, byte for byte, so the
// app's built-in version is a real release and can be compared with downloaded copies.
// Release order: push rule changes to main -> wait for the Pages deploy -> `pnpm mobile sync-rules`
// -> commit apps/mobile/assets/rules.json -> build the app.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fetchPublished } from './published';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SITE = 'https://ttylab80387.github.io/untail/';

export async function syncApp(baseUrl: string, outFile: string, fetchText: (url: string) => Promise<string>): Promise<string> {
  const { rulesText, bundle } = await fetchPublished(baseUrl, fetchText);
  await writeFile(outFile, rulesText);
  return bundle.version;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: SITE },
      out: { type: 'string', default: here('../../apps/mobile/assets/rules.json') },
    },
  });
  const version = await syncApp(values.base!, values.out!, fetchText);
  console.log(`bundled published rules ${version} into ${values.out}`);
}

// Run only as a script, so tests can import syncApp.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
