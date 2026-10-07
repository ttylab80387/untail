import '../src/i18n';
import { Link, router, Stack } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { SQLiteProvider } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
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

function HeaderLinks() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Text style={{ color: c.accent }}>
      <Link href="/history">{t('nav.history')}</Link>
      {'   '}
      <Link href="/settings">{t('nav.settings')}</Link>
    </Text>
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
          <Stack screenOptions={{ contentStyle: { backgroundColor: c.bg }, headerStyle: { backgroundColor: c.card }, headerTintColor: c.text }}>
            <Stack.Screen name="index" options={{ title: t('app.title'), headerRight: () => <HeaderLinks /> }} />
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
