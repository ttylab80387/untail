import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Platform } from 'react-native';
import { SUPPORT_EMAIL } from '../config';
import { reportMailto, rulesReportMailto, systemLabel } from '../lib/report';
import { BUILT_IN_RULES_VERSION, useApp } from '../state/AppContext';

// Opens the user's mail app with a report about one link; nothing is sent unless they send it.
export function useReport(): (originalUrl: string, cleanUrl: string, status: string) => void {
  const { t } = useTranslation();
  const { copy, rules } = useApp();
  return (originalUrl, cleanUrl, status) => {
    const url = reportMailto({
      to: SUPPORT_EMAIL,
      subject: t('report.subject'),
      note: t('report.note'),
      originalUrl,
      cleanUrl,
      status,
      appVersion: Constants.expoConfig?.version ?? '0',
      rulesVersion: rules.version,
    });
    Linking.openURL(url).catch(() =>
      // Alert text cannot be selected, so offer to copy the address.
      Alert.alert(t('report.noMail'), undefined, [
        { text: t('report.copyEmail'), onPress: () => void copy(SUPPORT_EMAIL) },
        { text: t('report.ok'), style: 'cancel' },
      ]),
    );
  };
}

// Opens the user's mail app with the latest rules update failure; nothing is sent unless they send it.
export function useRulesReport(): () => void {
  const { t } = useTranslation();
  const { copy, rules, rulesSource, rulesStatus } = useApp();
  return () => {
    const f = rulesStatus.failure;
    if (!f) return;
    const release = (Platform.constants as { Release?: string }).Release;
    const url = rulesReportMailto({
      to: SUPPORT_EMAIL,
      subject: t('report.updateSubject'),
      note: t('report.updateNote'),
      reason: f.reason,
      failedAt: f.at,
      count: f.count,
      lastSuccessAt: rulesStatus.lastSuccessAt,
      appVersion: Constants.expoConfig?.version ?? '0',
      rulesVersion: rules.version,
      rulesSource,
      builtInVersion: BUILT_IN_RULES_VERSION,
      system: systemLabel(Platform.OS, Platform.Version, release),
    });
    Linking.openURL(url).catch(() =>
      Alert.alert(t('report.noMail'), undefined, [
        { text: t('report.copyEmail'), onPress: () => void copy(SUPPORT_EMAIL) },
        { text: t('report.ok'), style: 'cancel' },
      ]),
    );
  };
}
