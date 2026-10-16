import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { UpdateOutcome } from '../src/lib/rulesStore';
import type { Settings } from '../src/lib/settings';
import { useApp } from '../src/state/AppContext';
import { useColors } from '../src/theme';
import { useBottomPadding } from '../src/bottomPadding';
import { confirmAutoClean } from '../src/confirmAuto';

export default function SettingsScreen() {
  const bottomPadding = useBottomPadding();
  const { t } = useTranslation();
  const c = useColors();
  const { settings, setSettings, rules, refreshRules } = useApp();
  const [updating, setUpdating] = useState(false);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);

  const toggle = (key: keyof Settings) => (value: boolean) => {
    if (key === 'autoClipboard' && value) confirmAutoClean(t, () => void setSettings({ ...settings, autoClipboard: true }));
    else void setSettings({ ...settings, [key]: value });
  };

  const update = async () => {
    setUpdating(true);
    try {
      setOutcome(await refreshRules());
    } catch {
      setOutcome('failed');
    } finally {
      setUpdating(false);
    }
  };

  const row = (key: keyof Settings, label: string, hint?: string) => (
    <View style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.rowText}>
        <Text style={{ color: c.text }}>{label}</Text>
        {hint && <Text style={{ color: c.muted, fontSize: 12 }}>{hint}</Text>}
      </View>
      <Switch
        value={settings[key]}
        onValueChange={toggle(key)}
        trackColor={{ false: c.border, true: c.accent }}
        thumbColor={settings[key] ? c.text : c.muted}
      />
    </View>
  );

  return (
    <ScrollView contentContainerStyle={[styles.container, bottomPadding]}>
      {row('expand', t('settings.expand'), t('settings.expandHint'))}
      {row('autoCopy', t('settings.autoCopy'))}
      {row('history', t('settings.history'))}
      {row('detectClipboard', t('settings.detectClipboard'), t('settings.detectClipboardHint'))}
      {row('autoClipboard', t('settings.autoClipboard'), t('settings.autoClipboardHint'))}

      <View style={[styles.block, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={{ color: c.text }}>{t('settings.rulesVersion', { version: rules.version })}</Text>
        <Pressable disabled={updating} onPress={() => void update()}>
          <Text style={{ color: c.accent, opacity: updating ? 0.5 : 1 }}>{t('settings.updateNow')}</Text>
        </Pressable>
        {outcome && <Text style={{ color: c.muted }}>{t(`settings.update.${outcome}`)}</Text>}
      </View>

      <Link href="/privacy" style={[styles.link, { color: c.accent }]}>
        {t('settings.privacy')}
      </Link>
      <Link href="/licenses" style={[styles.link, { color: c.accent }]}>
        {t('settings.licenses')}
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 14, gap: 12 },
  rowText: { flex: 1, gap: 2 },
  block: { borderRadius: 12, padding: 14, gap: 8 },
  link: { paddingVertical: 8 },
});
