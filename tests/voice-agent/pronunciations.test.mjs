import test from 'node:test';
import assert from 'node:assert';
import { PRONUNCIATIONS, markup, pronounceAll } from '../../public/voice/pronunciations.mjs';
import { GREETING } from '../../voice-agent/settings.mjs';
import { RESUME } from '../../voice-agent/resume.mjs';

test('markup format is exact', () => {
  assert.strictEqual(markup('Keerthan', 'ˈkiːɹθən'), '\\{"word": "Keerthan", "pronounce": "ˈkiːɹθən"\\}');
});

test('list keeps the agreed words and adds the tech terms', () => {
  assert.deepStrictEqual(PRONUNCIATIONS.map((p) => p.word),
    ['Keerthan', 'Gopalakrishnan', 'Kraftx', 'IntellifyAi', 'IoTReady', 'Neoscale', 'LiveKit', 'DuckDB', 'PES',
      'PostgreSQL', 'FastAPI', 'Celery', 'Redis', 'Telnyx', 'Kyutai', 'Vapi', 'ECS', 'EKS', 'OTA',
      'Next.js', 'Node.js', 'Frappe', 'Plaid', 'Splitwise', 'MatchFives', 'CISCON']);
});

test('every word appears in the résumé and has a primary stress', () => {
  for (const p of PRONUNCIATIONS) {
    assert.ok(RESUME.includes(p.word), p.word);
    assert.ok(p.ipa.includes('ˈ'), p.word);
  }
});

test('dotted words match literally, not as a regex wildcard', () => {
  const n = PRONUNCIATIONS.find((p) => p.word === 'Next.js');
  assert.strictEqual(pronounceAll('Next.js, then'), `${markup(n.word, n.ipa)}, then`);
  assert.strictEqual(pronounceAll('Nextxjs'), 'Nextxjs');
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
