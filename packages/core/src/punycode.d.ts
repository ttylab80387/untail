declare module 'punycode/punycode.js' {
  const punycode: { toASCII(s: string): string; toUnicode(s: string): string };
  export default punycode;
}
