import test from 'node:test';
import assert from 'node:assert';
import { buildSettings, KEYTERMS } from '../../voice-agent/settings.mjs';

const s = buildSettings();
const prompt = s.agent.think[0].prompt;

test('settings shape', () => {
  assert.strictEqual(s.type, 'Settings');
  assert.deepStrictEqual(s.audio.output, { encoding: 'linear16', sample_rate: 24000, container: 'none' });
  assert.strictEqual(s.agent.listen.provider.model, 'flux-general-en');
  assert.strictEqual(s.agent.think[0].provider.model, 'gpt-4.1-mini');
  assert.strictEqual(s.agent.think[1].provider.model, 'claude-haiku-4-5');
  assert.strictEqual(s.agent.speak.provider.model, 'flux-miles-en');
  assert.ok(s.agent.greeting.length > 0);
  assert.strictEqual(s.experimental, true);
  assert.deepStrictEqual(s.tags, ['portfolio']);
  assert.ok(KEYTERMS.includes('Blue Machines'));
});

test('prompt content and size', () => {
  assert.ok(prompt.length < 25000);
  assert.ok(prompt.includes('Blue Machines'));
  assert.ok(prompt.includes('4M') || prompt.includes('four million'));
  assert.ok(!/7676724337|\+91/.test(prompt));
  assert.ok(prompt.includes('keerthan44@gmail.com'));
  assert.ok(!/demo \| code/.test(prompt));
});

test('prompt rules', () => {
  assert.ok(prompt.includes('Answer only from the RESUME'));
  assert.ok(prompt.includes('Answer in at most three short sentences, under fifty words, then stop.'));
  assert.ok(prompt.indexOf('Answer in at most three') < prompt.indexOf('Answer only from the RESUME'), 'length rule comes first');
  assert.ok(prompt.includes('No markdown'));
  assert.ok(prompt.includes('third person'));
  assert.ok(prompt.includes('Decline off-topic'));
  assert.ok(prompt.includes('Never claim to be Keerthan'));
});
