import { useColorScheme } from 'react-native';

export interface Colors {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  ok: string;
  warn: string;
  danger: string;
}

const light: Colors = {
  bg: '#f6f7f9',
  card: '#ffffff',
  text: '#16181d',
  muted: '#5d6470',
  border: '#d9dde3',
  accent: '#2563eb',
  ok: '#15803d',
  warn: '#b45309',
  danger: '#b91c1c',
};

const dark: Colors = {
  bg: '#0f1115',
  card: '#181b21',
  text: '#eceef2',
  muted: '#9aa1ad',
  border: '#2b3038',
  accent: '#60a5fa',
  ok: '#4ade80',
  warn: '#fbbf24',
  danger: '#f87171',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
