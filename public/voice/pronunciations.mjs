// Single source of truth for spoken names. `ipa` is broad US IPA with a primary
// stress mark and ɹ, as Deepgram Flux TTS expects inline pronunciation markup.
// Only list words the voice gets wrong unaided: a bad entry is worse than none
// (Gopalakrishnan, Celery and Redis all round-trip correctly as plain text).
export const PRONUNCIATIONS = [
  { word: 'Keerthan', ipa: 'ˈkiːɹtən' },
  { word: 'Deepgram', ipa: 'ˈdiːpɡɹæm' },
  { word: 'LiveKit', ipa: 'ˈlaɪv ˌkɪt' },  // LIVE as in alive, stress on LIVE
  { word: 'Kraftx', ipa: 'ˈkɹæftɛks' },
  { word: 'IntellifyAi', ipa: 'ɪnˈtɛlɪfaɪ ˌeɪˈaɪ' },
  { word: 'IoTReady', ipa: 'ˌaɪoʊˈtiː ˈɹɛdi' },
  { word: 'Neoscale', ipa: 'ˈniːoʊskeɪl' },
  { word: 'DuckDB', ipa: 'ˈdʌk ˌdiːˈbiː' },
  { word: 'PES', ipa: 'ˌpiː ˌiː ˈɛs' },
  { word: 'PostgreSQL', ipa: 'ˈpoʊstɡɹɛs' },
  { word: 'FastAPI', ipa: 'ˈfæstˌeɪpiˈaɪ' },
  { word: 'Telnyx', ipa: 'ˈtɛlnɪks' },
  { word: 'Kyutai', ipa: 'ˈkjuːtaɪ' },
  { word: 'Vapi', ipa: 'ˈvɑːpi' },
  { word: 'ECS', ipa: 'ˌiː ˌsiː ˈɛs' },
  { word: 'EKS', ipa: 'ˌiː ˌkeɪ ˈɛs' },
  { word: 'OTA', ipa: 'ˌoʊˌtiːˈeɪ' },
  { word: 'Next.js', ipa: 'ˈnɛkst dʒeɪ ɛs' },
  { word: 'Node.js', ipa: 'ˈnoʊd dʒeɪ ɛs' },
  { word: 'Frappe', ipa: 'ˈfɹæpeɪ' },
  { word: 'Plaid', ipa: 'ˈplæd' },
  { word: 'Splitwise', ipa: 'ˈsplɪtwaɪz' },
  { word: 'MatchFives', ipa: 'ˈmætʃ ˈfaɪvz' },
  { word: 'CISCON', ipa: 'ˈsɪskɑn' },
];

export function markup(word, ipa) {
  return `\\{"word": "${word}", "pronounce": "${ipa}"\\}`;
}

const byWord = new Map(PRONUNCIATIONS.map((p) => [p.word, p.ipa]));
const WORDS_RE = new RegExp(
  `(?<![A-Za-z])(${PRONUNCIATIONS.map((p) => p.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|')})(?![A-Za-z])`,
  'g',
);

// Whole-word, case-sensitive. One pass, so inserted markup is never re-scanned.
export function pronounceAll(text) {
  return String(text).replace(WORDS_RE, (w) => markup(w, byWord.get(w)));
}
