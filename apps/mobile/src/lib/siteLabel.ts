import type { SiteInfo } from '@linkclean/core';

// The main domain is what tells you whose site it is; the subdomain can say anything.
export function siteLabel(site: SiteInfo): { sub: string; main: string; ascii: string | null } {
  const main = site.domain ?? site.host;
  const sub = site.host.endsWith(main) ? site.host.slice(0, site.host.length - main.length) : '';
  return { sub, main, ascii: site.asciiHost !== site.host ? site.asciiHost : null };
}
