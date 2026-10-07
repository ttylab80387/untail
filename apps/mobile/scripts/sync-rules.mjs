// Copies the built rule bundle into the app as the offline fallback snapshot.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../../rules/dist/rules.json', import.meta.url));
const destDir = fileURLToPath(new URL('../assets/', import.meta.url));
if (!existsSync(src)) {
  console.error('rules/dist/rules.json missing: run `pnpm build:rules` first');
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, `${destDir}rules.json`);
console.log(`bundled rules updated from ${src}`);
