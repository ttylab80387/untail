import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, StyleSheet, Text } from 'react-native';
import { clearHistory, deleteHistory, listHistory } from '../src/lib/db';
import type { HistoryEntry } from '../src/lib/db';
import { useApp } from '../src/state/AppContext';
import { useColors } from '../src/theme';

export default function History() {
  const { t, i18n } = useTranslation();
  const c = useColors();
  const { db } = useApp();
  const [items, setItems] = useState<HistoryEntry[]>([]);

  const reload = useCallback(() => {
    void listHistory(db).then(setItems, () => setItems([]));
  }, [db]);
  useFocusEffect(reload);

  const confirm = (message: string, action: () => Promise<void>) =>
    Alert.alert(message, undefined, [
      { text: t('history.cancel'), style: 'cancel' },
      { text: t('history.delete'), style: 'destructive', onPress: () => void action().finally(reload) },
    ]);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            items.length ? (
              <Pressable onPress={() => confirm(t('history.clearConfirm'), () => clearHistory(db))}>
                <Text style={{ color: c.danger }}>{t('history.clearAll')}</Text>
              </Pressable>
            ) : null,
        }}
      />
      <FlatList
        data={items}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={{ color: c.muted, textAlign: 'center' }}>{t('history.empty')}</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/result/${item.id}`)}
            onLongPress={() => confirm(t('history.deleteConfirm'), () => deleteHistory(db, item.id))}
            style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <Text style={{ color: c.muted, fontSize: 12 }}>{new Date(item.createdAt).toLocaleString(i18n.language)}</Text>
            <Text numberOfLines={2} style={{ color: c.text }}>
              {item.result.cleanUrl}
            </Text>
            <Text style={{ color: item.result.status === 'clean' ? c.ok : c.warn, fontSize: 12 }}>
              {t(`result.status.${item.result.status}`)} · {t('result.removedCount', { count: item.result.removed.length })}
            </Text>
          </Pressable>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  row: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
});
