// Single source of truth for spoken names. `ipa` is broad US IPA with a primary
// stress mark and ɹ, as Deepgram Flux TTS expects inline pronunciation markup.
// Only list words the voice gets wrong unaided: a bad entry is worse than none
// (Gopalakrishnan, Celery and Redis all round-trip correctly as plain text).
// An entry has either `ipa`, or `say`: text the voice is given instead (respellings,
// or several marked-up parts). Captions map `say` back to `word` (see unsay).
const IOT = 'ˌaɪoʊˈtiː ˈɹɛdi', NEO = 'ˈniːoʊskeɪl', KRAFTX = 'ˈkɹæftɛks';
export const PRONUNCIATIONS = [
  // No IPA got the Tamil name right; this respelling, picked by ear, does: KEER-thun.
  { word: 'Keerthan', say: 'Keerthunn' },
  { word: 'Deepgram', ipa: 'ˈdiːpɡɹæm' },
  { word: 'LiveKit', ipa: 'ˈlaɪv ˌkɪt' },  // LIVE as in alive, stress on LIVE
  { word: 'Kraftx.ai', say: `${markup('Kraftx', KRAFTX)} dot A I` },
  { word: 'Kraftx', ipa: KRAFTX },
  { word: 'IntellifyAi', say: 'Intellify A I' },
  // Unmarked, ".co" is read as "company", ".io" loses its "dot", and ".ai" is unclear.
  { word: 'IoTReady.co', say: `${markup('IoTReady', IOT)} dot ${markup('co', 'ˈkoʊ')}` },
  { word: 'IoTReady', ipa: IOT },
  { word: 'Neoscale.io', say: `${markup('Neoscale', NEO)} dot ${markup('io', 'ˌaɪˈoʊ')}` },
  { word: 'Neoscale', ipa: NEO },
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

// What the voice is given for an entry.
export const spoken = (p) => p.say ?? markup(p.word, p.ipa);

const byWord = new Map(PRONUNCIATIONS.map((p) => [p.word, spoken(p)]));
const WORDS_RE = new RegExp(
  `(?<![A-Za-z])(${PRONUNCIATIONS.map((p) => p.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|')})(?![A-Za-z])`,
  'g',
);

// Whole-word, case-sensitive. One pass, so inserted markup is never re-scanned.
export function pronounceAll(text) {
  return String(text).replace(WORDS_RE, (w) => byWord.get(w));
}

// Captions: once markup is stripped, turn each `say` back into the written word,
// so the screen shows "Keerthan" and "IoTReady.co", not "Keerthunn" or "IoTReady dot co".
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plainSay = (say) => say.replace(/\\\{"word": "([^"]*)", "pronounce": "[^"]*"\\\}/g, '$1');
const SAID = PRONUNCIATIONS.filter((p) => p.say).map((p) => [plainSay(p.say), p.word]).sort((a, b) => b[0].length - a[0].length);
const SAID_RE = new RegExp(`(?<![A-Za-z])(${SAID.map(([s]) => esc(s)).join('|')})(?![A-Za-z])`, 'g');
const toWord = new Map(SAID);
export function unsay(text) {
  return typeof text === 'string' ? text.replace(SAID_RE, (s) => toWord.get(s)) : text;
}
