import type { TFunction } from 'i18next';
import { Alert, Platform } from 'react-native';

// Turning on automatic cleaning sends short links off the device without a tap each time,
// so the user is told what goes where before it is enabled.
export function confirmAutoClean(t: TFunction, enable: () => void): void {
  Alert.alert(t('howto.autoConfirmTitle'), t('howto.autoConfirmBody'), [
    { text: t('howto.autoConfirmCancel'), style: 'cancel' },
    {
      text: t('howto.autoConfirmOk'),
      onPress: () => {
        enable();
        if (Platform.OS === 'ios') Alert.alert(t('howto.autoOn'), t('howto.iosPaste'));
      },
    },
  ]);
}
