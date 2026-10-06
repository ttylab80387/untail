import type { Provider, RemovedItem } from './types';
import { compile } from './regex';
import { splitUrl, joinUrl, getHost } from './query';
import { activeProviders } from './providers';

export { activeProviders };

export interface CleanResult {
  url: string;
  removed: RemovedItem[];
}

export function cleanUrl(url: string, providers: Record<string, Provider>): CleanResult {
  const active = activeProviders(url, providers);
  const host = getHost(url);
  const removed: RemovedItem[] = [];

  let out = url;
  for (const p of active) {
    for (const r of p.rawRules ?? []) {
      const re = compile(r, 'gi');
      if (!re) continue;
      for (const hit of out.match(re) ?? []) {
        if (hit) removed.push({ key: 'raw', value: hit, host });
      }
      out = out.replace(re, '');
    }
  }

  const keyRes = active
    .flatMap((p) => [...(p.rules ?? []), ...(p.referralMarketing ?? [])])
    .map((r) => compile(`^(?:${r})$`))
    .filter((re): re is RegExp => re !== null);

  const parts = splitUrl(out);
  const kept = parts.pairs.filter((pair) => {
    if (pair.raw === '') return true;
    const hit = keyRes.some((re) => re.test(pair.key));
    if (hit) removed.push({ key: pair.key, value: pair.value, host });
    return !hit;
  });

  // Nothing removed: hand back the exact input so signed or unusual URLs stay intact.
  if (removed.length === 0) return { url, removed };
  // Only tidy empty components when the query itself was edited.
  const queryChanged = kept.length !== parts.pairs.length;
  return { url: joinUrl({ ...parts, pairs: queryChanged ? kept.filter((pair) => pair.raw !== '') : kept }), removed };
}
