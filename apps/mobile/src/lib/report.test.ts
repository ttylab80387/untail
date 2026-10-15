import { describe, expect, it } from 'vitest';
import { reportMailto } from './report';

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
