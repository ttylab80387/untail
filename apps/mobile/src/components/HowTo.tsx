import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../state/AppContext';
import { useColors } from '../theme';

// Fills the empty home screen with the three ways to use the app, so the share sheet entry
// and automatic cleaning can be found without a separate onboarding flow.
export function HowTo() {
  const { t } = useTranslation();
  const c = useColors();
  const { settings, setSettings } = useApp();
  const autoOn = settings.autoClipboard && settings.detectClipboard;

  const enableAuto = () => {
    // Automatic cleaning only runs when clipboard detection is on.
    void setSettings({ ...settings, detectClipboard: true, autoClipboard: true });
    if (Platform.OS === 'ios') Alert.alert(t('howto.autoOn'), t('howto.iosPaste'));
  };

  const step = (n: number, body: ReactNode) => (
    <View style={styles.step}>
      <Text style={[styles.num, { color: c.accent, borderColor: c.border }]}>{n}</Text>
      <View style={styles.body}>{body}</View>
    </View>
  );

  return (
    <View style={styles.box}>
      <Text style={[styles.title, { color: c.muted }]}>{t('howto.title')}</Text>
      {step(1, <Text style={{ color: c.text, lineHeight: 20 }}>{t('howto.copy')}</Text>)}
      {step(
        2,
        <>
          <Text style={{ color: c.text, lineHeight: 20 }}>{t('howto.share')}</Text>
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>{t('howto.shareTip')}</Text>
        </>,
      )}
      {step(
        3,
        <>
          <Text style={{ color: c.text, lineHeight: 20 }}>{t('howto.auto')}</Text>
          {autoOn ? (
            <View style={styles.on}>
              <Ionicons name="checkmark-circle" size={16} color={c.accent} />
              <Text style={{ color: c.accent, fontWeight: '700' }}>{t('howto.autoOn')}</Text>
            </View>
          ) : (
            <Pressable onPress={enableAuto} style={[styles.button, { borderColor: c.accent }]}>
              <Text style={{ color: c.accent, fontWeight: '700' }}>{t('howto.enableAuto')}</Text>
            </Pressable>
          )}
        </>,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 14, marginTop: 12 },
  title: { fontSize: 13, fontWeight: '700' },
  step: { flexDirection: 'row', gap: 12 },
  num: { width: 26, height: 26, borderWidth: 1, borderRadius: 13, textAlign: 'center', lineHeight: 24, fontWeight: '800' },
  body: { flex: 1, gap: 6 },
  on: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
});
