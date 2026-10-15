import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Alert, Linking } from 'react-native';
import { SUPPORT_EMAIL } from '../config';
import { reportMailto } from '../lib/report';
import { useApp } from '../state/AppContext';

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
