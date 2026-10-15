// Builds a mailto: link for reporting a link the app did not clean well.
// Nothing is sent by the app; the user's mail app shows the full text before anything leaves the phone.
export interface ReportInput {
  to: string;
  subject: string;
  note: string; // localized privacy reminder shown at the top of the body
  originalUrl: string;
  cleanUrl: string;
  status: string;
  appVersion: string;
  rulesVersion: string;
}

// Mail apps can refuse very long mailto: links, so each link is cut down.
const MAX_LINK = 1000;
const cap = (url: string) => (url.length > MAX_LINK ? `${url.slice(0, MAX_LINK)}…` : url);

export function reportMailto(r: ReportInput): string {
  const body = [
    r.note,
    '',
    `Original: ${cap(r.originalUrl)}`,
    `Clean: ${cap(r.cleanUrl)}`,
    `Result: ${r.status}`,
    `App ${r.appVersion} / Rules ${r.rulesVersion}`,
  ].join('\n');
  return `mailto:${r.to}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(body)}`;
}
