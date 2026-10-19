import { requireOptionalNativeModule } from 'expo';

export interface TileLaunch {
  wasInForeground: boolean; // Untail was in front when the tile was tapped
}

export type AddTileResult = 'added' | 'already' | 'dismissed' | 'unsupported';

interface NativeTile {
  consumeTileLaunch(): TileLaunch | null;
  waitForWindowFocus(timeoutMs: number): Promise<boolean>;
  moveTaskToBack(): Promise<boolean>;
  requestAddTile(): Promise<AddTileResult>;
  addListener(event: 'onTileLaunch', listener: () => void): { remove(): void };
}

// Android only; on iOS every call is a no-op or reports "unsupported".
const native = requireOptionalNativeModule<NativeTile>('UntailTile');

export const tileSupported = native !== null;

export function consumeTileLaunch(): TileLaunch | null {
  try {
    return native?.consumeTileLaunch() ?? null;
  } catch {
    return null;
  }
}

export function addTileLaunchListener(listener: () => void): { remove(): void } {
  return native ? native.addListener('onTileLaunch', listener) : { remove: () => undefined };
}

export async function waitForWindowFocus(timeoutMs: number): Promise<boolean> {
  return native ? native.waitForWindowFocus(timeoutMs) : true;
}

export async function moveTaskToBack(): Promise<boolean> {
  return native ? native.moveTaskToBack() : false;
}

export async function requestAddTile(): Promise<AddTileResult> {
  if (!native) return 'unsupported';
  try {
    return await native.requestAddTile();
  } catch {
    return 'unsupported';
  }
}
