import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { useLocales } from 'expo-localization';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState as RNAppState, Platform } from 'react-native';
import { resolveLocale } from '@linkclean/core';
import type { Locale, RuleBundle } from '@linkclean/core';
import bundledJson from '../../assets/rules.json';
import { SITE_BASE_URL, USER_AGENT } from '../config';
import i18n from '../i18n';
import { cleanInput } from '../lib/cleaner';
import type { CleanOutcome } from '../lib/cleaner';
import { decideAndroid, decideIos, initialWatchState, noteSelfWrite } from '../lib/clipboardWatch';
import type { Db } from '../lib/db';
import { loadRules, updateRules } from '../lib/rulesStore';
import type { UpdateOutcome } from '../lib/rulesStore';
import { rnFetch } from '../lib/rnFetch';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/settings';
import type { Settings } from '../lib/settings';

const BUNDLED = bundledJson as unknown as RuleBundle;

// iOS can only tell that a URL is present; Android hands us the URL itself.
export type ClipboardOffer = { kind: 'ios' } | { kind: 'android'; url: string };

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
  copy(text: string): Promise<void>;
  clipboardOffer: ClipboardOffer | null;
  acceptClipboardOffer(text?: string): void;
  dismissClipboardOffer(): void;
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
  const [clipboardOffer, setClipboardOffer] = useState<ClipboardOffer | null>(null);
  const watch = useRef(initialWatchState());

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

  // Every clipboard write by the app goes through here, so its own links are not offered back.
  const copy = useCallback(async (text: string) => {
    watch.current = noteSelfWrite(watch.current, text);
    await Clipboard.setStringAsync(text);
  }, []);

  const checkClipboard = useCallback(async (s: Settings) => {
    if (!s.detectClipboard) return;
    try {
      if (Platform.OS === 'ios') {
        // hasUrlAsync does not trigger the iOS paste prompt; reading the text would.
        const d = decideIos(await Clipboard.hasUrlAsync(), watch.current);
        watch.current = d.next;
        setClipboardOffer(d.offer ? { kind: 'ios' } : null);
      } else {
        const d = decideAndroid(await Clipboard.getStringAsync(), watch.current, latest.current.rules);
        watch.current = d.next;
        setClipboardOffer(d.url ? { kind: 'android', url: d.url } : null);
      }
    } catch {
      // Clipboard access is best-effort.
    }
  }, []);

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
      void checkClipboard(s);
    })();
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refresh(false);
      void checkClipboard(latest.current.settings);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [db, refresh, checkClipboard]);

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
              copy,
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
    [db, copy],
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
      copy,
      clipboardOffer,
      acceptClipboardOffer(text) {
        const offered = clipboardOffer;
        setClipboardOffer(null);
        const target = offered?.kind === 'android' ? offered.url : text;
        if (target) void submit(target);
      },
      dismissClipboardOffer: () => setClipboardOffer(null),
    }),
    [ready, db, rules, settings, locale, input, outcome, pending, submit, refresh, copy, clipboardOffer],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
