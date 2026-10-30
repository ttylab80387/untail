import { describe, expect, it } from 'vitest';
import { reportMailto, rulesReportMailto, systemLabel } from './report';

const base = {
  to: 'dev@example.com',
  subject: 'Untail report',
  note: 'This link may identify the sharer.',
  originalUrl: 'https://ex.com/a?x=1&y=2',
  cleanUrl: 'https://ex.com/a?x=1',
  status: 'partial',
  appVersion: '0.1.0',
  rulesVersion: '2026.10.14.1443',
};

describe('reportMailto', () => {
  it('addresses the developer with an encoded subject', () => {
    const url = reportMailto(base);
    expect(url.startsWith('mailto:dev@example.com?subject=Untail%20report&body=')).toBe(true);
  });

  it('puts the note, both links, the result and versions in the body, decodable as-is', () => {
    const body = decodeURIComponent(reportMailto(base).split('&body=')[1]!);
    expect(body).toBe(
      [
        'This link may identify the sharer.',
        '',
        'Original: https://ex.com/a?x=1&y=2',
        'Clean: https://ex.com/a?x=1',
        'Result: partial',
        'App 0.1.0 / Rules 2026.10.14.1443',
      ].join('\n'),
    );
  });

  it('shortens very long links so the mail app can still open the draft', () => {
    const long = `https://ex.com/a?x=${'y'.repeat(5000)}`;
    const body = decodeURIComponent(reportMailto({ ...base, originalUrl: long }).split('&body=')[1]!);
    const line = body.split('\n').find((l) => l.startsWith('Original: '))!;
    expect(line.length).toBeLessThan(1100);
    expect(line.endsWith('…')).toBe(true);
  });

  it('keeps & and ? inside links from breaking the mailto query', () => {
    const query = reportMailto(base).split('?').slice(1).join('?');
    expect(query.split('&').map((p) => p.split('=')[0])).toEqual(['subject', 'body']);
  });
});

describe('rulesReportMailto', () => {
  it('lists the diagnostic lines in order', () => {
    const url = rulesReportMailto({
      to: 'support@example.com',
      subject: 'Rules update problem',
      note: 'Check before sending.',
      reason: 'mismatch',
      failedAt: Date.UTC(2026, 9, 30, 4, 5, 6),
      count: 3,
      lastSuccessAt: null,
      appVersion: '0.1.3',
      rulesVersion: '2026.10.22.1441',
      rulesSource: 'built-in',
      builtInVersion: '2026.10.22.1441',
      system: 'Android 16',
    });
    expect(url.startsWith('mailto:support@example.com?subject=Rules%20update%20problem&body=')).toBe(true);
    const body = decodeURIComponent(url.slice(url.indexOf('&body=') + 6));
    expect(body).toBe(
      [
        'Check before sending.',
        '',
        'Rules update: mismatch',
        'Last failure: 2026-10-30T04:05:06.000Z',
        'Failures in a row: 3',
        'Last success: never',
        'App 0.1.3 / Rules 2026.10.22.1441 (built-in) / Built-in 2026.10.22.1441',
        'Android 16',
      ].join('\n'),
    );
  });
});

describe('systemLabel', () => {
  it('uses the Android release, not the API level', () => {
    expect(systemLabel('android', 36, '16')).toBe('Android 16');
  });
  it('uses the iOS version', () => {
    expect(systemLabel('ios', '26.1')).toBe('iOS 26.1');
  });
});
