import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resolveLocale } from '@linkclean/core';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhTW from './locales/zh-TW.json';

export const locale = resolveLocale(getLocales()[0]?.languageTag ?? 'en');

void i18n.use(initReactI18next).init({
  resources: { 'zh-TW': { translation: zhTW }, en: { translation: en }, ja: { translation: ja } },
  lng: locale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
