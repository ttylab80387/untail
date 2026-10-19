import { useState } from 'react';
import { Platform } from 'react-native';
import { requestAddTile, tileSupported } from '../../modules/untail-tile';

// Android 13+ can show the system "add tile" dialog; older versions only get written steps.
export function useAddTile() {
  const [added, setAdded] = useState(false);
  const visible = Platform.OS === 'android' && tileSupported;
  const canPrompt = visible && Number(Platform.Version) >= 33;
  const request = async () => {
    if (!canPrompt) return;
    const result = await requestAddTile();
    if (result === 'added' || result === 'already') setAdded(true);
  };
  return { visible, canPrompt, added, request };
}
