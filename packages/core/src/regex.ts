const cache = new Map<string, RegExp | null>();

// Rules come from remote data; a bad pattern must never crash the app.
export function compile(src: string, flags = 'i'): RegExp | null {
  const key = `${flags}\u0000${src}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let re: RegExp | null;
  try {
    re = new RegExp(src, flags);
  } catch {
    re = null;
  }
  cache.set(key, re);
  return re;
}

export function matches(src: string, s: string): boolean {
  return compile(src)?.test(s) ?? false;
}
