import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { ResultCard } from '../../src/components/ResultCard';
import { getHistory } from '../../src/lib/db';
import type { HistoryEntry } from '../../src/lib/db';
import { useApp } from '../../src/state/AppContext';

export default function HistoryResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db } = useApp();
  const [entry, setEntry] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    void getHistory(db, Number(id)).then(setEntry, () => setEntry(null));
  }, [db, id]);

  return (
    <ScrollView contentContainerStyle={styles.container}>{entry && <ResultCard result={entry.result} copied={false} />}</ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 16 } });
