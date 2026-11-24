import test from 'node:test';
import assert from 'node:assert';
import { buildSettings, KEYTERMS } from '../../voice-agent/settings.mjs';
import { pronounceAll } from '../../public/voice/pronunciations.mjs';

const s = buildSettings();
const prompt = s.agent.think[0].prompt;

test('settings shape', () => {
  assert.strictEqual(s.type, 'Settings');
  assert.deepStrictEqual(s.audio.output, { encoding: 'linear16', sample_rate: 24000, container: 'none' });
  assert.strictEqual(s.agent.listen.provider.model, 'flux-general-en');
  assert.strictEqual(s.agent.think[0].provider.model, 'gpt-4.1-mini');
  assert.strictEqual(s.agent.think[1].provider.model, 'claude-haiku-4-5');
  assert.strictEqual(s.agent.speak.provider.model, 'flux-haley-en');
  assert.strictEqual(s.agent.speak.provider.version, 'v2');
  assert.ok(!('speed' in s.agent.speak.provider));
  assert.ok(s.agent.greeting.includes("I'm Keerthunn,"));
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
  assert.ok(prompt.includes('Never use colons, semicolons'));
  assert.ok(prompt.includes('in the first person'));
  assert.ok(prompt.includes('GUARDRAILS'));
  assert.ok(prompt.includes('HOW YOU HEAR'));
  assert.ok(prompt.includes('SPEAKING STYLE'));
  assert.ok(prompt.includes('Never deny being an AI'));
});

test('never states whether I am open to roles', () => {
  assert.ok(!/open to (new )?roles/i.test(s.agent.greeting));
  assert.ok(prompt.includes("Never say whether I'm open to new roles"));
  assert.ok(!/I'm open to (new )?roles/.test(prompt.replace("Never say whether I'm open to new roles", '')));
});

test('stack answers stay short and lead with the main stack', () => {
  assert.ok(prompt.includes('MAIN STACK'));
  assert.ok(prompt.includes('answer from MAIN STACK only, in one or two sentences'));
  assert.ok(prompt.includes('Never read out a list of tools'));
  const main = prompt.slice(prompt.indexOf('MAIN STACK ('), prompt.indexOf('ALSO USED ('));
  assert.ok(!/Rust|Java\b/.test(main), 'Rust and Java are not presented as main stack');
  assert.ok(/Rust \(a little\)/.test(prompt) && /Java \(some Spring Boot\)/.test(prompt));
});

test('prompt has pronunciation section with exact markup', () => {
  assert.ok(prompt.includes('PRONUNCIATION'));
  assert.ok(prompt.includes('Keerthan → Keerthunn\n'));
  assert.ok(prompt.includes('Kraftx → \\{"word": "Kraftx", "pronounce": "ˈkɹæftɛks"\\}'));
  assert.ok(prompt.includes('Never explain or mention this formatting'));
  assert.ok(prompt.includes('Keerthan Gopalakrishnan'));
});

test('the résumé in the prompt uses the spoken names', () => {
  const resume = prompt.slice(prompt.indexOf('\nRESUME\n'));
  for (const w of ['IntellifyAi,', 'IoTReady.co,', 'Neoscale.io,']) assert.ok(!resume.includes(w), w);
  assert.ok(resume.includes('Intellify A I,'));
  assert.ok(resume.includes('Keerthunn Gopalakrishnan'));
});

test('prompt has a possessive example sentence built from markup()', () => {
  assert.ok(prompt.includes(`I was ${pronounceAll("Kraftx's")} first engineer.`));
  assert.ok(prompt.includes('\\{"word": "Kraftx"'));
});
