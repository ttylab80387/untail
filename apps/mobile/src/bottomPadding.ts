import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Screens draw edge to edge on Android 15+, so scroll content must clear the navigation bar.
export function useBottomPadding(): { paddingBottom: number } {
  return { paddingBottom: 16 + useSafeAreaInsets().bottom };
}
