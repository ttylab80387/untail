import { processUrl } from '@linkclean/core';
import { loadRules, nodeFetch } from './node';

async function main() {
  const input = process.argv.slice(2).join(' ').trim();
  if (!input) {
    console.error('usage: pnpm clean-url "<text or URL>"');
    process.exit(2);
  }
  const result = await processUrl(input, await loadRules(), {
    expand: true,
    locale: process.env.LINKCLEAN_LOCALE ?? 'zh-TW',
    fetch: nodeFetch,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
