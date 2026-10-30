// GitHub Pages' CDN caches each file for 10 minutes and ignores query strings, so right after a
// deploy it may still serve the previous release. Wait this long after the last deploy before
// trusting what the site returns (deploy time + 10 min cache + slack for the deploy itself).
export const CDN_SETTLE_MS = 15 * 60 * 1000;
export const REPO = 'ttylab80387/untail';

export function settleWaitMs(lastDeploy: number | null, now: number): number {
  return lastDeploy === null ? 0 : Math.max(0, lastDeploy + CDN_SETTLE_MS - now);
}

// Time of the latest github-pages deployment, or null when it cannot be read.
export async function lastPagesDeploy(fetchText: (url: string) => Promise<string>): Promise<number | null> {
  try {
    const list = JSON.parse(
      await fetchText(`https://api.github.com/repos/${REPO}/deployments?environment=github-pages&per_page=1`),
    ) as unknown;
    if (!Array.isArray(list) || !list.length) return null;
    const at = Date.parse(String((list[0] as { created_at?: unknown }).created_at));
    return Number.isNaN(at) ? null : at;
  } catch {
    return null;
  }
}
