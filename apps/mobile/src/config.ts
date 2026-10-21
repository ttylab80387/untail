import Constants from 'expo-constants';

// Base URL of the GitHub Pages site that hosts rules.json, rules.meta.json and privacy.html.
// Must end with "/". Empty string disables remote rule updates (bundled rules only).
export const SITE_BASE_URL = 'https://ttylab80387.github.io/untail/';

// Where "Report a problem" emails go; also the store listings' contact address.
export const SUPPORT_EMAIL = 'support@ttylab80387.com';

export const USER_AGENT = `Untail/${Constants.expoConfig?.version ?? '0'}`;
