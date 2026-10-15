import { requireOptionalNativeModule } from 'expo';

// iOS only; the module is not linked on Android.
const native = requireOptionalNativeModule<{ hasWebUrlAsync(): Promise<boolean> }>('UntailClipboard');

// True when the clipboard holds a web link, as a URL item or as plain text. Never shows the paste prompt.
export async function hasWebUrlAsync(): Promise<boolean> {
  return native ? native.hasWebUrlAsync() : false;
}
