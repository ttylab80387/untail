// Builds a mailto: link for reporting a link the app did not clean well.
// Nothing is sent by the app; the user's mail app shows the full text before anything leaves the phone.
import type { FailReason, RulesSource } from './rulesStore';
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

export interface RulesReportInput {
  to: string;
  subject: string;
  note: string;
  reason: FailReason;
  failedAt: number;
  count: number;
  lastSuccessAt: number | null;
  appVersion: string;
  rulesVersion: string;
  rulesSource: RulesSource;
  builtInVersion: string;
  system: string;
}

// Report for rules updates that keep failing; holds no links, history or identifiers.
export function rulesReportMailto(r: RulesReportInput): string {
  const body = [
    r.note,
    '',
    `Rules update: ${r.reason}`,
    `Last failure: ${new Date(r.failedAt).toISOString()}`,
    `Failures in a row: ${r.count}`,
    `Last success: ${r.lastSuccessAt === null ? 'never' : new Date(r.lastSuccessAt).toISOString()}`,
    `App ${r.appVersion} / Rules ${r.rulesVersion} (${r.rulesSource}) / Built-in ${r.builtInVersion}`,
    r.system,
  ].join('\n');
  return `mailto:${r.to}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(body)}`;
}

// Android's Platform.Version is the API level (36), so the release string (16) comes separately.
export function systemLabel(os: string, version: string | number, androidRelease?: string): string {
  return os === 'android' ? `Android ${androidRelease ?? version}` : `iOS ${version}`;
}
