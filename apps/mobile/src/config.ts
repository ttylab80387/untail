import Constants from 'expo-constants';

// Base URL of the GitHub Pages site that hosts rules.json, rules.meta.json and privacy.html.
// Must end with "/". Empty string disables remote rule updates (bundled rules only).
export const SITE_BASE_URL = '';

export const USER_AGENT = `Untail/${Constants.expoConfig?.version ?? '0'}`;
