// Strips Deepgram pronunciation markup from spoken text so captions show plain words.
// Also copes with markup split across two ConversationText messages.
// Backslash runs are bounded ({0,4}) so hostile input cannot cause heavy backtracking.
const Q = '["“”„‘’\']';
const NQ = '[^"“”„‘’]';
const VAL = `${Q}(${NQ}*)${Q}`;
const key = (k) => `${Q}${k}${Q}\\s*:\\s*`;
const OPEN = '\\\\{0,4}\\{\\s*';
const CLOSE = '\\s*\\\\{0,4}\\}';
const WORD_FIRST = new RegExp(`${OPEN}${key('word')}${VAL}\\s*,\\s*${key('pronounce')}${VAL}${CLOSE}`, 'g');
const PRON_FIRST = new RegExp(`${OPEN}${key('pronounce')}${VAL}\\s*,\\s*${key('word')}${VAL}${CLOSE}`, 'g');
// Unclosed fragment at the end of the text (the rest arrives in the next message).
const TAIL_WORD = new RegExp(`${OPEN}${key('word')}${Q}?(${NQ}*)(?:${Q}[^{}]*)?$`);
const TAIL_PRON_WORD = new RegExp(`${OPEN}${key('pronounce')}${VAL}\\s*,\\s*${key('word')}${Q}?(${NQ}*)$`);
const TAIL_ANY = new RegExp(`${OPEN}(?:${Q}(?:word|pronounce)${Q}?[^{}]*)?$`);
// Orphan remainder at the start: `ɹθən"\}` or `"pronounce": "…"\}`.
const HEAD_ORPHAN = new RegExp(`^[^{}]{0,200}?${Q}\\s*\\\\{0,4}\\}`);
const STRAY = /\\{1,4}[{}]/g;

export function cleanSpoken(text) {
  if (typeof text !== 'string' || (!text.includes('{') && !text.includes('}') && !text.includes('\\'))) return text;
  return text
    .replace(WORD_FIRST, (_m, word) => word)
    .replace(PRON_FIRST, (_m, _ipa, word) => word)
    .replace(HEAD_ORPHAN, '')
    .replace(TAIL_PRON_WORD, (_m, _ipa, word) => word)
    .replace(TAIL_WORD, (_m, word) => word)
    .replace(TAIL_ANY, '')
    .replace(STRAY, '');
}
