import '../src/i18n';
import { Ionicons } from '@expo/vector-icons';
import { Link, router, Stack, usePathname } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, Text, View } from 'react-native';
import { migrate } from '../src/lib/db';
import type { Db } from '../src/lib/db';
import { AppProvider, useApp } from '../src/state/AppContext';
import { useColors } from '../src/theme';

// Stable reference: a new onInit on every render would make SQLiteProvider reopen the database.
const initDb = (db: SQLiteDatabase) => migrate(db as unknown as Db);

// Consumes shares on any screen, exactly once, after settings and rules have loaded.
function ShareWatcher() {
  const { isReady, hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { ready, submit } = useApp();
  useEffect(() => {
    if (!isReady || !ready || !hasShareIntent) return;
    const text = shareIntent.text ?? shareIntent.webUrl ?? '';
    resetShareIntent();
    if (!text) return;
    if (router.canDismiss()) router.dismissAll();
    void submit(text);
  }, [isReady, ready, hasShareIntent, shareIntent, resetShareIntent, submit]);
  return null;
}

// A tile request shows its result on the home screen; leaving the home screen while it runs cancels it.
function TileWatcher() {
  const { tileRequests, invalidateTile } = useApp();
  const pathname = usePathname();
  useEffect(() => {
    if (tileRequests > 0 && router.canDismiss()) router.dismissAll();
  }, [tileRequests]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pathname !== '/') invalidateTile();
  }, [pathname, invalidateTile]);
  return null;
}

function HeaderTitle() {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Image source={require('../assets/icon.png')} style={{ width: 26, height: 26, borderRadius: 7 }} />
      <Text style={{ color: c.text, fontSize: 19, fontWeight: '700' }}>untail</Text>
    </View>
  );
}

function HeaderLinks() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 18 }}>
      <Link href="/history" asChild>
        <Pressable accessibilityLabel={t('nav.history')} hitSlop={10}>
          <Ionicons name="time-outline" size={23} color={c.muted} />
        </Pressable>
      </Link>
      <Link href="/settings" asChild>
        <Pressable accessibilityLabel={t('nav.settings')} hitSlop={10}>
          <Ionicons name="settings-outline" size={22} color={c.muted} />
        </Pressable>
      </Link>
    </View>
  );
}

export default function RootLayout() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <ShareIntentProvider>
      <SQLiteProvider databaseName="linkclean.db" onInit={initDb}>
        <AppProvider>
          <ShareWatcher />
          <TileWatcher />
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              contentStyle: { backgroundColor: c.bg },
              headerStyle: { backgroundColor: c.bg },
              headerShadowVisible: false,
              headerTintColor: c.text,
            }}
          >
            <Stack.Screen
              name="index"
              options={{ title: t('app.title'), headerTitle: () => <HeaderTitle />, headerRight: () => <HeaderLinks /> }}
            />
            <Stack.Screen name="history" options={{ title: t('history.title') }} />
            <Stack.Screen name="result/[id]" options={{ title: t('result.title') }} />
            <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
            <Stack.Screen name="privacy" options={{ title: t('privacy.title') }} />
            <Stack.Screen name="licenses" options={{ title: t('licenses.title') }} />
          </Stack>
        </AppProvider>
      </SQLiteProvider>
    </ShareIntentProvider>
  );
}
