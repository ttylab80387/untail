import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import type { AnalyzedParam, ProcessResult } from '@linkclean/core';
import { referralCode } from '../lib/referral';
import { siteLabel } from '../lib/siteLabel';
import { statusText } from '../lib/statusText';
import { useApp } from '../state/AppContext';
import { useReport } from './useReport';
import { MONO, useColors } from '../theme';
import type { Colors } from '../theme';

function riskColor(c: Colors, risk: AnalyzedParam['risk']): string {
  return risk === 'low' ? c.muted : c.warn;
}

const short = (v: string) => (v.length > 18 ? `${v.slice(0, 16)}…` : v);

// One removed parameter as a diff-style line; tap to show the explanation.
function ParamRow({ p }: { p: AnalyzedParam }) {
  const { t } = useTranslation();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const code = referralCode(p);
  return (
    <Pressable onPress={() => setOpen(!open)} style={styles.param}>
      <View style={styles.paramHead}>
        <Text style={[styles.mono, { color: c.muted, flex: 1 }]} numberOfLines={1}>
          <Text style={{ color: c.danger }}>- </Text>
          <Text style={{ color: c.text, fontWeight: '700' }}>{p.key}</Text>
          {`=${short(p.value)}`}
        </Text>
        <Text style={[styles.tag, { color: riskColor(c, p.risk) }]}>
          [{t(`category.${p.category}`)}]
        </Text>
      </View>
      {code && (
        <Text selectable style={{ color: c.warn, paddingLeft: 14, fontSize: 13 }}>
          {t('result.referralCode', { code })}
        </Text>
      )}
      {open && (
        <View style={styles.paramBody}>
          <Text style={{ color: c.text, lineHeight: 19 }}>{p.desc ?? t('result.noDesc')}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {t(p.category === 'hidden' ? `riskHidden.${p.risk}` : `risk.${p.risk}`)}
            {p.owner ? ` · ${t('result.owner', { owner: p.owner })}` : ''}
          </Text>
          <Text selectable style={[styles.mono, { color: c.muted }]}>{`${p.key}=${p.value}`}</Text>
        </View>
      )}
    </Pressable>
  );
}

// Where the link goes: the main domain in bold, the subdomain muted, and the xn-- form for IDN hosts.
function SiteLine({ destination }: { destination: NonNullable<ProcessResult['destination']> }) {
  const { t } = useTranslation();
  const c = useColors();
  const l = siteLabel(destination.site);
  return (
    <Text style={{ color: c.muted }}>
      {t(destination.complete ? 'result.site' : 'result.siteSoFar')}
      {l.sub}
      <Text style={{ color: c.text, fontWeight: '700' }}>{l.main}</Text>
      {l.ascii ? ` (${l.ascii})` : ''}
    </Text>
  );
}

export function ResultCard({ result, copied }: { result: ProcessResult; copied: boolean }) {
  const { t } = useTranslation();
  const c = useColors();
  const { copy } = useApp();
  const sendReport = useReport();
  const [showHops, setShowHops] = useState(false);

  const report = () => sendReport(result.originalUrl, result.cleanUrl, result.status);
  const statusColor = result.status === 'clean' ? c.ok : result.status === 'partial' ? c.warn : c.danger;

  if (result.status === 'failed') {
    return (
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <Text style={[styles.status, { color: statusColor }]}>{t('result.status.failed')}</Text>
        <Text style={{ color: c.muted }}>{t('result.reason.invalid_input')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.card }]}>
      <Text style={[styles.status, { color: statusColor }]}>
        {statusText(t, result)}
        {copied ? <Text style={{ color: c.muted, fontWeight: '600' }}>{`  ·  ${t('result.copiedTag')}`}</Text> : null}
      </Text>
      {result.destination && <SiteLine destination={result.destination} />}
      {result.reason && <Text style={{ color: c.warn, lineHeight: 19 }}>{t(`result.reason.${result.reason}`)}</Text>}
      {result.hiddenKept && result.hiddenKept.length > 0 && (
        <Text style={{ color: c.muted, fontSize: 12 }}>
          {t('result.hiddenKept', { codes: [...new Set(result.hiddenKept.map((h) => h.code))].join(', ') })}
        </Text>
      )}
      <Text selectable style={[styles.url, { color: c.text, backgroundColor: c.bg }]}>
        {result.cleanUrl}
      </Text>

      <View style={styles.actions}>
        <ActionButton icon="copy-outline" label={t('result.copy')} onPress={() => void copy(result.cleanUrl)} />
        <ActionButton icon="share-outline" label={t('result.share')} onPress={() => void Share.share({ message: result.cleanUrl })} />
        <ActionButton icon="open-outline" label={t('result.open')} onPress={() => void Linking.openURL(result.cleanUrl)} />
      </View>

      {result.removed.length ? (
        <Text style={[styles.section, { color: c.muted }]}>{t('result.removedCount', { count: result.removed.length })}</Text>
      ) : (
        // "Nothing found" is exactly when an unknown tracking code may have slipped through.
        <Text style={[styles.section, { color: c.muted }]}>
          {`${t('result.noneRemoved')}  ·  `}
          <Text onPress={report} style={{ color: c.accent, textDecorationLine: 'underline' }}>
            {t('result.reportDoubt')}
          </Text>
        </Text>
      )}
      {result.removed.map((p, i) => (
        <ParamRow key={`${p.key}-${i}`} p={p} />
      ))}

      {result.hops.length > 1 && (
        <Pressable onPress={() => setShowHops(!showHops)}>
          <Text style={[styles.section, { color: c.accent }]}>
            {showHops ? '▾ ' : '▸ '}
            {t('result.hops')}
          </Text>
          {showHops &&
            result.hops.map((h, i) => (
              <Text key={`${i}-${h}`} selectable style={[styles.mono, { color: c.muted }]}>
                {`${i + 1}. ${h}`}
              </Text>
            ))}
        </Pressable>
      )}

      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }}>{t('result.notSafetyCheck')}</Text>

      {result.removed.length > 0 && (
        <Pressable onPress={report} style={styles.report} hitSlop={8}>
          <Text style={{ color: c.muted, textDecorationLine: 'underline' }}>{t('result.report')}</Text>
        </Pressable>
      )}
    </View>
  );
}

function ActionButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress(): void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} style={[styles.button, { borderColor: c.border }]}>
      <Ionicons name={icon} size={15} color={c.text} />
      <Text style={{ color: c.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, gap: 10 },
  status: { fontSize: 15, fontWeight: '800' },
  url: { fontFamily: MONO, fontSize: 13, lineHeight: 19, padding: 10, borderRadius: 8 },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderRadius: 8, paddingVertical: 9 },
  section: { marginTop: 4, fontWeight: '600', fontSize: 13 },
  param: { paddingVertical: 4, gap: 4 },
  paramHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paramBody: { gap: 4, paddingLeft: 14, paddingBottom: 4 },
  tag: { fontSize: 12, fontWeight: '600' },
  mono: { fontFamily: MONO, fontSize: 12 },
  report: { alignSelf: 'flex-end', marginTop: 4 },
});
