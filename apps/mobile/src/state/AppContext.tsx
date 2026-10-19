import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { useLocales } from 'expo-localization';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState as RNAppState, Platform, ToastAndroid } from 'react-native';
import { resolveLocale } from '@linkclean/core';
import type { Locale, RuleBundle } from '@linkclean/core';
import bundledJson from '../../assets/rules.json';
import { clipboardStateAsync } from '../../modules/untail-clipboard';
import {
  addTileLaunchListener,
  addUntailLeftListener,
  consumeTileLaunch,
  moveTaskToBack,
  waitForWindowFocus,
} from '../../modules/untail-tile';
import type { TileLaunch } from '../../modules/untail-tile';
import { SITE_BASE_URL, USER_AGENT } from '../config';
import i18n from '../i18n';
import { cleanInput } from '../lib/cleaner';
import type { CleanOutcome } from '../lib/cleaner';
import { decideIos, decideText, initialWatchState, noteSelfWrite, recheckAfterRules, undoTarget } from '../lib/clipboardWatch';
import type { Db } from '../lib/db';
import { loadRules, updateRules } from '../lib/rulesStore';
import type { UpdateOutcome } from '../lib/rulesStore';
import { rnFetch } from '../lib/rnFetch';
import { DEFAULT_SETTINGS, clearLastTileResult, loadLastTileResult, loadSettings, saveLastTileResult, saveSettings } from '../lib/settings';
import type { LastTileResult, Settings } from '../lib/settings';
import { createTileGate, runTile } from '../lib/tileFlow';
import type { CleanPolicy } from '../lib/tileFlow';
import type { TileToast } from '../lib/tileOutcome';

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
  tileNotice: 'no_link' | 'unreadable' | null;
  lastTile: LastTileResult | null;
  clearLastTile(): Promise<void>;
  tileRequests: number; // bumped when a tile request starts, so the layout returns to the home screen
  invalidateTile(): void;
}

const Ctx = createContext<AppState | null>(null);

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sha256 = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);

function tileToastText(t: TileToast): string {
  if (t.kind === 'copied') return i18n.t('tile.toastCopied', { count: t.removed });
  return i18n.t(t.kind === 'expanded' ? 'tile.toastExpanded' : 'tile.toastNoTracking');
}

