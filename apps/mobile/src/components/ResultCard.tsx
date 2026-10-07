import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import type { AnalyzedParam, ProcessResult } from '@linkclean/core';
import { useColors } from '../theme';
import type { Colors } from '../theme';

function riskColor(c: Colors, risk: AnalyzedParam['risk']): string {
  return risk === 'high' ? c.danger : risk === 'medium' ? c.warn : c.muted;
}

function ParamRow({ p }: { p: AnalyzedParam }) {
  const { t } = useTranslation();
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen(!open)} style={[styles.param, { borderColor: c.border }]}>
      <View style={styles.paramHead}>
        <Text style={[styles.paramKey, { color: c.text }]}>{p.key}</Text>
        <Text style={[styles.badge, { color: riskColor(c, p.risk), borderColor: riskColor(c, p.risk) }]}>{t(`risk.${p.risk}`)}</Text>
      </View>
      <Text style={{ color: c.muted }}>
        {t(`category.${p.category}`)}
        {p.owner ? ` · ${t('result.owner', { owner: p.owner })}` : ''}
      </Text>
      {open && (
        <View style={styles.paramBody}>
          <Text style={{ color: c.text }}>{p.desc ?? t('result.noDesc')}</Text>
          <Text selectable style={[styles.mono, { color: c.muted }]}>{`${p.key}=${p.value}`}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function ResultCard({ result, copied }: { result: ProcessResult; copied: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const [showHops, setShowHops] = useState(false);
  const statusColor = result.status === 'clean' ? c.ok : result.status === 'partial' ? c.warn : c.danger;

  if (result.status === 'failed') {
    return (
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.status, { color: statusColor }]}>{t('result.status.failed')}</Text>
        <Text style={{ color: c.muted }}>{t('result.reason.invalid_input')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.status, { color: statusColor }]}>{t(`result.status.${result.status}`)}</Text>
      {result.reason && <Text style={{ color: c.warn }}>{t(`result.reason.${result.reason}`)}</Text>}
      <Text selectable style={[styles.url, { color: c.text }]}>{result.cleanUrl}</Text>
      {copied && <Text style={{ color: c.ok }}>{t('result.copied')}</Text>}

      <View style={styles.actions}>
        <Pressable onPress={() => void Clipboard.setStringAsync(result.cleanUrl)} style={[styles.button, { backgroundColor: c.accent }]}>
          <Text style={styles.buttonText}>{t('result.copy')}</Text>
        </Pressable>
        <Pressable onPress={() => void Share.share({ message: result.cleanUrl })} style={[styles.button, { backgroundColor: c.accent }]}>
          <Text style={styles.buttonText}>{t('result.share')}</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(result.cleanUrl)} style={[styles.button, { backgroundColor: c.accent }]}>
          <Text style={styles.buttonText}>{t('result.open')}</Text>
        </Pressable>
      </View>

      <Text style={[styles.section, { color: c.text }]}>
        {result.removed.length ? t('result.removedCount', { count: result.removed.length }) : t('result.noneRemoved')}
      </Text>
      {result.removed.map((p, i) => (
        <ParamRow key={`${p.key}-${i}`} p={p} />
      ))}

      {result.hops.length > 1 && (
        <Pressable onPress={() => setShowHops(!showHops)}>
          <Text style={[styles.section, { color: c.accent }]}>{t('result.hops')}</Text>
          {showHops &&
            result.hops.map((h, i) => (
              <Text key={`${i}-${h}`} selectable style={[styles.mono, { color: c.muted }]}>
                {`${i + 1}. ${h}`}
              </Text>
            ))}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  status: { fontSize: 18, fontWeight: '700' },
  url: { fontSize: 15 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  section: { marginTop: 8, fontWeight: '600' },
  param: { borderWidth: 1, borderRadius: 8, padding: 10, gap: 4 },
  paramHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paramKey: { fontWeight: '600', fontFamily: 'Courier' },
  paramBody: { gap: 4, marginTop: 4 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, fontSize: 12 },
  mono: { fontFamily: 'Courier', fontSize: 12 },
});
