import type { Provider } from './types';
import { matches } from './regex';
import { matchView } from './query';

export function activeProviders(url: string, providers: Record<string, Provider>): Provider[] {
  const view = matchView(url);
  return Object.values(providers).filter(
    (p) => matches(p.urlPattern, view) && !(p.exceptions ?? []).some((e) => matches(e, view)),
  );
}
