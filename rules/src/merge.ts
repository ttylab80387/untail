import type { Provider } from '@linkclean/core';

export const ARRAY_FIELDS = ['rules', 'rawRules', 'referralMarketing', 'exceptions', 'redirections'] as const;

export function mergeProviders(
  base: Record<string, Provider>,
  overrides: Record<string, Partial<Provider>>,
): Record<string, Provider> {
  const out: Record<string, Provider> = structuredClone(base);
  for (const [name, o] of Object.entries(overrides)) {
    const b = out[name];
    if (!b) {
      if (!o.urlPattern) throw new Error(`override provider "${name}" is new and needs a urlPattern`);
      out[name] = structuredClone(o) as Provider;
      continue;
    }
    const merged: Provider = { ...b, ...structuredClone(o) };
    for (const f of ARRAY_FIELDS) {
      if (b[f] || o[f]) merged[f] = [...(b[f] ?? []), ...(o[f] ?? [])];
    }
    out[name] = merged;
  }
  return out;
}