export function AppProvider({ children }: { children: ReactNode }) {
  // expo-sqlite's SQLiteDatabase implements the Db subset used by src/lib.
  const db = useSQLiteContext() as unknown as Db;
  const locale = resolveLocale(useLocales()[0]?.languageTag ?? 'en');
  const [ready, setReady] = useState(false);
  const [rules, setRules] = useState<RuleBundle>(BUNDLED);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [input, setInputState] = useState('');
  const [outcome, setOutcome] = useState<CleanOutcome | null>(null);
  const [pending, setPending] = useState(0);
  const [clipboardOffer, setClipboardOffer] = useState<ClipboardOffer | null>(null);
  const [autoCleaned, setAutoCleaned] = useState<{ undo: string } | null>(null);
  const [cleanClipboardLink, setCleanClipboardLink] = useState<string | null>(null);
  const [tileNotice, setTileNotice] = useState<'no_link' | 'unreadable' | null>(null);
  const [lastTile, setLastTile] = useState<LastTileResult | null>(null);
  const [tileRequests, setTileRequests] = useState(0);
  const [tile] = useState(createTileGate);
  const readyRef = useRef(false);
  // Set when the tile event started a request; the 'active' change that follows the new intent
  // must not run the clipboard check.
  const skipNextActive = useRef(false);
  const invalidateTile = useCallback(() => {
    tile.cancel();
    setTileNotice(null);
  }, [tile]);
  const watch = useRef(initialWatchState());
  // Bumped when the app goes to the background (another app may change the clipboard) and when
  // the user copies something; a job started before that must not write the clipboard.
  const clipboardGen = useRef(0);
  const pendingJobs = useRef(0);
  // The last clipboard link judged clean, re-checked when new rules arrive.
  const lastCleanLink = useRef<string | null>(null);
  const recheckClipboard = useRef<() => void>(() => undefined);

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
            if (result === 'updated') {
              const next = await loadRules(db, BUNDLED);
              setRules(next);
              latest.current = { ...latest.current, rules: next };
              // A clipboard link the old rules called clean may have tracking the new ones know about.
              const before = watch.current;
              watch.current = recheckAfterRules(before, lastCleanLink.current, next);
              if (watch.current !== before && RNAppState.currentState === 'active') recheckClipboard.current();
            }
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
      tile.cancel();
      clipboardGen.current += 1;
      await writeClipboard(text);
      setOutcome((o) => (o && o.result.cleanUrl === text ? { ...o, copied: true } : o));
    },
    [writeClipboard, tile],
  );

  type Mode = 'manual' | 'auto' | 'tile';
  interface EnqueueOptions extends Partial<CleanPolicy> {
    settings?: Settings; // settings just loaded, before React has applied them
    isValid?: () => boolean; // tile: may still copy
    showsResult?: () => boolean; // tile: may still replace the home screen
  }
  // Jobs run one at a time. An automatic job (from the clipboard) always copies its clean link,
  // but is dropped once it is stale or a tile request owns the clipboard; a job the user asked for
  // always shows its result. A tile job copies like an automatic one and shows its result unless the
  // user has moved on to something else.
  const enqueue = useCallback(
    (text: string, mode: Mode, opts: EnqueueOptions = {}): Promise<CleanOutcome | null> => {
      setInputState(text);
      setCleanClipboardLink(null);
      setAutoCleaned(null);
      pendingJobs.current += 1;
      setPending((n) => n + 1);
      const gen = clipboardGen.current;
      // A tile job's validity is the gate's: 'background' (onPause) also fires for dialogs and some
      // notification shades, so it must not cancel a tile request.
      const isCurrent = () =>
        (mode === 'tile' || gen === clipboardGen.current) &&
        (opts.isValid?.() ?? true) &&
        (mode !== 'auto' || !tile.busy());
      const job = queue.current.then(async () => {
        try {
          const { rules: r, locale: l } = latest.current;
          const s = opts.settings ?? latest.current.settings;
          const out = await cleanInput(text, {
            db,
            rules: r,
            settings: mode === 'manual' ? s : { ...s, autoCopy: true },
            locale: l,
            fetch: rnFetch,
            userAgent: USER_AGENT,
            copy: writeClipboard,
            now: Date.now,
            isCurrent,
            copyIf: opts.copyIf,
            recordIf: opts.recordIf,
          });
          if (!isCurrent()) {
            if (mode === 'auto') return null;
            if (mode === 'tile' && !(opts.showsResult?.() ?? true)) return null;
            // The screen may show newer clipboard content by now; put the requested link back.
            if (mode === 'manual') setInputState(text);
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
    [db, writeClipboard, tile],
  );

  const submit = useCallback(
    (text: string) => {
      invalidateTile();
      return enqueue(text, 'manual').then(() => undefined);
    },
    [enqueue, invalidateTile],
  );

  const checkClipboard = useCallback(
    async (s: Settings) => {
      // A tile request owns the clipboard while it runs.
      if (tile.busy()) return;
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
          lastCleanLink.current = null;
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
        // A tile request may have started while this read was waiting.
        if (tile.busy()) return;
        const d = decideText(raw, watch.current, latest.current.rules);
        watch.current = d.next;
        // New clipboard content makes an earlier "replaced" notice misleading.
        if (d.fresh) {
          lastCleanLink.current = d.clean;
          setAutoCleaned(null);
          // Show the clean link itself, so the notice is not read as being about the previous result,
          // unless a link the user asked about (typed or shared) is still being worked on.
          const clean = pendingJobs.current === 0 ? d.clean : null;
          setCleanClipboardLink(clean);
          if (clean !== null) {
            setInputState(clean);
            setOutcome(null);
          }
        }
        if (!d.url || !s.autoClipboard) {
          setClipboardOffer(d.url ? { kind: 'android', url: d.url } : null);
          return;
        }
        setClipboardOffer(null);
        const out = await enqueue(d.url, 'auto', { settings: s });
        const undo = out ? undoTarget(raw, out) : null;
        setAutoCleaned(undo === null ? null : { undo });
      } catch {
        // Clipboard access is best-effort.
      }
    },
    [enqueue, tile],
  );
  recheckClipboard.current = () => void checkClipboard(latest.current.settings);

  const startTile = useCallback(
    async (launch: TileLaunch) => {
      const id = tile.start();
      // A tap while a request runs is the same request (spec §3.1).
      if (id === null) return;
      setTileRequests((n) => n + 1);
      setClipboardOffer(null);
      setAutoCleaned(null);
      setCleanClipboardLink(null);
      setTileNotice(null);
      const isValid = () => tile.isValid(id);
      try {
        await runTile(launch.wasInForeground, {
          waitForFocus: waitForWindowFocus,
          readClipboard: () => Clipboard.getStringAsync(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          rules: () => latest.current.rules,
          clean: (text, policy) => enqueue(text, 'tile', { ...policy, isValid, showsResult: () => tile.showsResult(id) }),
          isValid,
          noteSeen: (text) => {
            if (text !== '') watch.current = noteSelfWrite(watch.current, text);
          },
          // Never leave clipboard text without a link, or an older result, on the home screen.
          resetScreen: () => {
            setInputState('');
            setOutcome(null);
          },
          showNotice: setTileNotice,
          toast: (t) => ToastAndroid.show(tileToastText(t), ToastAndroid.SHORT),
          moveToBack: moveTaskToBack,
          remember: async (r) => {
            const value: LastTileResult = { ...r, at: Date.now() };
            setLastTile(value);
            await saveLastTileResult(db, value);
          },
          forget: async () => {
            setLastTile(null);
            await clearLastTileResult(db);
          },
        });
      } catch {
        // A failed tile request leaves Untail open on the home screen.
      } finally {
        tile.finish(id);
      }
    },
    [db, enqueue, tile],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      let s = DEFAULT_SETTINGS;
      let r = BUNDLED;
      try {
        let last: LastTileResult | null;
        [s, r, last] = await Promise.all([loadSettings(db), loadRules(db, BUNDLED), loadLastTileResult(db).catch(() => null)]);
        setLastTile(last);
      } catch {
        // Unreadable storage: keep defaults rather than blocking the app.
      }
      if (!alive) return;
      setSettingsState(s);
      setRules(r);
      // A tile request starting right now reads these before React re-renders.
      latest.current = { ...latest.current, settings: s, rules: r };
      setReady(true);
      readyRef.current = true;
      void refresh(false);
      const launch = consumeTileLaunch();
      if (launch) void startTile(launch);
      else void checkClipboard(s);
    })();
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'background') {
        // Another app may change the clipboard while we are away.
        clipboardGen.current += 1;
        skipNextActive.current = false;
        setTileNotice(null);
      }
      // Before startup finishes, startup itself takes the tile request and checks the clipboard.
      if (state !== 'active' || !readyRef.current) return;
      void refresh(false);
      const launch = consumeTileLaunch();
      if (launch) void startTile(launch);
      else if (skipNextActive.current) skipNextActive.current = false;
      else void checkClipboard(latest.current.settings);
    });
    // Leaving Untail (its activity stopped) ends a running tile request's copy, toast and return.
    const leftSub = addUntailLeftListener(() => tile.leave());
    // Untail already in front (only the shade covered it) gets the request through this event.
    const tileSub = addTileLaunchListener(() => {
      if (!readyRef.current) return;
      const launch = consumeTileLaunch();
      if (!launch) return;
      skipNextActive.current = true;
      void startTile(launch);
    });
    return () => {
      alive = false;
      sub.remove();
      tileSub.remove();
      leftSub.remove();
    };
  }, [db, refresh, checkClipboard, startTile, tile]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      db,
      rules,
      settings,
      locale,
      input,
      setInput(text: string) {
        invalidateTile();
        setInputState(text);
      },
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
      tileNotice,
      lastTile,
      async clearLastTile() {
        setLastTile(null);
        await clearLastTileResult(db);
      },
      tileRequests,
      invalidateTile,
    }),
    [ready, db, rules, settings, locale, input, outcome, pending, submit, refresh, copy, clipboardOffer, autoCleaned, cleanClipboardLink, tileNotice, lastTile, tileRequests, invalidateTile],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}
