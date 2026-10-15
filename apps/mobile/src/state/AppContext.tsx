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
import { clipboardStateAsync } from '../../modules/untail-clipboard';
import { SITE_BASE_URL, USER_AGENT } from '../config';
import i18n from '../i18n';
import { cleanInput } from '../lib/cleaner';
import type { CleanOutcome } from '../lib/cleaner';
import { decideIos, decideText, initialWatchState, noteSelfWrite, undoTarget } from '../lib/clipboardWatch';
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
  // Set after an automatic clean replaced the clipboard; undo restores the original text.
  autoCleaned: { undo: string } | null;
  cleanClipboardLink: string | null; // the newest clipboard link, when it had nothing to clean
  undoAutoClean(): void;
  dismissAutoClean(): void;
  dismissCleanLinkNotice(): void;
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
  const [autoCleaned, setAutoCleaned] = useState<{ undo: string } | null>(null);
  const [cleanClipboardLink, setCleanClipboardLink] = useState<string | null>(null);
  const watch = useRef(initialWatchState());
  // Bumped when the app goes to the background (another app may change the clipboard) and when
  // the user copies something; a job started before that must not write the clipboard.
  const clipboardGen = useRef(0);
  const pendingJobs = useRef(0);

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
  const writeClipboard = useCallback(async (text: string) => {
    watch.current = noteSelfWrite(watch.current, text);
    setCleanClipboardLink(null);
    // Any later write makes an earlier Undo restore over the wrong content.
    setAutoCleaned(null);
    await Clipboard.setStringAsync(text);
    if (Platform.OS === 'ios') {
      // Remember the count after our own write, so coming back does not read (and prompt) again.
      const state = await clipboardStateAsync();
      watch.current = noteSelfWrite(watch.current, text, state?.changeCount ?? null);
    }
  }, []);

  // A copy the user asked for: pending jobs must not overwrite it.
  const copy = useCallback(
    async (text: string) => {
      clipboardGen.current += 1;
      await writeClipboard(text);
      setOutcome((o) => (o && o.result.cleanUrl === text ? { ...o, copied: true } : o));
    },
    [writeClipboard],
  );

  // Jobs run one at a time. An automatic job (from the clipboard) always copies its clean link,
  // but is dropped once it is stale; a job the user asked for always shows its result.
  // `settings` lets a caller pass settings it just loaded, before React has applied them.
  const enqueue = useCallback(
    (text: string, auto: boolean, settings?: Settings): Promise<CleanOutcome | null> => {
      setInput(text);
      setCleanClipboardLink(null);
      setAutoCleaned(null);
      pendingJobs.current += 1;
      setPending((n) => n + 1);
      const gen = clipboardGen.current;
      const isCurrent = () => gen === clipboardGen.current;
      const job = queue.current.then(async () => {
        try {
          const { rules: r, locale: l } = latest.current;
          const s = settings ?? latest.current.settings;
          const out = await cleanInput(text, {
            db,
            rules: r,
            settings: auto ? { ...s, autoCopy: true } : s,
            locale: l,
            fetch: rnFetch,
            userAgent: USER_AGENT,
            copy: writeClipboard,
            now: Date.now,
            isCurrent,
          });
          if (!isCurrent()) {
            if (auto) return null;
            // The screen may show newer clipboard content by now; put the requested link back.
            setInput(text);
          }
          setOutcome(out);
          return out;
        } catch {
          // cleanInput handles expected failures itself; never let one job stall the queue.
          return null;
        } finally {
          pendingJobs.current -= 1;
          setPending((n) => n - 1);
        }
      });
      queue.current = job.then(() => undefined);
      return job;
    },
    [db, writeClipboard],
  );

  const submit = useCallback((text: string) => enqueue(text, false).then(() => undefined), [enqueue]);

  const checkClipboard = useCallback(
    async (s: Settings) => {
      if (!s.detectClipboard) return;
      try {
        let raw: string;
        if (Platform.OS === 'ios') {
          // clipboardStateAsync does not trigger the iOS paste prompt; reading the text would.
          const state = await clipboardStateAsync();
          if (!state) return;
          const d = decideIos(state, watch.current);
          watch.current = d.next;
          // Unchanged clipboard (including the app's own copy): keep the screen as it is, never read.
          if (!d.fresh) return;
          setAutoCleaned(null);
          setCleanClipboardLink(null);
          if (!d.offer || !s.autoClipboard) {
            setClipboardOffer(d.offer ? { kind: 'ios' } : null);
            return;
          }
          // Automatic mode reads anyway; iOS asks unless "Paste from Other Apps" is set to Allow.
          raw = await Clipboard.getStringAsync();
        } else {
          raw = await Clipboard.getStringAsync();
        }
        const d = decideText(raw, watch.current, latest.current.rules);
        watch.current = d.next;
        // New clipboard content makes an earlier "replaced" notice misleading.
        if (d.fresh) {
          setAutoCleaned(null);
          // Show the clean link itself, so the notice is not read as being about the previous result,
          // unless a link the user asked about (typed or shared) is still being worked on.
          const clean = pendingJobs.current === 0 ? d.clean : null;
          setCleanClipboardLink(clean);
          if (clean !== null) {
            setInput(clean);
            setOutcome(null);
          }
        }
        if (!d.url || !s.autoClipboard) {
          setClipboardOffer(d.url ? { kind: 'android', url: d.url } : null);
          return;
        }
        setClipboardOffer(null);
        const out = await enqueue(d.url, true, s);
        const undo = out ? undoTarget(raw, out) : null;
        setAutoCleaned(undo === null ? null : { undo });
      } catch {
        // Clipboard access is best-effort.
      }
    },
    [enqueue],
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
      void checkClipboard(s);
    })();
    const sub = RNAppState.addEventListener('change', (state) => {
      // Another app may change the clipboard while we are away.
      if (state === 'background') clipboardGen.current += 1;
      if (state !== 'active') return;
      void refresh(false);
      void checkClipboard(latest.current.settings);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [db, refresh, checkClipboard]);

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
      autoCleaned,
      cleanClipboardLink,
      undoAutoClean() {
        const undo = autoCleaned?.undo;
        setAutoCleaned(null);
        // The clipboard no longer holds the clean link, so the result card must not say it does.
        setOutcome((o) => (o ? { ...o, copied: false } : o));
        // Through copy(), so the restored text is not cleaned again on the next foreground.
        if (undo !== undefined) void copy(undo).catch(() => undefined);
      },
      dismissAutoClean: () => setAutoCleaned(null),
      dismissCleanLinkNotice: () => setCleanClipboardLink(null),
    }),
    [ready, db, rules, settings, locale, input, outcome, pending, submit, refresh, copy, clipboardOffer, autoCleaned, cleanClipboardLink],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
