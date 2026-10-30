import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { settingsLines, shouldOfferReport } from '../src/lib/rulesStore';
import type { ManualResult } from '../src/lib/rulesStore';
import type { Settings } from '../src/lib/settings';
import { useApp } from '../src/state/AppContext';
import { useColors } from '../src/theme';
import { useBottomPadding } from '../src/bottomPadding';
import { confirmAutoClean } from '../src/confirmAuto';
import { useAddTile } from '../src/components/useAddTile';
import { useRulesReport } from '../src/components/useReport';

export default function SettingsScreen() {
  const bottomPadding = useBottomPadding();
  const { t } = useTranslation();
  const c = useColors();
  const addTile = useAddTile();
  const { settings, setSettings, rules, rulesSource, rulesStatus, refreshRules, locale } = useApp();
  const reportUpdate = useRulesReport();
  const [updating, setUpdating] = useState(false);
  const [outcome, setOutcome] = useState<ManualResult | null>(null);

  const toggle = (key: keyof Settings) => (value: boolean) => {
    // Automatic cleaning only runs when clipboard detection is on.
    if (key === 'autoClipboard' && value) {
      confirmAutoClean(t, () => void setSettings({ ...settings, detectClipboard: true, autoClipboard: true }));
    } else {
      void setSettings({ ...settings, [key]: value });
    }
  };

  const update = async () => {
    setUpdating(true);
    try {
      setOutcome({ outcome: await refreshRules(), at: Date.now() });
    } catch {
      setOutcome({ outcome: 'failed-network', at: Date.now() });
    } finally {
      setUpdating(false);
    }
  };

  const lines = settingsLines(rulesStatus, outcome);

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
      {addTile.visible && (
        <View style={[styles.block, { backgroundColor: c.card, borderColor: c.border }]}>
          {addTile.canPrompt && (
            <Pressable disabled={addTile.added} onPress={() => void addTile.request()}>
              <Text style={{ color: c.accent, opacity: addTile.added ? 0.5 : 1 }}>
                {addTile.added ? t('settings.addTileAdded') : t('settings.addTile')}
              </Text>
            </Pressable>
          )}
          {!addTile.canPrompt && <Text style={{ color: c.text }}>{t('settings.addTile')}</Text>}
          <Text style={{ color: c.muted, fontSize: 12 }}>{t('settings.addTileHint')}</Text>
        </View>
      )}

      <View style={[styles.block, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={{ color: c.text }}>
          {t('settings.rulesVersion', { version: rules.version })}{' '}
          {t(rulesSource === 'downloaded' ? 'settings.sourceDownloaded' : 'settings.sourceBuiltIn')}
        </Text>
        {rulesStatus.lastSuccessAt !== null && (
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {t('settings.lastSuccess', { time: new Date(rulesStatus.lastSuccessAt).toLocaleString(locale) })}
          </Text>
        )}
        <Pressable disabled={updating} onPress={() => void update()}>
          <Text style={{ color: c.accent, opacity: updating ? 0.5 : 1 }}>{t('settings.updateNow')}</Text>
        </Pressable>
        {lines.manualKey && <Text style={{ color: c.muted }}>{t(`settings.update.${lines.manualKey}`)}</Text>}
        {lines.failure && <Text style={{ color: c.muted }}>{t(`settings.update.failed-${lines.failure}`)}</Text>}
        {shouldOfferReport(rulesStatus) && (
          <Pressable onPress={reportUpdate}>
            <Text style={{ color: c.accent, textDecorationLine: 'underline' }}>{t('settings.reportUpdate')}</Text>
          </Pressable>
        )}
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
