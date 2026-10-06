import type { Provider } from './types';
import { matches } from './regex';

export function activeProviders(url: string, providers: Record<string, Provider>): Provider[] {
  return Object.values(providers).filter(
    (p) => matches(p.urlPattern, url) && !(p.exceptions ?? []).some((e) => matches(e, url)),
  );
}
