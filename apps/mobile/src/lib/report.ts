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

export function reportMailto(r: ReportInput): string {
  const body = [
    r.note,
    '',
    `Original: ${r.originalUrl}`,
    `Clean: ${r.cleanUrl}`,
    `Result: ${r.status}`,
    `App ${r.appVersion} / Rules ${r.rulesVersion}`,
  ].join('\n');
  return `mailto:${r.to}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(body)}`;
}
