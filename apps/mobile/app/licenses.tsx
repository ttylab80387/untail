import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useColors } from '../src/theme';

export default function Licenses() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={{ color: c.text }}>{t('licenses.clearurls')}</Text>
      <Pressable onPress={() => void Linking.openURL('https://www.gnu.org/licenses/lgpl-3.0.html')}>
        <Text style={{ color: c.accent }}>GNU LGPL-3.0</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { padding: 16, gap: 12 } });
