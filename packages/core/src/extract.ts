import { getHost } from './query';

// Stop at whitespace, '"', '<', '>' and full-width punctuation; raw non-ASCII
// (e.g. Chinese product names in shopee.tw paths) stays part of the URL.
const URL_RE = /https?:\/\/[^\s"<>。，、；：！？「」『』（）【】]+/i;
const TRAILING = /[.,;:!?'*]+$/;

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

export function extractUrl(text: string): string | null {
  const m = URL_RE.exec(text);
  if (!m || !getHost(m[0])) return null;
  // A bare URL is taken verbatim; trailing punctuation is only trimmed when the URL sits in prose.
  if (text.trim() === m[0]) return m[0];
  let url = m[0];
  for (;;) {
    const trimmed = url.replace(TRAILING, '');
    if (trimmed.endsWith(')') && count(trimmed, '(') < count(trimmed, ')')) {
      url = trimmed.slice(0, -1);
      continue;
    }
    return trimmed;
  }
}
