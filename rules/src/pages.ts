// GitHub Pages' CDN caches each file for 10 minutes and ignores query strings, so right after a
// deploy it may still serve the previous release. Wait this long after the last deploy before
// trusting what the site returns (deploy time + 10 min cache + slack for the deploy itself).
export const CDN_SETTLE_MS = 15 * 60 * 1000;
export const REPO = 'ttylab80387/untail';

export function settleWaitMs(lastDeploy: number | null, now: number): number {
  return lastDeploy === null ? 0 : Math.max(0, lastDeploy + CDN_SETTLE_MS - now);
}

// When the latest github-pages deployment finished (updated_at = its last status, normally success),
// or null when there has never been one. Throws when the lookup fails.
export async function lastPagesDeploy(fetchText: (url: string) => Promise<string>): Promise<number | null> {
  const list = JSON.parse(
    await fetchText(`https://api.github.com/repos/${REPO}/deployments?environment=github-pages&per_page=1`),
  ) as unknown;
  if (!Array.isArray(list)) throw new Error('unexpected deployments response');
  if (!list.length) return null;
  const d = list[0] as { created_at?: unknown; updated_at?: unknown };
  const at = Date.parse(String(d.updated_at ?? d.created_at));
  if (Number.isNaN(at)) throw new Error('deployment has no timestamp');
  return at;
}

// How long to wait before trusting the site. A lookup that keeps failing waits the full window.
export async function cdnWaitMs(
  fetchText: (url: string) => Promise<string>,
  now: () => number,
  delay: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      return settleWaitMs(await lastPagesDeploy(fetchText), now());
    } catch (e) {
      if (attempt >= 3) {
        console.warn(`warning: could not read the last Pages deploy (${e instanceof Error ? e.message : e}); waiting the full ${CDN_SETTLE_MS / 60000} minutes`);
        return CDN_SETTLE_MS;
      }
      await delay(5000);
    }
  }
}
