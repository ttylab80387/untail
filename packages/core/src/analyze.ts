import type { AnalyzedParam, KnowledgeEntry, Locale, RemovedItem, Risk } from './types';

const RISK_ORDER: Record<Risk, number> = { high: 0, medium: 1, low: 2 };

export function resolveLocale(tag: string): Locale {
  const t = tag.toLowerCase();
  if (t.startsWith('zh')) return 'zh-TW';
  if (t.startsWith('ja')) return 'ja';
  return 'en';
}

// Keys come from URLs; only own properties count ("constructor", "__proto__" must not hit Object.prototype).
function own(kb: Record<string, KnowledgeEntry>, k: string): KnowledgeEntry | undefined {
  return Object.prototype.hasOwnProperty.call(kb, k) ? kb[k] : undefined;
}

// Hidden characters are found by the app, not by rules, so their explanations ship with the app.
// (Publishing them in rules.json would make older apps, which do not know the category, reject it.)
const BUILTIN: Record<string, KnowledgeEntry> = {
  hidden: {
    category: 'hidden',
    risk: 'medium',
    desc: {
      'zh-TW': '看不見的字元。可能讓連結打不開、被用來辨識是誰複製的，或用來偽裝網址。',
      en: 'An invisible character. It can break the link, identify who copied it, or disguise the address.',
      ja: '目に見えない文字です。リンクが開けなくなったり、コピーした人の特定や、アドレスの偽装に使われたりすることがあります。',
    },
  },
  'hidden-bidi': {
    category: 'hidden',
    risk: 'high',
    desc: {
      'zh-TW': '改變文字顯示方向的隱藏字元，常被用來讓網址看起來像另一個網址。',
      en: 'An invisible character that changes text direction, often used to make an address look like a different one.',
      ja: '文字の表示方向を変える隠し文字です。アドレスを別のものに見せかけるためによく使われます。',
    },
  },
};

export function lookupKnowledge(item: RemovedItem, kb: Record<string, KnowledgeEntry>): KnowledgeEntry | undefined {
  const key = item.key.toLowerCase();
  const labels = item.host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const hit = own(kb, `${labels.slice(i).join('.')}:${key}`);
    if (hit) return hit;
  }
  const exact = own(kb, key) ?? own(BUILTIN, key);
  if (exact) return exact;

  let best: { len: number; entry: KnowledgeEntry } | undefined;
  for (const [k, entry] of Object.entries(kb)) {
    if (!k.endsWith('*') || k.includes(':')) continue;
    const prefix = k.slice(0, -1);
    if (key.startsWith(prefix) && (!best || prefix.length > best.len)) best = { len: prefix.length, entry };
  }
  return best?.entry;
}

export function analyze(removed: RemovedItem[], kb: Record<string, KnowledgeEntry>, localeTag: string): AnalyzedParam[] {
  const locale = resolveLocale(localeTag);
  const out = removed.map((item): AnalyzedParam => {
    const e = lookupKnowledge(item, kb);
    if (!e) return { key: item.key, value: item.value, category: 'unknown', risk: 'low' };
    const result: AnalyzedParam = { key: item.key, value: item.value, category: e.category, risk: e.risk };
    if (e.owner) result.owner = e.owner;
    const desc = e.desc[locale] ?? e.desc.en;
    if (desc) result.desc = desc;
    return result;
  });
  // Array.prototype.sort is stable (ES2019+), so order within a level is kept.
  return out.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
}
