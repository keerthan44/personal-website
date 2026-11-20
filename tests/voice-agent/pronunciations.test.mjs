import test from 'node:test';
import assert from 'node:assert';
import { PRONUNCIATIONS, markup, pronounceAll } from '../../public/voice/pronunciations.mjs';
import { GREETING } from '../../voice-agent/settings.mjs';

test('markup format is exact', () => {
  assert.strictEqual(markup('Keerthan', 'ˈkiːɹθən'), '\\{"word": "Keerthan", "pronounce": "ˈkiːɹθən"\\}');
});

test('list has the nine agreed words', () => {
  assert.deepStrictEqual(PRONUNCIATIONS.map((p) => p.word),
    ['Keerthan', 'Gopalakrishnan', 'Kraftx', 'IntellifyAi', 'IoTReady', 'Neoscale', 'LiveKit', 'DuckDB', 'PES']);
});

test('pronounceAll replaces whole words, including possessive', () => {
  const k = PRONUNCIATIONS.find((p) => p.word === 'Keerthan');
  assert.strictEqual(pronounceAll('Hi Keerthan.'), `Hi ${markup(k.word, k.ipa)}.`);
  assert.strictEqual(pronounceAll("Keerthan's work"), `${markup(k.word, k.ipa)}'s work`);
});

test('pronounceAll leaves substrings and other case alone', () => {
  assert.strictEqual(pronounceAll('LiveKitAgentLoop'), 'LiveKitAgentLoop');
  assert.strictEqual(pronounceAll('keerthan PESTO'), 'keerthan PESTO');
});

test('greeting contains markup', () => {
  assert.ok(GREETING.includes('\\{"word": "Keerthan"'));
});
