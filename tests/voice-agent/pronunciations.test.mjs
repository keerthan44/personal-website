import test from 'node:test';
import assert from 'node:assert';
import { PRONUNCIATIONS, markup, pronounceAll, spoken } from '../../public/voice/pronunciations.mjs';
import { GREETING } from '../../voice-agent/settings.mjs';
import { RESUME } from '../../voice-agent/resume.mjs';

test('markup format is exact', () => {
  assert.strictEqual(markup('Keerthan', 'ˈkiːɹtən'), '\\{"word": "Keerthan", "pronounce": "ˈkiːɹtən"\\}');
});

test('LiveKit is LIVE-kit, not LIFE-kit or LIV-kit', () => {
  // 'ˈlaɪvkɪt' with no break came out as "LifeKit"; the space keeps the v voiced
  assert.strictEqual(PRONUNCIATIONS.find((p) => p.word === 'LiveKit').ipa, 'ˈlaɪv ˌkɪt');
});

test('list keeps the agreed words and adds the tech terms', () => {
  assert.deepStrictEqual(PRONUNCIATIONS.map((p) => p.word),
    ['Keerthan', 'Deepgram', 'LiveKit', 'Kraftx', 'IntellifyAi', 'IoTReady.co', 'IoTReady', 'Neoscale.io', 'Neoscale', 'DuckDB', 'PES',
      'PostgreSQL', 'FastAPI', 'Telnyx', 'Kyutai', 'Vapi', 'ECS', 'EKS', 'OTA',
      'Next.js', 'Node.js', 'Frappe', 'Plaid', 'Splitwise', 'MatchFives', 'CISCON']);
});

test('words the voice already says right stay unmarked', () => {
  // Their IPA entries made the voice worse.
  for (const w of ['Gopalakrishnan', 'Celery', 'Redis']) {
    assert.ok(!PRONUNCIATIONS.some((p) => p.word === w), w);
  }
});

test('every word appears in the résumé and has a primary stress or a respelling', () => {
  for (const p of PRONUNCIATIONS) {
    assert.ok(RESUME.includes(p.word), p.word);
    assert.ok(p.say ? p.say.length > 0 && !p.ipa : p.ipa.includes('ˈ'), p.word);
  }
});

test('names picked by ear', () => {
  assert.strictEqual(pronounceAll('Keerthan'), 'Keerthunn');
  assert.strictEqual(pronounceAll('IntellifyAi'), 'Intellify A I');
  // ".co" alone is read as "company"; ".io" lost its "dot"
  assert.strictEqual(pronounceAll('IoTReady.co'), `${markup('IoTReady', 'ˌaɪoʊˈtiː ˈɹɛdi')} dot ${markup('co', 'ˈkoʊ')}`);
  assert.strictEqual(pronounceAll('Neoscale.io'), `${markup('Neoscale', 'ˈniːoʊskeɪl')} dot ${markup('io', 'ˌaɪˈoʊ')}`);
  assert.strictEqual(pronounceAll('at IoTReady and Neoscale'), `at ${markup('IoTReady', 'ˌaɪoʊˈtiː ˈɹɛdi')} and ${markup('Neoscale', 'ˈniːoʊskeɪl')}`);
});

test('dotted words match literally, not as a regex wildcard', () => {
  const n = PRONUNCIATIONS.find((p) => p.word === 'Next.js');
  assert.strictEqual(pronounceAll('Next.js, then'), `${markup(n.word, n.ipa)}, then`);
  assert.strictEqual(pronounceAll('Nextxjs'), 'Nextxjs');
});

test('pronounceAll replaces whole words, including possessive', () => {
  const k = PRONUNCIATIONS.find((p) => p.word === 'Kraftx');
  assert.strictEqual(pronounceAll('Hi Kraftx.'), `Hi ${spoken(k)}.`);
  assert.strictEqual(pronounceAll("Kraftx's work"), `${spoken(k)}'s work`);
  assert.strictEqual(pronounceAll("Keerthan's work"), "Keerthunn's work");
});

test('pronounceAll leaves substrings and other case alone', () => {
  assert.strictEqual(pronounceAll('LiveKitAgentLoop'), 'LiveKitAgentLoop');
  assert.strictEqual(pronounceAll('keerthan PESTO'), 'keerthan PESTO');
});

test('greeting contains markup', () => {
  assert.ok(GREETING.includes("I'm Keerthunn,"));
});
