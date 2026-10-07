import type { AnalyzedParam } from '@linkclean/core';

// Affiliate / referral params carry a readable code (e.g. "someone-20") worth showing as-is.
// Sharer IDs are opaque tokens only the platform can map to a person, so they are never shown this way.
export function referralCode(p: AnalyzedParam): string | null {
  return p.category === 'affiliate' && p.value.trim() ? p.value : null;
}
