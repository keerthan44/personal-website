// Single source of truth for spoken names. `ipa` is broad US IPA with a primary
// stress mark and ɹ, as Deepgram Flux TTS expects inline pronunciation markup.
export const PRONUNCIATIONS = [
  { word: 'Keerthan', ipa: 'ˈkiːɹθən' },
  { word: 'Gopalakrishnan', ipa: 'ˌɡoʊpɑːləˈkɹɪʃnən' },
  { word: 'Kraftx', ipa: 'ˈkɹæft ˈɛks' },
  { word: 'IntellifyAi', ipa: 'ɪnˈtɛlɪfaɪ ˌeɪˈaɪ' },
  { word: 'IoTReady', ipa: 'ˌaɪoʊˈtiː ˈɹɛdi' },
  { word: 'Neoscale', ipa: 'ˈniːoʊskeɪl' },
  { word: 'LiveKit', ipa: 'ˈlaɪvkɪt' },
  { word: 'DuckDB', ipa: 'ˈdʌk ˌdiːˈbiː' },
  { word: 'PES', ipa: 'ˌpiː ˌiː ˈɛs' },
];

export function markup(word, ipa) {
  return `\\{"word": "${word}", "pronounce": "${ipa}"\\}`;
}

const byWord = new Map(PRONUNCIATIONS.map((p) => [p.word, p.ipa]));
const WORDS_RE = new RegExp(
  `(?<![A-Za-z])(${PRONUNCIATIONS.map((p) => p.word).sort((a, b) => b.length - a.length).join('|')})(?![A-Za-z])`,
  'g',
);

// Whole-word, case-sensitive. One pass, so inserted markup is never re-scanned.
export function pronounceAll(text) {
  return String(text).replace(WORDS_RE, (w) => markup(w, byWord.get(w)));
}
