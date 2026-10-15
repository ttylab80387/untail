import { requireOptionalNativeModule } from 'expo';

export interface ClipboardState {
  hasUrl: boolean; // a web link, as a URL item or as plain text
  changeCount: number; // UIPasteboard.changeCount; changes whenever any app writes the clipboard
}

// iOS only; the module is not linked on Android.
const native = requireOptionalNativeModule<{ stateAsync(): Promise<ClipboardState> }>('UntailClipboard');

// Looks at the clipboard without reading it, so it never shows the iOS paste prompt.
export async function clipboardStateAsync(): Promise<ClipboardState | null> {
  return native ? native.stateAsync() : null;
}
