import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useColors } from '../src/theme';
import { useBottomPadding } from '../src/bottomPadding';

const PARAGRAPHS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;

export default function Privacy() {
  const bottomPadding = useBottomPadding();
  const { t } = useTranslation();
  const c = useColors();
  return (
    <ScrollView contentContainerStyle={[styles.container, bottomPadding]}>
      {PARAGRAPHS.map((p) => (
        <Text key={p} style={{ color: c.text, lineHeight: 22 }}>
          {t(`privacy.${p}`)}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 16, gap: 14 } });
