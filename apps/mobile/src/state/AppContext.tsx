import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { useLocales } from 'expo-localization';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';
import { resolveLocale } from '@linkclean/core';
import type { Locale, RuleBundle } from '@linkclean/core';
import bundledJson from '../../assets/rules.json';
import { SITE_BASE_URL, USER_AGENT } from '../config';
import i18n from '../i18n';
import { cleanInput } from '../lib/cleaner';
import type { CleanOutcome } from '../lib/cleaner';
import type { Db } from '../lib/db';
import { loadRules, updateRules } from '../lib/rulesStore';
import type { UpdateOutcome } from '../lib/rulesStore';
import { rnFetch } from '../lib/rnFetch';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/settings';
import type { Settings } from '../lib/settings';

const BUNDLED = bundledJson as unknown as RuleBundle;

export interface AppState {
  ready: boolean;
  db: Db;
  rules: RuleBundle;
  settings: Settings;
  locale: Locale;
  input: string;
  setInput(text: string): void;
  outcome: CleanOutcome | null;
  busy: boolean;
  submit(text: string): Promise<void>;
  setSettings(s: Settings): Promise<void>;
  refreshRules(): Promise<UpdateOutcome>;
}

const Ctx = createContext<AppState | null>(null);

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sha256 = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);

export function AppProvider({ children }: { children: ReactNode }) {
  // expo-sqlite's SQLiteDatabase implements the Db subset used by src/lib.
  const db = useSQLiteContext() as unknown as Db;
  const locale = resolveLocale(useLocales()[0]?.languageTag ?? 'en');
  const [ready, setReady] = useState(false);
  const [rules, setRules] = useState<RuleBundle>(BUNDLED);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [input, setInput] = useState('');
  const [outcome, setOutcome] = useState<CleanOutcome | null>(null);
  const [pending, setPending] = useState(0);

  // Queued work reads these at run time, so it never uses stale rules, settings or locale.
  const latest = useRef({ rules, settings, locale });
  latest.current = { rules, settings, locale };
  const queue = useRef<Promise<void>>(Promise.resolve());
  const refreshing = useRef<Promise<UpdateOutcome> | null>(null);

  useEffect(() => {
    void i18n.changeLanguage(locale);
  }, [locale]);

  const refresh = useCallback(
    (force: boolean): Promise<UpdateOutcome> => {
      // One update at a time: startup, foreground and manual checks can overlap.
      if (!refreshing.current) {
        refreshing.current = (async () => {
          try {
            const result = await updateRules({ db, baseUrl: SITE_BASE_URL, fetchText, sha256, now: Date.now() }, { force });
            if (result === 'updated') setRules(await loadRules(db, BUNDLED));
            return result;
          } finally {
            refreshing.current = null;
          }
        })();
      }
      return refreshing.current;
    },
    [db],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      let s = DEFAULT_SETTINGS;
      let r = BUNDLED;
      try {
        [s, r] = await Promise.all([loadSettings(db), loadRules(db, BUNDLED)]);
      } catch {
        // Unreadable storage: keep defaults rather than blocking the app.
      }
      if (!alive) return;
      setSettingsState(s);
      setRules(r);
      setReady(true);
      void refresh(false);
    })();
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(false);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [db, refresh]);

  const submit = useCallback(
    (text: string): Promise<void> => {
      setInput(text);
      setPending((n) => n + 1);
      const job = queue.current.then(async () => {
        try {
          const { rules: r, settings: s, locale: l } = latest.current;
          setOutcome(
            await cleanInput(text, {
              db,
              rules: r,
              settings: s,
              locale: l,
              fetch: rnFetch,
              userAgent: USER_AGENT,
              copy: Clipboard.setStringAsync,
              now: Date.now,
            }),
          );
        } catch {
          // cleanInput handles expected failures itself; never let one job stall the queue.
        } finally {
          setPending((n) => n - 1);
        }
      });
      queue.current = job;
      return job;
    },
    [db],
  );

  const value = useMemo<AppState>(
    () => ({
      ready,
      db,
      rules,
      settings,
      locale,
      input,
      setInput,
      outcome,
      busy: pending > 0,
      submit,
      async setSettings(s) {
        setSettingsState(s);
        await saveSettings(db, s);
      },
      refreshRules: () => refresh(true),
    }),
    [ready, db, rules, settings, locale, input, outcome, pending, submit, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
