// Strips Deepgram pronunciation markup from spoken text so captions show plain words.
const Q = '["\u201C\u201D\u201E\u2018\u2019\']';
const VAL = `${Q}([^"\u201C\u201D\u201E\u2018\u2019]*)${Q}`;
const key = (k) => `${Q}${k}${Q}\\s*:\\s*`;
const OPEN = '\\\\*\\{\\s*';
const CLOSE = '\\s*\\\\*\\}';
const WORD_FIRST = new RegExp(`${OPEN}${key('word')}${VAL}\\s*,\\s*${key('pronounce')}${VAL}${CLOSE}`, 'g');
const PRON_FIRST = new RegExp(`${OPEN}${key('pronounce')}${VAL}\\s*,\\s*${key('word')}${VAL}${CLOSE}`, 'g');

export function cleanSpoken(text) {
  if (typeof text !== 'string' || !text.includes('{') && !text.includes('\\')) return text;
  return text
    .replace(WORD_FIRST, (_m, word) => word)
    .replace(PRON_FIRST, (_m, _ipa, word) => word)
    .replace(/\\+[{}]/g, '');
}
