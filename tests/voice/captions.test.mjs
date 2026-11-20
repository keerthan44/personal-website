import test from 'node:test';
import assert from 'node:assert';
import { cleanSpoken } from '../../public/voice/captions.mjs';
import { PRONUNCIATIONS, pronounceAll } from '../../voice-agent/pronunciations.mjs';
import { GREETING } from '../../voice-agent/settings.mjs';

const exact = '\\{"word": "Keerthan", "pronounce": "ˈkiːɹθən"\\}';

test('plain text is unchanged', () => {
  assert.strictEqual(cleanSpoken('Hello there, {not markup}.'), 'Hello there, {not markup}.');
  assert.strictEqual(cleanSpoken(''), '');
});

test('exact markup becomes the word', () => {
  assert.strictEqual(cleanSpoken(`Hi ${exact}!`), 'Hi Keerthan!');
  assert.strictEqual(cleanSpoken(`${exact}'s work`), "Keerthan's work");
});

test('tolerates unescaped braces, double backslashes, spacing, key order, smart quotes', () => {
  assert.strictEqual(cleanSpoken('Hi {"word": "Keerthan", "pronounce": "x"}'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\\\{"word": "Keerthan", "pronounce": "x"\\\\}'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\{ "word" :  "Keerthan" ,  "pronounce" : "x" \\}'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\{"pronounce": "x", "word": "Keerthan"\\}'), 'Hi Keerthan');
  assert.strictEqual(cleanSpoken('Hi \\{“word”: “Keerthan”, “pronounce”: “x”\\}'), 'Hi Keerthan');
});

test('removes stray escaped braces', () => {
  assert.strictEqual(cleanSpoken('a \\{ b \\} c'), 'a  b  c');
});

test('round trips', () => {
  const plain = "Hi, I'm Keerthan's AI agent. Ask me anything about his work: what he's built, where he's worked, or whether he's open to new roles.";
  assert.strictEqual(cleanSpoken(GREETING), plain, 'the shipped greeting captions cleanly');
  assert.strictEqual(cleanSpoken(pronounceAll(plain)), plain);
  const s = PRONUNCIATIONS.map((p) => p.word).join(', ') + ".";
  assert.strictEqual(cleanSpoken(pronounceAll(s)), s);
});
